import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import mysql from 'mysql2/promise';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

// ================================================================
// PROXY DATAIMPULSE - RUSSIA
// ================================================================
const PROXY_LOGIN = '7f2df2198878db590b29__cr.ru';
const PROXY_PASSWORD = '0c60b5e747a52032';
const PROXY_HOST = 'gw.dataimpulse.com';
const PROXY_PORT = '823';
const PROXY_URL = `http://${PROXY_LOGIN}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;
const proxyAgent = new ProxyAgent(PROXY_URL);
console.log(`[PROXY] DataImpulse ativo: ${PROXY_HOST}:${PROXY_PORT} (Russia)`);

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const RAILWAY_API = 'https://youngmoney-api-railway-production.up.railway.app';

// Valores de restauração de habilidades
const RESTORE_CASCADE = 30;
const RESTORE_TIME_FREEZE = 12;
const RESTORE_DOUBLE_POINTS = 6;

// ================================================================
// COOLDOWN DO CANDY: 1 HORA (3600 segundos)
// Só se aplica quando TODAS as habilidades estão em 0
// Após o claim, inicia o cooldown de 1 hora antes de poder assistir novamente
// ================================================================
const CANDY_COOLDOWN_SECONDS = 3600; // 1 hora

// ================================================================
// MYSQL CONNECTION POOL
// Usa as mesmas variáveis de ambiente do Railway que o PHP usa
// ================================================================
let pool = null;
let poolFallback = false;

// Configuracoes de conexao: interna e publica
const DB_INTERNAL = {
  host: process.env.MYSQLHOST || 'mysql.railway.internal',
  port: parseInt(process.env.MYSQLPORT || '3306'),
  user: process.env.MYSQLUSER || 'root',
  password: process.env.MYSQLPASSWORD || 'XvWOlrgTfcJLaDjfywmnSHRNdwEhktSS',
  database: process.env.MYSQLDATABASE || 'railway'
};

const DB_PUBLIC = {
  host: process.env.MYSQL_PUBLIC_HOST || 'gondola.proxy.rlwy.net',
  port: parseInt(process.env.MYSQL_PUBLIC_PORT || '46765'),
  user: process.env.MYSQLUSER || 'root',
  password: process.env.MYSQLPASSWORD || 'XvWOlrgTfcJLaDjfywmnSHRNdwEhktSS',
  database: process.env.MYSQLDATABASE || 'railway'
};

function createPool(config, label) {
  const p = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    connectTimeout: 10000
  });
  console.log(`[DB] Pool MySQL criado (${label}):`, config.host + ':' + config.port);
  return p;
}

function getPool() {
  if (!pool) {
    pool = createPool(DB_INTERNAL, 'internal');
  }
  return pool;
}

// Fallback: se conexao interna falhar, trocar para publica
async function getWorkingPool() {
  if (poolFallback) return pool;
  try {
    const conn = await getPool().getConnection();
    conn.release();
    return pool;
  } catch (err) {
    console.log('[DB] Conexao interna falhou:', err.message);
    console.log('[DB] Tentando conexao publica...');
    try {
      pool = createPool(DB_PUBLIC, 'public');
      const conn = await pool.getConnection();
      conn.release();
      poolFallback = true;
      console.log('[DB] Conexao publica OK!');
      return pool;
    } catch (err2) {
      console.error('[DB] Conexao publica tambem falhou:', err2.message);
      throw err2;
    }
  }
}

// Helper: garantir tabelas existem
async function ensureTables(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS candy_cooldowns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ymid INT NOT NULL UNIQUE,
    completed_at DATETIME NOT NULL,
    claimable TINYINT(1) NOT NULL DEFAULT 1,
    cooldown_until DATETIME NULL COMMENT 'Quando o cooldown de 1h expira',
    INDEX idx_ymid (ymid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Adicionar coluna cooldown_until se não existir
  try {
    await conn.query(`ALTER TABLE candy_cooldowns ADD COLUMN cooldown_until DATETIME NULL COMMENT 'Quando o cooldown de 1h expira'`);
  } catch (e) {
    // Ignorar se já existir
  }

  await conn.query(`CREATE TABLE IF NOT EXISTS game_abilities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    cascade_charges INT NOT NULL DEFAULT 0,
    time_freeze_charges INT NOT NULL DEFAULT 0,
    double_points_charges INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

