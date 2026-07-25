/**
 * End-to-end UI flow: customer portal activity → date/time → participants → ticket summary → payment button.
 *
 * Prerequisites:
 *   1. Seed data: `npx supabase db query --linked -f scripts/seed-booking-e2e-test-business.sql`
 *   2. Dev server (use the URL from your Vite terminal): `npm run dev`
 *   3. Anon key / Supabase env in the app so the portal can load (same as normal local dev).
 *
 * The script injects a portal session (sessionStorage) so OTP is skipped — same mechanism as returning customers.
 * Completing Helcim card payment is NOT automated (hosted iframe + sandbox keys); we stop after "Pay with card" is enabled.
 *
 * Env:
 *   E2E_BASE_URL       default http://localhost:5173
 *   E2E_BUSINESS_ID    default dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7
 *   E2E_ACTIVITY_ID    default 11111111-1111-4111-8111-111111111102
 *   E2E_CUSTOMER_ID    default 11111111-1111-4111-8111-111111111104
 *   E2E_START_DEV      default "0" — set to "1" to spawn `npm run dev` on port 5173 (best effort)
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const BUSINESS_ID = process.env.E2E_BUSINESS_ID || 'dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7';
const ACTIVITY_ID = process.env.E2E_ACTIVITY_ID || '11111111-1111-4111-8111-111111111102';
const CUSTOMER_ID = process.env.E2E_CUSTOMER_ID || '11111111-1111-4111-8111-111111111104';
const START_DEV = process.env.E2E_START_DEV === '1';

function activityUrl(base) {
  const u = String(base).replace(/\/$/, '');
  return `${u}/customer-portal/${BUSINESS_ID}/portal/${ACTIVITY_ID}`;
}

async function waitForHttpOk(url, attempts = 60, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function main() {
  let devProc = null;
  try {
  if (START_DEV) {
    let devPort = '5173';
    try {
      const u = new URL(BASE_URL);
      if (u.port) devPort = u.port;
    } catch {
      /* keep default */
    }
    console.log(`[e2e:booking] Starting Vite on port ${devPort} …`);
    devProc = spawn('npm', ['run', 'dev', '--', '--port', devPort, '--strictPort'], {
      cwd: root,
      shell: true,
      detached: false,
      stdio: 'pipe',
    });
    const ok = await waitForHttpOk(`${BASE_URL.replace(/\/$/, '')}/`);
    if (!ok) {
      console.error(`Dev server did not respond at ${BASE_URL}. Start npm run dev manually or fix E2E_BASE_URL.`);
      process.exitCode = 1;
      return;
    }
  } else {
    const ping = await waitForHttpOk(`${BASE_URL.replace(/\/$/, '')}/`, 5, 200);
    if (!ping) {
      console.warn(
        `[e2e:booking] No server at ${BASE_URL}. Start Vite (npm run dev) or set E2E_BASE_URL to your running app URL.`,
      );
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  await context.addInitScript(
    ({ businessId, customerId }) => {
      const key = `customer-portal-session:${businessId}`;
      const payload = {
        id: customerId,
        phone: '5551234567',
        email: 'christian.dj.fournier@outlook.com',
        customer_email: 'christian.dj.fournier@outlook.com',
        customer_name: 'Christian Fournier',
      };
      window.sessionStorage.setItem(key, JSON.stringify(payload));
    },
    { businessId: BUSINESS_ID, customerId: CUSTOMER_ID },
  );

  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.warn('[browser console]', msg.text());
    }
  });

  const target = activityUrl(BASE_URL);
  console.log(`Navigating to ${target}`);

  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: /E2E Test Activity/i }).waitFor({ state: 'visible', timeout: 30000 });

  await page.getByRole('button', { name: 'Select Date' }).click();

  await page.getByTestId('portal-calendar-selectable-day').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('portal-calendar-selectable-day').first().click();

  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByText(/Select Time/i).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('portal-time-slot-selectable').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('portal-time-slot-selectable').first().click();
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByRole('heading', { name: 'Select Participants' }).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: 'Next' }).click();

  const waiverTitle = page.getByText('Waiver required');
  if (await waiverTitle.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Skip for now' }).click();
  }

  await page.getByText(/Confirm participants/i).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByRole('button', { name: 'Pay with card' }).waitFor({ state: 'visible', timeout: 30000 });
  console.log('Reached ticket / payment step (Pay with card visible). Helcim iframe not automated.');

  await browser.close();
  console.log('E2E booking payment flow: OK (through payment button).');
  } finally {
    if (devProc) {
      try {
        devProc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
