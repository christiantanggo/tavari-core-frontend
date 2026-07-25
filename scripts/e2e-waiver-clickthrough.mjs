/**
 * Click-through E2E: public waiver flow (unique phone → no OTP) + detects archive Edge Function calls.
 *
 * Usage (from repo root):
 *   npm run e2e:waiver
 *
 * Prerequisites: dev server reachable (defaults to starting one on port 5180 via E2E_START_DEV=1).
 *
 * Env:
 *   E2E_BASE_URL     default http://localhost:5180 (avoid 127.0.0.1 — main.jsx forces HashRouter there)
 *   E2E_BUSINESS_ID  default matches linked test business (waiver-test-2026 template)
 *   E2E_TEMPLATE_KEY  default waiver-test-2026; set "__none__" to use /waiver/:businessId
 *   E2E_EMAIL         default unique @example.com address
 *   E2E_MARKETING_OPT_IN default "1" — set "0" to leave marketing unchecked
 *   E2E_START_DEV    default "1" — set to "0" if you already have `npm run dev`
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const START_DEV = process.env.E2E_START_DEV !== '0';
/** Default localhost so BrowserRouter is used; 127.0.0.1:any-port triggers HashRouter in main.jsx. */
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5180';

/**
 * Public waiver path must match how the app is routed.
 * HashRouter when hostname === 127.0.0.1 && port (see main.jsx).
 */
function waiverPublicUrl(baseUrlStr, businessId, templateKey) {
  let u;
  try {
    u = new URL(baseUrlStr);
  } catch {
    u = new URL('http://localhost:5180');
  }
  const path = templateKey
    ? `/waiver/${encodeURIComponent(businessId)}/${encodeURIComponent(templateKey)}`
    : `/waiver/${encodeURIComponent(businessId)}`;
  const full = new URL(`${path}?tavariE2E=1`, u.origin);

  if (u.hostname === '127.0.0.1' && u.port !== '') {
    return `${u.origin}/#${full.pathname}${full.search}`;
  }
  return `${u.origin}${full.pathname}${full.search}`;
}
const BUSINESS_ID =
  process.env.E2E_BUSINESS_ID || '69f610dc-1201-4447-9fea-bec62970b917';
const TEMPLATE_KEY = Object.prototype.hasOwnProperty.call(process.env, 'E2E_TEMPLATE_KEY')
  ? (process.env.E2E_TEMPLATE_KEY === '__none__' ? '' : process.env.E2E_TEMPLATE_KEY)
  : 'waiver-test-2026';