// ================================================================
// CANDY - COM COOLDOWN DE 1 HORA BASEADO NO SERVIDOR
// Bloqueio baseado em:
// 1. Se tem recompensa pendente (claimable) → bloqueado
// 2. Se alguma habilidade > 0 → bloqueado (use as habilidades)
// 3. Se todas = 0 e está em cooldown → bloqueado (aguarde o reset)
// 4. Se todas = 0 e cooldown expirou → liberado
// O resgate de recompensa é MANUAL via /api/candy/claim
// Após o claim, inicia cooldown de 1 hora
// ================================================================

// Middleware
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Host', 'User-Agent']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Content Security Policy
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self' https:; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org https://*.monetag.com https://*.tsyndicate.com https://*.onclcknow.com https://*.surfrfrr.com https://*.profitablegatecpm.com https://*.richinfo.co https://libtl.com https://*.libtl.com https://*.alwingulla.com https://*.adsco.re https://*.cpx.to https://manus-analytics.com https://*.tzegilo.com https://tzegilo.com https://*.servicer.one https://*.oaphoace.com https://*.groleegni.net https://*.dolohen.com https://*.vfrfrr.com https://*.a-ads.com https://*.hilltopads.net https://*.exoclick.com https://*.juicyads.com https://*.trafficjunky.com https://*.propellerads.com https://*.clickadu.com https://*.popads.net; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
    "img-src 'self' data: https: blob:; " +
    "connect-src 'self' https: wss:; " +
    "frame-src 'self' https:; " +
    "worker-src 'self' blob:;"
  );
  res.removeHeader('X-Frame-Options');
  next();
});

// ================================================================
// PROXY DATAIMPULSE - ENDPOINT /proxy/*
// Todas as requisições do SDK da Monetag passam por aqui
// ================================================================
app.options('/proxy/*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).end();
});

app.all('/proxy/*', async (req, res) => {
  try {
    const targetPath = req.params[0];
    if (!targetPath) {
      return res.status(400).send('URL alvo não especificada');
    }

    let targetUrl;
    if (targetPath.startsWith('http://') || targetPath.startsWith('https://')) {
      targetUrl = targetPath;
    } else {
      targetUrl = `https://${targetPath}`;
    }

    const queryString = req.originalUrl.includes('?')
      ? req.originalUrl.substring(req.originalUrl.indexOf('?'))
      : '';
    targetUrl += queryString;

    console.log(`[PROXY] ${req.method} ${targetUrl} via DataImpulse`);

    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'ru-RU,ru;q=0.9,en;q=0.8',
    };

    if (req.headers['content-type']) {
      headers['Content-Type'] = req.headers['content-type'];
    }

    try {
      const targetUrlObj = new URL(targetUrl);
      headers['Referer'] = targetUrlObj.origin + '/';
      headers['Origin'] = targetUrlObj.origin;
    } catch (e) {}

    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (Buffer.isBuffer(req.body)) {
        body = req.body;
      } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        body = JSON.stringify(req.body);
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'application/json';
        }
      } else if (typeof req.body === 'string' && req.body.length > 0) {
        body = req.body;
      }
    }

    const response = await undiciFetch(targetUrl, {
      method: req.method,
      headers,
      body: body,
      dispatcher: proxyAgent,
      redirect: 'follow',
    });

    const responseHeaders = ['content-type', 'content-length', 'cache-control', 'expires', 'pragma', 'set-cookie', 'location'];
    for (const header of responseHeaders) {
      const value = response.headers.get(header);
      if (value) {
        res.setHeader(header, value);
      }
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    const bodyBuffer = Buffer.from(await response.arrayBuffer());
    res.status(response.status).send(bodyBuffer);
  } catch (error) {
    console.error(`[PROXY] Erro:`, error.message);
    res.status(502).send(`Proxy error: ${error.message}`);
  }
});

