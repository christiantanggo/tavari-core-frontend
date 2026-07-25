/**
 * Vercel Serverless Function: render-pay-statement-pdf
 *
 * Renders a full HTML document into a PDF using a real headless Chromium
 * (puppeteer-core + @sparticuz/chromium). This is the SAME rendering engine
 * the user's browser uses when they click "Print > Save as PDF" — so the
 * resulting PDF is byte-equivalent to the fast download path.
 *
 * Used by:
 *   src/utils/htmlDocumentPdf.js (shared HTML → PDF pipeline)
 *     - getHtmlDocumentPdfBlob
 *     - downloadHtmlDocumentPdf
 *   src/utils/payStatementPdf.js
 *     - downloadPayStatementPdf / getPayStatementPdfBlob
 *   src/utils/contractPdf.js
 *     - downloadContractPdf / getContractPdfBlob
 *
 * Both flows hit this single endpoint, so the email PDF and the download PDF
 * are produced by the same renderer with the same settings, guaranteeing
 * visual parity.
 */

import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';

// Vercel Fluid Compute omits Lambda runtime vars @sparticuz/chromium uses to unpack libs.
if (process.env.VERCEL && !process.env.AWS_LAMBDA_JS_RUNTIME) {
  process.env.AWS_LAMBDA_JS_RUNTIME = 'nodejs22.x';
}

export const config = {
  maxDuration: 60,
};

const IS_SERVERLESS = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT ||
  process.env.NETLIFY
);

/**
 * Find a Chromium-flavored browser binary for local dev. @sparticuz/chromium
 * only ships a Linux x64 binary that runs on Vercel/Lambda, so when the
 * function runs on the developer's machine we fall back to whichever Chrome
 * or Edge install we can find.
 */
function findLocalBrowserExecutable() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const candidates = (() => {
    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || '';
      const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      return [
        `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
        `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
        `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
        `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ];
    }
    if (process.platform === 'darwin') {
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ];
    }
    return [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ];
  })();

  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) return candidate;
    } catch {
      // ignore — try next candidate
    }
  }
  return null;
}

async function buildLaunchOptions() {
  if (IS_SERVERLESS) {
    const executablePath = await chromium.executablePath();
    const execDir = dirname(executablePath);
    if (execDir && !process.env.LD_LIBRARY_PATH?.includes(execDir)) {
      process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
        ? `${execDir}:${process.env.LD_LIBRARY_PATH}`
        : execDir;
    }
    return {
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    };
  }

  const executablePath = findLocalBrowserExecutable();
  if (!executablePath) {
    throw new Error(
      'Local browser not found. Install Google Chrome (or set PUPPETEER_EXECUTABLE_PATH), or test against the deployed Vercel URL.'
    );
  }
  return {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 816, height: 1056, deviceScaleFactor: 2 },
    executablePath,
    headless: true,
  };
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_AUTH_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

const ALLOWED_FORMATS = new Set(['letter', 'legal', 'a4']);
const DEFAULT_MARGIN = '0';
const MAX_HTML_BYTES = 4 * 1024 * 1024;

function sendJson(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function safeFilename(input) {
  if (!input || typeof input !== 'string') return 'pay-statement.pdf';
  let name = input.trim().replace(/[\\/:*?"<>|\r\n\t]+/g, '_');
  if (!/\.pdf$/i.test(name)) name += '.pdf';
  if (name.length > 200) name = name.slice(0, 196) + '.pdf';
  return name;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return await new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_HTML_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_AUTH_KEY) {
    sendJson(res, 500, {
      error: 'Server misconfigured',
      detail: 'SUPABASE_URL or Supabase auth key env var missing on Vercel',
    });
    return;
  }

  // Auth: validate caller's Supabase access token. This endpoint only needs to
  // verify the user's JWT before rendering caller-provided HTML, so the anon key
  // is sufficient; service role is optional for deployments that already have it.
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    sendJson(res, 401, { error: 'Missing authorization header' });
    return;
  }
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  try {
    const authClient = createClient(SUPABASE_URL, SUPABASE_AUTH_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData?.user?.id) {
      sendJson(res, 401, { error: 'Invalid or expired token' });
      return;
    }
  } catch (authVerifyError) {
    console.error('[render-pay-statement-pdf] Auth verification failed:', authVerifyError);
    sendJson(res, 401, { error: 'Failed to verify token' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (parseError) {
    sendJson(res, 400, { error: 'Invalid JSON body', detail: parseError.message });
    return;
  }

  const html = body?.html;
  if (typeof html !== 'string' || html.trim().length === 0) {
    sendJson(res, 400, { error: 'Missing required field: html' });
    return;
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    sendJson(res, 413, { error: 'HTML payload too large' });
    return;
  }

  const filename = safeFilename(body?.filename);
  const requestedFormat = String(body?.format || 'letter').toLowerCase();
  const format = ALLOWED_FORMATS.has(requestedFormat) ? requestedFormat : 'letter';
  const marginRaw = body?.margin;
  const margin = {
    top: marginRaw?.top || DEFAULT_MARGIN,
    bottom: marginRaw?.bottom || DEFAULT_MARGIN,
    left: marginRaw?.left || DEFAULT_MARGIN,
    right: marginRaw?.right || DEFAULT_MARGIN,
  };

  let browser;
  try {
    const launchOptions = await buildLaunchOptions();
    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 1 });

    // Screen layout is more reliable than print emulation on Vercel Chromium for this template.
    await page.setContent(html, { waitUntil: ['load', 'domcontentloaded'] });

    // Make sure web fonts inside the loaded document are ready before printing,
    // otherwise Chromium can render with a fallback font on the first paint.
    await page.evaluate(async () => {
      if (document.fonts && typeof document.fonts.ready?.then === 'function') {
        await document.fonts.ready;
      }
    });

    const pdfBuffer = await page.pdf({
      format,
      printBackground: true,
      // @page size in HTML; margins come from Puppeteer only (avoid double-margin clip on Vercel Chromium).
      preferCSSPageSize: false,
      margin,
    });

    await page.close();
    await browser.close();
    browser = null;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).end(pdfBuffer);
  } catch (renderError) {
    console.error('[render-pay-statement-pdf] Render failed:', renderError);
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.warn('[render-pay-statement-pdf] Browser close after error failed:', closeError);
      }
    }
    sendJson(res, 500, {
      error: 'PDF render failed',
      detail: renderError?.message || String(renderError),
    });
  }
}
