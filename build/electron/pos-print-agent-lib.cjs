/**
 * Shared POS receipt print agent (CommonJS).
 * Used by tools/pos-print-agent/server.mjs (CLI) and the Electron tray app.
 */

const http = require('http');
const net = require('net');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 19100;
const DEFAULT_TIMEOUT_MS = 10000;

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://tavari.ca',
  'https://www.tavari.ca',
  'https://app.tavari.ca',
  'https://tavarios.ca',
  'https://www.tavarios.ca',
];

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin.endsWith('.tavari.ca') || origin.endsWith('.tavarios.ca')) return true;
  if (origin.endsWith('.vercel.app')) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const allowOrigin = isAllowedOrigin(origin) ? origin || '*' : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Access-Control-Request-Private-Network',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

function sendJson(res, statusCode, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isPrivateOrLocalHost(host) {
  const value = String(host || '').trim().toLowerCase();
  if (!value) return false;
  if (value === 'localhost' || value === '127.0.0.1') return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
  return false;
}

function sendToPrinter(host, port, data, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write(data, (writeErr) => {
        if (writeErr) {
          socket.destroy();
          reject(writeErr);
          return;
        }
        socket.end();
      });
    });

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Printer timeout after ${timeoutMs}ms (${host}:${port})`));
    }, timeoutMs);

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.on('close', (hadError) => {
      clearTimeout(timer);
      if (!hadError) resolve(true);
    });
  });
}

/**
 * Start the local print bridge.
 * @returns {{ server: import('http').Server, host: string, port: number, stop: () => Promise<void> }}
 */
function startPrintAgent(options = {}) {
  const host = options.host || process.env.POS_PRINT_AGENT_HOST || DEFAULT_HOST;
  const port = Number.parseInt(options.port || process.env.POS_PRINT_AGENT_PORT || DEFAULT_PORT, 10);
  const timeoutMs = Number.parseInt(
    options.timeoutMs || process.env.POS_PRINT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
    10
  );
  const log = typeof options.log === 'function' ? options.log : console.log.bind(console);
  const logError = typeof options.logError === 'function' ? options.logError : console.error.bind(console);

  const server = http.createServer(async (req, res) => {
    const headers = corsHeaders(req);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${host}:${port}`);
    const pathname = String(url.pathname || '/').replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
      sendJson(res, 200, { ok: true, service: 'tavari-pos-print-agent', port }, headers);
      return;
    }

    if (req.method === 'POST' && pathname === '/print') {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw.toString('utf8') || '{}');
        const printerHost = String(body.host || '').trim();
        const printerPort = Number.parseInt(body.port, 10);
        const dataBase64 = body.dataBase64;

        if (!printerHost || !Number.isFinite(printerPort) || printerPort < 1 || printerPort > 65535) {
          sendJson(res, 400, { ok: false, error: 'Valid host and port are required' }, headers);
          return;
        }

        if (!isPrivateOrLocalHost(printerHost)) {
          sendJson(res, 400, { ok: false, error: 'Printer host must be a private/LAN address' }, headers);
          return;
        }

        if (!dataBase64 || typeof dataBase64 !== 'string') {
          sendJson(res, 400, { ok: false, error: 'dataBase64 is required' }, headers);
          return;
        }

        const data = Buffer.from(dataBase64, 'base64');
        if (!data.length) {
          sendJson(res, 400, { ok: false, error: 'Print payload is empty' }, headers);
          return;
        }

        await sendToPrinter(printerHost, printerPort, data, timeoutMs);
        log(`[pos-print-agent] Printed ${data.length} bytes to ${printerHost}:${printerPort}`);
        sendJson(res, 200, { ok: true, bytes: data.length, host: printerHost, port: printerPort }, headers);
      } catch (err) {
        logError('[pos-print-agent] Print failed:', err.message || err);
        sendJson(res, 502, { ok: false, error: err.message || 'Print failed' }, headers);
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found' }, headers);
  });

  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      log(`[pos-print-agent] Listening on http://${host}:${port}`);
      resolve();
    });
  });

  return {
    server,
    host,
    port,
    ready,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

module.exports = {
  startPrintAgent,
  DEFAULT_HOST,
  DEFAULT_PORT,
};