// Serve static files from public directory
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    candy_cooldown_seconds: CANDY_COOLDOWN_SECONDS
  });
});

// ================================================================
// CANDY ABILITIES: Consulta habilidades para o app decidir se abre o Candy
// O app deve chamar ANTES de abrir o site do Candy
// ================================================================
app.get('/api/candy/abilities', async (req, res) => {
  const ymid = parseInt(req.query.ymid);

  if (!ymid || ymid <= 0) {
    return res.json({ success: false, error: 'ymid obrigatorio' });
  }

  try {
    const db = await getWorkingPool();
    await ensureTables(db);

    // 1. Verificar habilidades
    const [abilityRows] = await db.query('SELECT cascade_charges, time_freeze_charges, double_points_charges FROM game_abilities WHERE user_id = ?', [ymid]);

    let cascade = 0, timeFreeze = 0, doublePoints = 0;
    if (abilityRows.length > 0) {
      cascade = abilityRows[0].cascade_charges || 0;
      timeFreeze = abilityRows[0].time_freeze_charges || 0;
      doublePoints = abilityRows[0].double_points_charges || 0;
    }

    const allZero = (cascade === 0 && timeFreeze === 0 && doublePoints === 0);

    // 2. Verificar claimable e cooldown
    const [cooldownRows] = await db.query('SELECT claimable, cooldown_until FROM candy_cooldowns WHERE ymid = ?', [ymid]);
    const claimable = cooldownRows.length > 0 ? Boolean(cooldownRows[0].claimable) : false;
    
    // 3. Verificar cooldown de 1 hora
    let inCooldown = false;
    let remainingSeconds = 0;
    if (cooldownRows.length > 0 && cooldownRows[0].cooldown_until) {
      const cooldownUntil = new Date(cooldownRows[0].cooldown_until);
      const now = new Date();
      if (now < cooldownUntil) {
        inCooldown = true;
        remainingSeconds = Math.ceil((cooldownUntil - now) / 1000);
      }
    }

    // 4. Pode abrir o Candy?
    const canOpenCandy = (allZero && !claimable && !inCooldown);

    let message = '';
    if (claimable) {
      message = 'Resgate sua recompensa primeiro!';
    } else if (!allZero) {
      message = 'Use todas as habilidades para assistir novamente';
    } else if (inCooldown) {
      const minutes = Math.ceil(remainingSeconds / 60);
      message = `Aguarde ${minutes} minuto(s) para assistir novamente`;
    } else {
      message = 'Disponivel para assistir';
    }

    console.log(`[CANDY ABILITIES] YMID ${ymid}: can_open=${canOpenCandy}, abilities=${cascade}/${timeFreeze}/${doublePoints}, claimable=${claimable}, cooldown=${inCooldown}(${remainingSeconds}s)`);

    return res.json({
      success: true,
      can_open_candy: canOpenCandy,
      abilities: { cascade, time_freeze: timeFreeze, double_points: doublePoints },
      all_zero: allZero,
      claimable,
      in_cooldown: inCooldown,
      remaining_seconds: remainingSeconds,
      message
    });
  } catch (err) {
    console.error(`[CANDY ABILITIES] Erro DB para YMID ${ymid}:`, err.message);
    return res.json({
      success: true,
      can_open_candy: true,
      abilities: { cascade: 0, time_freeze: 0, double_points: 0 },
      all_zero: true,
      claimable: false,
      in_cooldown: false,
      remaining_seconds: 0,
      message: 'Erro ao verificar, liberado por seguranca'
    });
  }
});

