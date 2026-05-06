/**
 * Proxy Handler para DataImpulse
 * 
 * Roteia requisições de /proxy/* através do proxy residencial DataImpulse
 * Todas as requisições do SDK da Monetag passam por aqui automaticamente
 */

import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { Express, Request, Response } from "express";
import { raw } from "express";

// ===== CONFIGURAÇÃO DO PROXY DATAIMPULSE COM PAÍS RUSSIA =====
// Formato: login__cr.ru:password (cr = country, ru = Russia)
const PROXY_LOGIN = "7f2df2198878db590b29__cr.ru";
const PROXY_PASSWORD = "0c60b5e747a52032";
const PROXY_HOST = "gw.dataimpulse.com";
const PROXY_PORT = "823";
const PROXY_URL = `http://${PROXY_LOGIN}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;

// Criar ProxyAgent do undici que funciona com fetch nativo
const proxyAgent = new ProxyAgent(PROXY_URL);

export function registerProxyRoutes(app: Express) {
  // Middleware para capturar raw body em requisições POST
  app.use("/proxy", raw({ type: "*/*", limit: "10mb" }));

  // CORS preflight - deve vir antes do handler principal
  app.options("/proxy/*", (_req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
  });

  // ===== ENDPOINT DE PROXY REVERSO =====
  app.all("/proxy/*", async (req: Request, res: Response) => {
    try {
      const targetPath = (req.params as any)[0] as string;
      if (!targetPath) {
        res.status(400).send("URL alvo não especificada");
        return;
      }

      // Construir URL alvo
      let targetUrl: string;
      if (targetPath.startsWith("http://") || targetPath.startsWith("https://")) {
        targetUrl = targetPath;
      } else {
        targetUrl = `https://${targetPath}`;
      }

      // Adicionar query string
      const queryString = req.originalUrl.includes("?")
        ? req.originalUrl.substring(req.originalUrl.indexOf("?"))
        : "";
      targetUrl += queryString;

      console.log(`[PROXY] ${req.method} ${targetUrl} via DataImpulse`);

      // Construir headers para a requisição proxied
      const headers: Record<string, string> = {
        "User-Agent": (req.headers["user-agent"] as string) || "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Accept": (req.headers["accept"] as string) || "*/*",
        "Accept-Language": (req.headers["accept-language"] as string) || "ru-RU,ru;q=0.9,en;q=0.8",
      };

      // Copiar headers relevantes do request original
      if (req.headers["content-type"]) {
        headers["Content-Type"] = req.headers["content-type"] as string;
      }
      if (req.headers["accept-encoding"]) {
        // Não enviar accept-encoding para evitar problemas com descompressão
      }

      // Extrair domínio alvo para o Referer
      try {
        const targetUrlObj = new URL(targetUrl);
        headers["Referer"] = targetUrlObj.origin + "/";
        headers["Origin"] = targetUrlObj.origin;
      } catch (e) {
        // ignorar
      }

      // Preparar body para POST/PUT/PATCH
      let body: Buffer | string | undefined;
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (Buffer.isBuffer(req.body)) {
          body = req.body;
        } else if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
          body = JSON.stringify(req.body);
          if (!headers["Content-Type"]) {
            headers["Content-Type"] = "application/json";
          }
        } else if (typeof req.body === "string" && req.body.length > 0) {
          body = req.body;
        }
      }

      const response = await undiciFetch(targetUrl, {
        method: req.method as any,
        headers,
        body: body as any,
        dispatcher: proxyAgent,
        redirect: "follow",
      });

      // Copiar headers de resposta relevantes
      const responseHeaders = [
        "content-type",
        "content-length",
        "cache-control",
        "expires",
        "pragma",
        "set-cookie",
        "location",
      ];

      for (const header of responseHeaders) {
        const value = response.headers.get(header);
        if (value) {
          res.setHeader(header, value);
        }
      }

      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader("Access-Control-Allow-Credentials", "true");

      const bodyBuffer = Buffer.from(await response.arrayBuffer());
      res.status(response.status).send(bodyBuffer);
    } catch (error: any) {
      console.error(`[PROXY] Erro:`, error.message);
      res.status(502).send(`Proxy error: ${error.message}`);
    }
  });

  console.log(`[PROXY] Proxy DataImpulse ativo: ${PROXY_HOST}:${PROXY_PORT}`);
  console.log(`[PROXY] País: RUSSIA (RU)`);
  console.log(`[PROXY] Endpoint /proxy/* disponível para rotear requisições via IP russo`);
}