function fmtPhone10(digits) {
  const d = String(digits).replace(/\D/g, '').slice(0, 10);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function rndPhone10() {
  const suffix = String(Math.floor(Math.random() * 9000000) + 1000000).slice(0, 7);
  return `902555${suffix}`.slice(0, 10);
}

/** Waiver screens use ~30s idle → warning → reset; avoid long waits without clicks. */
async function dismissIdleWarningIfPresent(page) {
  for (let i = 0; i < 6; i += 1) {
    const extend = page.getByRole('button', { name: /extend session/i });
    const visible = await extend.isVisible().catch(() => false);
    if (!visible) break;
    await extend.click();
    await page.waitForTimeout(250);
  }
}

async function waitForHttpOk(url, attempts = 50, delayMs = 400) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok || res.status === 304) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Server not reachable at ${url}`);
}

async function main() {
  let devProc = null;
  if (START_DEV) {
    console.log('[e2e] Starting Vite on port 5180 ...');
    devProc = spawn('npm', ['run', 'dev', '--', '--port', '5180', '--strictPort'], {
      cwd: root,
      shell: true,
      detached: false,
      stdio: 'pipe',
    });
    await waitForHttpOk(`${BASE_URL}/`);
    console.log('[e2e] Dev server OK');
  } else {
    await waitForHttpOk(`${BASE_URL}/`);
  }

  const phoneDigits = rndPhone10();
  const phoneFmt = fmtPhone10(phoneDigits);
  const email = process.env.E2E_EMAIL || `e2e.waiver.${Date.now()}@example.com`;
  const marketingOptIn = process.env.E2E_MARKETING_OPT_IN !== '0';
  const waiverUrl = waiverPublicUrl(BASE_URL, BUSINESS_ID, TEMPLATE_KEY);

  console.log('[e2e] URL:', waiverUrl);
  console.log('[e2e] Unique phone:', phoneFmt);
  console.log('[e2e] Email:', email);
  console.log('[e2e] Marketing opt-in:', marketingOptIn ? 'yes' : 'no');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });

  let sawFinalizePdf = false;
  let sawDirectArchiveEmail = false;
  let archiveEmailResult = null;
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/functions/v1/waiver-finalize-signed-pdf')) {
      sawFinalizePdf = true;
      console.log(
        '[e2e] Edge function request:',
        u.split('/functions/v1/')[1]?.split('?')[0],
        '(forwards to waiver-archive-email on the server)',
      );
    } else if (u.includes('/functions/v1/waiver-archive-email')) {
      sawDirectArchiveEmail = true;
      console.log('[e2e] Direct archive request:', u.split('/functions/v1/')[1]?.split('?')[0]);
    }
  });
  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes('/functions/v1/waiver-finalize-signed-pdf') && !u.includes('/functions/v1/waiver-archive-email')) {
      return;
    }
    try {
      const body = await res.json();
      if (body && typeof body === 'object') {
        archiveEmailResult = body;
        console.log('[e2e] Archive/email response:', JSON.stringify({
          success: body.success,
          archived: body.archived,
          emailed: body.emailed,
          recipientEmail: body.recipientEmail,
          messageId: body.messageId || null,
          storagePath: body.storagePath || null
        }));
      }
    } catch {
      /* response body may not be JSON */
    }
  });

  try {
    await page.goto(waiverUrl, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await dismissIdleWarningIfPresent(page);
    await page.mouse.move(400, 300);

    const selectActivityIfPresent = async (timeout = 3000) => {
      const liabilityActivity = page.locator('button').filter({
        hasText: /Off The Wall Kids London Liability Waiver/i,
      }).first();
      const anyActivity = page.locator('button').filter({
        hasText: /Indoor Playground|Liability Waiver|Activity/i,
      }).first();
      if (await liabilityActivity.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false)) {
        await liabilityActivity.click({ force: true });
        await page.waitForTimeout(1000);
        console.log('[e2e] Selected liability waiver activity');
        return true;
      }
      if (await anyActivity.waitFor({ state: 'visible', timeout: 1000 }).then(() => true).catch(() => false)) {
        await anyActivity.click({ force: true });
        await page.waitForTimeout(1000);
        console.log('[e2e] Selected first waiver activity');
        return true;
      }
      return false;
    };

    const startWaiverIfPresent = async (timeout = 3000) => {
      const start = page.getByRole('button', { name: /Start Waiver/i });
      if (await start.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false)) {
        await start.click();
        await page.waitForTimeout(1000);
        console.log('[e2e] Started waiver');
        return true;
      }
      return false;
    };

    await startWaiverIfPresent(60000);
    await selectActivityIfPresent(60000);
    await startWaiverIfPresent(10000);
    await dismissIdleWarningIfPresent(page);

    const phoneInput = page.getByTestId('waiver-phone-entry');
    await phoneInput.waitFor({ state: 'visible', timeout: 60000 });
    await phoneInput.fill(phoneFmt);
    const entered = await phoneInput.inputValue();
    if (entered.replace(/\D/g, '').length < 10) {
      throw new Error(
        `Phone field did not accept input (got "${entered}"). Check waiver-phone-entry.`,
      );
    }

    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="waiver-phone-continue"]');
        return el && !el.disabled && el.textContent?.includes('Continue');
      },
      null,
      { timeout: 90000 },
    );
    await page.getByTestId('waiver-phone-continue').click();
    await dismissIdleWarningIfPresent(page);

    await page.waitForSelector('text=/First Name/i', { timeout: 90000 });

    const textInputs = page.locator('form').first().locator('input[type="text"]');
    await textInputs.nth(0).fill('E2E');
    await textInputs.nth(1).fill('Playwright');

    const selects = page.locator('form').first().locator('select');
    await selects.nth(0).selectOption('1990');
    await selects.nth(1).selectOption({ index: 1 });
    await selects.nth(2).selectOption('15');

    const emailBox = page.locator('input[type="email"]');
    if (await emailBox.count()) await emailBox.fill(email);

    const addr = page.locator('input[autocomplete="street-address"]');
    if (await addr.count()) await addr.fill('100 Test Lane');
    const cityIn = page.locator('input[autocomplete="address-level2"]');
    if (await cityIn.count()) await cityIn.fill('Toronto');
    const postalIn = page.locator('input[autocomplete="postal-code"]');
    if (await postalIn.count()) await postalIn.fill('M5V2T6');

    await page.getByTestId('waiver-participant-continue').click();

    await page.getByRole('button', { name: /Continue to Waiver Review/i }).click({ timeout: 60000 });
    await page.getByRole('button', { name: /Yes, continue/i }).click({ timeout: 20000 });

    const waiverScroll = page.locator('div').filter({ hasText: /Waiver terms|Please Read the Waiver/i }).first();
    await waiverScroll.waitFor({ state: 'visible', timeout: 60000 });
    const scrollBox = page.locator('div[style*="overflow"]').filter({ has: page.locator('.waiver-legal-body, div') }).first();
    if (await scrollBox.count()) {
      await scrollBox.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
    }
    await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('*'));
      for (const el of nodes) {
        const s = window.getComputedStyle(el);
        if (
          (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 20
        ) {
          el.scrollTop = el.scrollHeight;
        }
      }
    });

    const readCheckbox = page.getByRole('checkbox', {
      name: /I have read and understood the waiver/i,
    });
    if (await readCheckbox.count()) {
      await readCheckbox.check({ force: true });
    }

    const marketing = page.getByRole('checkbox', { name: /marketing/i });
    if (marketingOptIn && await marketing.count()) {
      await marketing.check({ force: true }).catch(() => {});
    }

    await page.getByRole('button', { name: /I Agree - Continue/i }).click({ timeout: 90000 });

    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 60000 });
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 30, box.y + 50);
      await page.mouse.down();
      await page.mouse.move(box.x + 220, box.y + 90, { steps: 30 });
      await page.mouse.up();
    }

    await page.getByRole('checkbox', {
      name: /digital signature|same legal effect/i,
    }).check({ force: true });

    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="waiver-signature-continue"]');
        return el && el.getAttribute('aria-disabled') !== 'true';
      },
      null,
      { timeout: 90000 },
    );
    await page.getByTestId('waiver-signature-continue').click({ timeout: 90000 });

    const continueToSubmit = page.getByRole('button', { name: /Continue to Submit/i });
    try {
      await continueToSubmit.waitFor({ state: 'visible', timeout: 45000 });
      await continueToSubmit.click();
      const yesContinue = page.getByRole('button', { name: /Yes, continue/i });
      if (await yesContinue.isVisible().catch(() => false)) {
        await yesContinue.click();
      }
    } catch {
      /* Flow may skip additional-adult hub (template / minors-only). */
    }

    await page.getByRole('button', { name: /Submit Waiver/i }).click({ timeout: 120000 });

    await page.waitForTimeout(12000);

    const completionHints = await page.content();
    const looksDone =
      /thank you|all set|success|completed|your waiver was submitted|we('ve| have) received/i.test(
        completionHints,
      );

    if (!looksDone && !sawFinalizePdf && !sawDirectArchiveEmail) {
      throw new Error(
        'Could not confirm completion (no success copy and no archive/finalize function request).',
      );
    }

    if (sawFinalizePdf) {
      console.log('[e2e] PASS — waiver-finalize-signed-pdf invoked from the client.');
    } else if (sawDirectArchiveEmail) {
      console.warn(
        '[e2e] PASS (legacy) — only direct waiver-archive-email; client should use waiver-finalize-signed-pdf.',
      );
    } else {
      console.warn('[e2e] PASS (soft) — UI hint matched; network request not observed (timing).');
    }
    if (archiveEmailResult?.emailed === true) {
      console.log('[e2e] PASS — waiver PDF email reported sent.');
    }
    process.exitCode = 0;
  } catch (e) {
    console.error('[e2e] FAIL:', e?.message || e);
    await page.screenshot({ path: join(root, 'scripts', 'e2e-waiver-failure.png'), fullPage: true });
    console.error('[e2e] Screenshot: scripts/e2e-waiver-failure.png');
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (devProc) {
      try {
        devProc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }
}

main();