// ================================================================
// CANDY STATUS: Direto no banco MySQL - COM COOLDOWN DE 1 HORA
// ================================================================
app.get('/api/candy/status', async (req, res) => {
  const ymid = parseInt(req.query.ymid);

  if (!ymid || ymid <= 0) {
    return res.json({ success: false, error: 'ymid obrigatorio' });
  }

  try {
    const db = await getWorkingPool();
    await ensureTables(db);

    // 1. Verificar claimable e cooldown
    const [cooldownRows] = await db.query('SELECT claimable, cooldown_until FROM candy_cooldowns WHERE ymid = ?', [ymid]);
    const claimable = cooldownRows.length > 0 ? Boolean(cooldownRows[0].claimable) : false;

    // 2. Verificar cooldown de 1 hora
    let inCooldown = false;
    let remainingSeconds = 0;
    if (cooldownRows.length > 0 && cooldownRows[0].cooldown_until) {
      const cooldownUntil = new Date(cooldownRows[0].cooldown_until);
      const now = new Date();
      if (now < cooldownUntil) {
        inCooldown = true;
        remainingSeconds = Math.ceil((cooldownUntil - now) / 1000);
      }
    }

    // 3. Verificar habilidades
    const [abilityRows] = await db.query('SELECT cascade_charges, time_freeze_charges, double_points_charges FROM game_abilities WHERE user_id = ?', [ymid]);

    let cascade = 0, timeFreeze = 0, doublePoints = 0;
    if (abilityRows.length > 0) {
      cascade = abilityRows[0].cascade_charges || 0;
      timeFreeze = abilityRows[0].time_freeze_charges || 0;
      doublePoints = abilityRows[0].double_points_charges || 0;
    }

    const allZero = (cascade === 0 && timeFreeze === 0 && doublePoints === 0);

    // 4. Lógica de bloqueio
    let blocked = false;
    let message = '';

    if (claimable) {
      blocked = true;
      message = 'Resgate sua recompensa primeiro!';
    } else if (!allZero) {
      blocked = true;
      message = 'Use todas as habilidades para assistir novamente';
    } else if (inCooldown) {
      blocked = true;
      const minutes = Math.ceil(remainingSeconds / 60);
      message = `Aguarde ${minutes} minuto(s) para assistir novamente`;
    } else {
      blocked = false;
      message = 'Disponivel para assistir';
    }

    console.log(`[CANDY STATUS] YMID ${ymid}: blocked=${blocked}, claimable=${claimable}, abilities=${cascade}/${timeFreeze}/${doublePoints}, cooldown=${inCooldown}(${remainingSeconds}s)`);

    return res.json({
      success: true,
      blocked,
      claimable,
      remaining_seconds: remainingSeconds,
      in_cooldown: inCooldown,
      message,
      abilities: { cascade, time_freeze: timeFreeze, double_points: doublePoints },
      all_abilities_zero: allZero
    });
  } catch (err) {
    console.error(`[CANDY STATUS] Erro DB para YMID ${ymid}:`, err.message);
    return res.json({
      success: true,
      blocked: false,
      claimable: false,
      remaining_seconds: 0,
      in_cooldown: false,
      message: 'Erro ao verificar status, liberado por seguranca',
      abilities: { cascade: 0, time_freeze: 0, double_points: 0 },
      all_abilities_zero: true
    });
  }
});

