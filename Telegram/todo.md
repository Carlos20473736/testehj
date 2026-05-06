# Ad Button Proxy Site - TODO

## Funcionalidades Implementadas

### Fase 1: Migração do Home.tsx
- [x] Migrar Home.tsx original com fundo estrelado
- [x] Preservar cards de progresso no estilo iOS
- [x] Preservar botão de anúncio com estilo iOS
- [x] Manter lógica de contagem de impressões e cliques
- [x] Preservar diálogo de YMID

### Fase 2: Integração do Proxy DataImpulse
- [x] Copiar proxy-interceptor.js para o novo projeto
- [x] Copiar telegram-env.js para o novo projeto
- [x] Adicionar scripts ao index.html na ordem correta
- [x] Criar proxyHandler.ts com endpoint /proxy/*
- [x] Integrar ProxyAgent do undici para suportar Node.js 22+
- [x] Registrar proxy routes no servidor Express

### Fase 3: Funcionalidades do SDK da Monetag
- [x] Carregar SDK via /proxy/libtl.com/sdk.js
- [x] Interceptar fetch/XHR automaticamente
- [x] Manter postback para impressões e cliques
- [x] Preservar lógica de YMID e localStorage
- [x] Manter fetch de stats do servidor de postback

### Fase 4: Testes
- [x] Build do projeto sem erros
- [x] Servidor iniciando corretamente
- [x] Proxy endpoint retornando conteúdo
- [x] SDK da Monetag sendo servido via proxy
- [x] HTML sendo servido com scripts corretos

## Funcionalidades Futuras (Fora do Escopo MVP)

- [ ] Adicionar testes Vitest para fluxo de anúncios
- [ ] Implementar dashboard de estatísticas (tRPC)
- [ ] Adicionar persistência de dados no banco de dados
- [ ] Integrar autenticação de usuários
- [ ] Adicionar notificações de postback

## Notas Técnicas

### Proxy DataImpulse
- Host: gw.dataimpulse.com
- Port: 823
- Login: 7f2df2198878db590b29
- Senha: 0c60b5e747a52032
- Todas as requisições de /proxy/* passam pelo IP residencial

### Ordem de Carregamento de Scripts
1. proxy-interceptor.js (intercepta fetch/XHR)
2. telegram-env.js (simula ambiente Telegram)
3. SDK da Monetag (carregado via /proxy/libtl.com/sdk.js)

### Arquivos Críticos
- client/src/pages/Home.tsx - Página principal com lógica de anúncios
- server/_core/proxyHandler.ts - Endpoint de proxy reverso
- client/public/proxy-interceptor.js - Interceptor de requisições
- client/public/telegram-env.js - Simulador de ambiente Telegram

## Status de Deployment

- [x] Projeto criado no Manus
- [x] Build de produção funcionando
- [x] Servidor iniciando corretamente
- [x] Checkpoint salvo (b16a2c68)
- [x] Pronto para publicação em domínio Manus


## Atualização: Proxy Russo

- [x] Configurar proxy DataImpulse para rotear via IPs russos
- [x] Testar requisições passando por IP russo (IP confirmado: 77.223.66.21)
- [x] Validar que SDK da Monetag funciona com proxy russo
- [x] Criar checkpoint com proxy russo ativo


## Atualização: SDK Carregado via Proxy

- [x] Modificar proxy-interceptor.js para interceptar appendChild/insertBefore
- [x] Modificar Home.tsx para usar URL absoluta do proxy
- [x] Testar carregamento do SDK via /proxy/libtl.com/sdk.js
- [x] Confirmar que SDK detecta proxy no contexto global
- [x] Validar logs do servidor mostrando requisições via proxy russo


## Bug: SDK da Monetag não funciona com proxy (RESOLVIDO)

- [x] Investigar por que o SDK não está detectando o proxy russo
- [x] Garantir que TODAS as sub-requisições do SDK passem pelo proxy
- [x] Resolver problema de detecção de IP pelo servidor de anúncios
- [x] Testar e confirmar que anúncios são entregues via IP russo (anúncio russo: 7K CASINO)
