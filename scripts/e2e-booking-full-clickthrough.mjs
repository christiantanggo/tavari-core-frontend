/**
 * Full booking-module click-through (customer portal).
 *
 * Prerequisites:
 *   npx supabase db query --linked -f scripts/seed-booking-e2e-test-business.sql
 *   npx supabase db query --linked -f scripts/seed-booking-e2e-age-restriction.sql
 *   npx vite --port 5180 --strictPort   (use localhost — not 127.0.0.1)
 *
 * Usage:
 *   node scripts/e2e-booking-full-clickthrough.mjs
 *
 * Env:
 *   E2E_BASE_URL     default http://localhost:5180
 *   E2E_BUSINESS_ID  default dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7
 */
import { chromium } from 'playwright';

const BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:5180').replace(/\/$/, '');
const BUSINESS_ID = process.env.E2E_BUSINESS_ID || 'dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7';
const CUSTOMER_ID = process.env.E2E_CUSTOMER_ID || '11111111-1111-4111-8111-111111111104';
const ACTIVITY_HAPPY = process.env.E2E_ACTIVITY_ID || '11111111-1111-4111-8111-111111111102';
const ACTIVITY_AGE = process.env.E2E_AGE_ACTIVITY_ID || '11111111-1111-4111-8111-111111111106';

const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const icon = ok ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForHttpOk(url, attempts = 40, delayMs = 500) {
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

async function injectPortalSession(context) {
  await context.addInitScript(
    ({ businessId, customerId }) => {
      const key = `customer-portal-session:${businessId}`;
      window.sessionStorage.setItem(
        key,
        JSON.stringify({
          id: customerId,
          phone: '5551234567',
          email: 'christian.dj.fournier@outlook.com',
          customer_email: 'christian.dj.fournier@outlook.com',
          customer_name: 'Christian Fournier',
        }),
      );
    },
    { businessId: BUSINESS_ID, customerId: CUSTOMER_ID },
  );
}

async function pickDateAndTime(page) {
  await page.getByRole('button', { name: 'Select Date' }).click();
  await page.getByTestId('portal-calendar-selectable-day').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('portal-calendar-selectable-day').first().click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText(/Select Time/i).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('portal-time-slot-selectable').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('portal-time-slot-selectable').first().click();
  await page.getByRole('button', { name: 'Next' }).click();
}

async function skipWaiverIfShown(page) {
  const skip = page.getByRole('button', { name: 'Skip for now' });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

async function confirmParticipantsAndOpenTickets(page) {
  await page.getByText(/Confirm participants/i).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: 'Next' }).click();
}

async function toggleParticipantByName(page, nameFragment, shouldCheck) {
  const row = page.locator('div').filter({ hasText: new RegExp(nameFragment, 'i') }).filter({
    has: page.locator('[data-participant-checkbox]'),
  }).first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  const box = row.locator('[data-participant-checkbox]').first();
  const checked = await box.locator('input[type="checkbox"]').first().isChecked().catch(() => false);
  if (checked !== shouldCheck) {
    await box.click();
  }
}

async function runHappyPathBooking(context) {
  const page = await context.newPage();
  try {
    const url = `${BASE_URL}/customer-portal/${BUSINESS_ID}/portal/${ACTIVITY_HAPPY}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('heading', { name: /E2E Test Activity/i }).waitFor({ state: 'visible', timeout: 30000 });
    record('Activity detail page loads', true);

    await pickDateAndTime(page);
    record('Date and time selection', true);

    await page.getByRole('heading', { name: 'Select Participants' }).waitFor({ state: 'visible', timeout: 15000 });
    await page.getByRole('button', { name: 'Next' }).click();
    await skipWaiverIfShown(page);
    await confirmParticipantsAndOpenTickets(page);

    const payBtn = page.getByRole('button', { name: 'Pay with card' });
    await payBtn.waitFor({ state: 'visible', timeout: 30000 });
    const disabled = await payBtn.isDisabled();
    record('Happy path: Pay with card enabled', !disabled, disabled ? 'button disabled' : '');
  } catch (err) {
    record('Happy path booking flow', false, err.message);
  } finally {
    await page.close();
  }
}

async function runAgeRestrictionBlock(context) {
  const page = await context.newPage();
  try {
    const url = `${BASE_URL}/customer-portal/${BUSINESS_ID}/portal/${ACTIVITY_AGE}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('heading', { name: /E2E Age Restricted Camp/i }).waitFor({ state: 'visible', timeout: 30000 });

    await pickDateAndTime(page);

    await page.getByRole('heading', { name: 'Select Participants' }).waitFor({ state: 'visible', timeout: 15000 });
    await toggleParticipantByName(page, 'Christian Fournier|Account Owner', false);
    await toggleParticipantByName(page, 'E2E Infant', true);
    await page.getByRole('button', { name: 'Next' }).click();
    await skipWaiverIfShown(page);
    await confirmParticipantsAndOpenTickets(page);

    await page.getByText(/Unfortunately there are no spaces available for this age/i).waitFor({
      state: 'visible',
      timeout: 20000,
    });
    record('Age restriction warning shown', true);

    const payBtn = page.getByRole('button', { name: 'Pay with card' });
    const disabled = await payBtn.isDisabled();
    record('Age mismatch: Pay with card disabled', disabled, disabled ? '' : 'button was enabled');
  } catch (err) {
    record('Age restriction block flow', false, err.message);
  } finally {
    await page.close();
  }
}

async function runPortalHome(context) {
  const page = await context.newPage();
  try {
    const url = `${BASE_URL}/customer-portal/${BUSINESS_ID}/portal`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
    await page.getByText(/E2E Test Activity/i).waitFor({ state: 'visible', timeout: 30000 });
    record('Portal home lists activities', true);

    await page.getByRole('link', { name: 'Book Now' }).first().click();
    await page.getByRole('heading', { name: /E2E Test Activity/i }).waitFor({ state: 'visible', timeout: 15000 });
    record('Portal home → activity navigation', true);
  } catch (err) {
    record('Portal home flow', false, err.message);
  } finally {
    await page.close();
  }
}

async function runAccountPages(context) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/customer-portal/${BUSINESS_ID}/account/bookings`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(2000);
    const body = await page.locator('body').innerText();
    const ok = !body.includes('Application error') && !body.match(/failed to load/i);
    record('Account bookings page loads', ok, ok ? '' : 'page error text detected');
  } catch (err) {
    record('Account bookings page', false, err.message);
  } finally {
    await page.close();
  }
}

async function main() {
  console.log(`\nBooking module E2E — ${BASE_URL}\n`);

  const serverOk = await waitForHttpOk(`${BASE_URL}/`);
  if (!serverOk) {
    console.error(`Dev server not reachable at ${BASE_URL}. Start: npx vite --port 5180 --strictPort`);
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await injectPortalSession(context);

  context.on('page', (page) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.warn('[browser]', msg.text());
      }
    });
  });

  await runPortalHome(context);
  await runHappyPathBooking(context);
  await runAgeRestrictionBlock(context);
  await runAccountPages(context);

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log('\n--- Summary ---');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  if (failed.length) {
    failed.forEach((f) => console.log(`  ✗ ${f.name}: ${f.detail}`));
    process.exitCode = 1;
  } else {
    console.log('All booking click-through checks passed.');
    console.log('Note: Helcim card payment iframe was not submitted (sandbox / manual step).');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