// ================================================================
// CANDY COMPLETE: Direto no banco MySQL
// Marca como claimable após assistir anúncio
// ================================================================
app.post('/api/candy/complete', async (req, res) => {
  const ymid = parseInt(req.body.ymid);

  if (!ymid || ymid <= 0) {
    return res.json({ success: false, error: 'ymid obrigatorio' });
  }

  try {
    const db = await getWorkingPool();
    await ensureTables(db);

    // 1. Verificar se já tem recompensa pendente
    const [cooldownRows] = await db.query('SELECT claimable, cooldown_until FROM candy_cooldowns WHERE ymid = ?', [ymid]);

    if (cooldownRows.length > 0 && Boolean(cooldownRows[0].claimable)) {
      return res.json({
        success: false,
        blocked: true,
        claimable: true,
        message: 'Voce ja tem uma recompensa pendente. Resgate primeiro!'
      });
    }

    // 1b. Verificar cooldown
    if (cooldownRows.length > 0 && cooldownRows[0].cooldown_until) {
      const cooldownUntil = new Date(cooldownRows[0].cooldown_until);
      const now = new Date();
      if (now < cooldownUntil) {
        const remainingSeconds = Math.ceil((cooldownUntil - now) / 1000);
        const minutes = Math.ceil(remainingSeconds / 60);
        return res.json({
          success: false,
          blocked: true,
          claimable: false,
          in_cooldown: true,
          remaining_seconds: remainingSeconds,
          message: `Aguarde ${minutes} minuto(s) para assistir novamente`
        });
      }
    }

    // 2. Verificar se habilidades estão todas em 0
    const [abilityRows] = await db.query('SELECT cascade_charges, time_freeze_charges, double_points_charges FROM game_abilities WHERE user_id = ?', [ymid]);

    if (abilityRows.length > 0) {
      const { cascade_charges, time_freeze_charges, double_points_charges } = abilityRows[0];
      if (cascade_charges > 0 || time_freeze_charges > 0 || double_points_charges > 0) {
        return res.json({
          success: false,
          blocked: true,
          claimable: false,
          message: 'Use todas as habilidades antes de assistir novamente',
          abilities: {
            cascade: cascade_charges,
            time_freeze: time_freeze_charges,
            double_points: double_points_charges
          }
        });
      }
    }

    // 3. Marcar como claimable
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    if (cooldownRows.length > 0) {
      await db.query('UPDATE candy_cooldowns SET completed_at = ?, claimable = 1 WHERE ymid = ?', [now, ymid]);
    } else {
      await db.query('INSERT INTO candy_cooldowns (ymid, completed_at, claimable) VALUES (?, ?, 1)', [ymid, now]);
    }

    console.log(`[CANDY COMPLETE] YMID ${ymid} completou anuncio! Resgate PENDENTE.`);

    // Também registrar impressão no backend (fire-and-forget)
    try {
      axios.get(`${RAILWAY_API}/monetag/postback.php?type=impression&user_id=${encodeURIComponent(ymid)}&source=candy`, {
        timeout: 5000
      }).catch(() => {});
    } catch (e) {}

    return res.json({
      success: true,
      message: 'Anuncio registrado! Resgate sua recompensa.',
      claimable: true,
      abilities_restored: false
    });
  } catch (err) {
    console.error(`[CANDY COMPLETE] Erro DB para YMID ${ymid}:`, err.message);
    return res.json({ success: false, error: 'Erro ao registrar anuncio' });
  }
});

// ================================================================
// CANDY CLAIM: Resgate MANUAL direto no banco MySQL
// Após o claim, inicia cooldown de 1 hora antes de poder assistir novamente
// ================================================================
app.post('/api/candy/claim', async (req, res) => {
  const ymid = parseInt(req.body.ymid);

  if (!ymid || ymid <= 0) {
    return res.json({ success: false, error: 'ymid obrigatorio' });
  }

  try {
    const db = await getWorkingPool();
    await ensureTables(db);

    // 1. Verificar se tem recompensa pendente
    const [cooldownRows] = await db.query('SELECT completed_at, claimable FROM candy_cooldowns WHERE ymid = ?', [ymid]);

    if (cooldownRows.length === 0) {
      return res.json({
        success: false,
        error: 'Nenhum anuncio assistido. Assista um anuncio primeiro.',
        claimable: false
      });
    }

    if (!Boolean(cooldownRows[0].claimable)) {
      return res.json({
        success: false,
        error: 'Recompensa ja foi resgatada. Assista outro anuncio.',
        claimable: false
      });
    }

    // 2. Marcar como resgatado E iniciar cooldown de 1 hora
    const cooldownUntil = new Date(Date.now() + CANDY_COOLDOWN_SECONDS * 1000);
    const cooldownUntilStr = cooldownUntil.toISOString().slice(0, 19).replace('T', ' ');
    
    await db.query('UPDATE candy_cooldowns SET claimable = 0, cooldown_until = ? WHERE ymid = ?', [cooldownUntilStr, ymid]);

    // 3. Verificar se usuário existe
    const [userRows] = await db.query('SELECT id FROM users WHERE id = ?', [ymid]);
    if (userRows.length === 0) {
      return res.json({
        success: false,
        error: 'Usuario nao encontrado',
        claimable: false
      });
    }

    // 4. Creditar habilidades
    const [existingAbility] = await db.query('SELECT id FROM game_abilities WHERE user_id = ?', [ymid]);

    if (existingAbility.length > 0) {
      await db.query(
        'UPDATE game_abilities SET cascade_charges = ?, time_freeze_charges = ?, double_points_charges = ? WHERE user_id = ?',
        [RESTORE_CASCADE, RESTORE_TIME_FREEZE, RESTORE_DOUBLE_POINTS, ymid]
      );
    } else {
      await db.query(
        'INSERT INTO game_abilities (user_id, cascade_charges, time_freeze_charges, double_points_charges) VALUES (?, ?, ?, ?)',
        [ymid, RESTORE_CASCADE, RESTORE_TIME_FREEZE, RESTORE_DOUBLE_POINTS]
      );
    }

    console.log(`[CANDY CLAIM] YMID=${ymid} resgatou! cascade=${RESTORE_CASCADE}, freeze=${RESTORE_TIME_FREEZE}, double=${RESTORE_DOUBLE_POINTS}. Cooldown ate ${cooldownUntilStr}`);

    return res.json({
      success: true,
      message: 'Recompensa resgatada com sucesso!',
      claimable: false,
      abilities_restored: true,
      cooldown_until: cooldownUntil.toISOString(),
      remaining_seconds: CANDY_COOLDOWN_SECONDS,
      data: {
        user_id: ymid,
        cascade: RESTORE_CASCADE,
        time_freeze: RESTORE_TIME_FREEZE,
        double_points: RESTORE_DOUBLE_POINTS
      }
    });
  } catch (err) {
    console.error(`[CANDY CLAIM] Erro DB para YMID ${ymid}:`, err.message);
    return res.json({ success: false, error: 'Erro ao resgatar recompensa' });
  }
});

// Rota para candy (pagina separada)
app.get('/candy', (req, res) => {
  res.sendFile(path.join(publicPath, 'candy.html'));
});

// Rota para candy com YMID no path (ex: /candy/123456)
app.get('/candy/:ymid', (req, res) => {
  res.sendFile(path.join(publicPath, 'candy.html'));
});

// Rota para roleta com YMID no path (ex: /123456)
app.get('/:ymid(\\d+)', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: NODE_ENV === 'development' ? err.message : 'An error occurred'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Young Money Server`);
  console.log(`📍 Running on http://localhost:${PORT}`);
  console.log(`🔧 Environment: ${NODE_ENV}`);
  console.log(`🌐 Proxy: DataImpulse (Russia) - ${PROXY_HOST}:${PROXY_PORT}`);
  console.log(`🍬 Candy: bloqueio por habilidades + cooldown de ${CANDY_COOLDOWN_SECONDS/3600}h (resgate MANUAL)`);
  console.log(`💾 DB: conexao direta MySQL`);
  console.log(`\n✅ Server ready to accept connections\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  if (pool) pool.end();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  if (pool) pool.end();
  process.exit(0);
});
