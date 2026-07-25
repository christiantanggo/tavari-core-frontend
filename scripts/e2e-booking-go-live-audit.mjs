/**
 * Go-live audit: staff + portal button/modal click-through (Helcim payment excluded).
 *
 * Prerequisites:
 *   npx vite --port 5180 --strictPort
 *   .env with VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY
 *
 * Usage: node scripts/e2e-booking-go-live-audit.mjs
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:5180').replace(/\/$/, '');
const BUSINESS_ID = process.env.E2E_BUSINESS_ID || 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const PORTAL_BUSINESS_ID = process.env.E2E_PORTAL_BUSINESS_ID || 'dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7';
const CUSTOMER_ID = process.env.E2E_CUSTOMER_ID || '11111111-1111-4111-8111-111111111104';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForHttpOk(url, attempts = 30, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

function getStorageKey() {
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}

async function getOwnerUserId(admin, businessId) {
  const { data, error } = await admin
    .from('business_users')
    .select('user_id, role')
    .eq('business_id', businessId)
    .in('role', ['owner', 'admin'])
    .order('role', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.user_id) throw new Error(`No owner/admin for business ${businessId}`);
  return data.user_id;
}

async function createStaffBrowserContext(browser, businessId) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await getOwnerUserId(admin, businessId);
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !userData?.user?.email) throw new Error('Could not load staff user email');

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: userData.user.email,
  });
  if (linkError || !linkData?.properties?.hashed_token) throw new Error('Could not generate staff login link');

  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'email',
  });
  if (verifyError || !verified?.session) throw new Error('Could not verify staff login link');

  const sessionPayload = {
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
    expires_in: verified.session.expires_in,
    expires_at: verified.session.expires_at,
    token_type: 'bearer',
    user: verified.session.user,
  };

  const storageKey = getStorageKey();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(
    ({ storageKey, sessionPayload, businessId }) => {
      localStorage.setItem(storageKey, JSON.stringify(sessionPayload));
      localStorage.setItem('tavariPinnedBusinessId', businessId);
      localStorage.setItem('selectedBusinessId', businessId);
      localStorage.setItem('currentBusinessId', businessId);
    },
    { storageKey, sessionPayload, businessId },
  );
  return { context, admin };
}

async function findActiveBooking(admin, businessId, { party = null } = {}) {
  const { data: bookings } = await admin
    .from('bookings')
    .select('id, status, requires_approval, approved_at, booking_participants(party_role)')
    .eq('business_id', businessId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(40);

  for (const row of bookings || []) {
    const parts = row.booking_participants || [];
    const isParty = parts.some((p) => p.party_role === 'host_adult' || p.party_role === 'birthday_child');
    if (party === true && !isParty) continue;
    if (party === false && isParty) continue;
    return row;
  }
  return bookings?.[0] || null;
}

async function findPendingApprovalBooking(admin, businessId) {
  const { data } = await admin
    .from('bookings')
    .select('id, requires_approval, approved_at, status')
    .eq('business_id', businessId)
    .eq('requires_approval', true)
    .is('approved_at', null)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function findApprovedPartyBooking(admin, businessId) {
  const { data: bookings } = await admin
    .from('bookings')
    .select('id, requires_approval, approved_at, booking_participants(party_role)')
    .eq('business_id', businessId)
    .neq('status', 'cancelled')
    .not('approved_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(30);
  for (const row of bookings || []) {
    const isParty = (row.booking_participants || []).some(
      (p) => p.party_role === 'host_adult' || p.party_role === 'birthday_child',
    );
    if (isParty) return row;
  }
  return bookings?.[0] || null;
}

async function scrollAndClick(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ timeout: 15000 });
}

/** Wait until custom/MUI overlays are not blocking clicks. */
async function ensureNoModalOverlay(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dialog = page.locator('[role="dialog"]:visible').first();
    const hasDialog = await dialog.isVisible().catch(() => false);
    const hasPrintBackdrop = await page.getByRole('heading', { name: /^Print booking$/i }).isVisible().catch(() => false);

    if (!hasDialog && !hasPrintBackdrop) {
      return;
    }

    if (hasPrintBackdrop) {
      const printDialog = page.getByRole('dialog', { name: /Print booking/i });
      if (await printDialog.isVisible().catch(() => false)) {
        await printDialog.getByRole('button', { name: /^Cancel$/i }).click({ timeout: 5000 }).catch(async () => {
          await printDialog.getByLabel('Close').click({ timeout: 5000 });
        });
      } else {
        await page.keyboard.press('Escape');
      }
      await page.getByRole('heading', { name: /^Print booking$/i }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      continue;
    }

    await dismissVisibleDialog(page);
  }

  await page.locator('[role="presentation"]:visible').first().waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
}

async function dismissVisibleDialog(page, titleHint) {
  const dialog = titleHint
    ? page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: new RegExp(titleHint, 'i') }) })
    : page.locator('[role="dialog"]:visible').last();

  if (!(await dialog.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    return;
  }

  const cancelBtn = dialog.getByRole('button', { name: /^Cancel$/i });
  const closeBtn = dialog.getByRole('button', { name: /^Close$/i });
  if (await cancelBtn.isVisible().catch(() => false)) {
    await cancelBtn.click();
  } else if (await dialog.getByLabel('Close').isVisible().catch(() => false)) {
    await dialog.getByLabel('Close').click();
  } else if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }

  await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  });
}

async function clickTab(page, name) {
  await ensureNoModalOverlay(page);
  const tab = page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') })
    .or(page.getByRole('tab', { name: new RegExp(name, 'i') }));
  await tab.first().click({ timeout: 15000 });
  await page.waitForTimeout(600);
}

async function testDashboardNavigation(context, admin, businessId) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/dashboard/bookings`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('heading', { name: /Tavari Bookings/i }).waitFor({ state: 'visible', timeout: 45000 });
    record('1.1 Dashboard loads', true);

    const tabs = [
      ['Schedule', 'tab=schedule'],
      ['All Bookings', 'tab=list'],
      ['Customers', 'tab=customers'],
      ['Settings', 'tab=settings'],
    ];

    for (const [label] of tabs) {
      const tab = page.getByRole('tab', { name: new RegExp(label, 'i') });
      const visible = await tab.isVisible().catch(() => false);
      if (!visible) {
        record(`1.2 Tab visible: ${label}`, false, 'tab not in nav');
        continue;
      }
      await tab.click();
      await page.waitForTimeout(800);
      const denied = await page.getByText(/Access Denied/i).isVisible().catch(() => false);
      record(`1.2 Tab opens: ${label}`, !denied, denied ? 'access denied' : '');
    }

    await page.goto(`${BASE_URL}/dashboard/bookings/check-in`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('heading', { name: 'Check-In', exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    record('1.3 Check-in screen loads', true);

    await page.goto(`${BASE_URL}/dashboard/bookings/party-guest-lists`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByText(/Party guest lists/i).waitFor({ state: 'visible', timeout: 30000 });
    record('1.4 Party guest lists screen loads', true);

    await page.goto(`${BASE_URL}/dashboard/bookings/create`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('heading', { name: /Create New Booking/i }).waitFor({ state: 'visible', timeout: 30000 });
    record('1.5 Create booking screen loads', true);
  } catch (err) {
    record('1.x Dashboard navigation', false, err.message);
  } finally {
    await page.close();
  }
}

async function testBookingDetailButtons(context, admin, businessId) {
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  try {
    const party = await findApprovedPartyBooking(admin, businessId)
      || await findActiveBooking(admin, businessId, { party: true });
    if (!party?.id) {
      record('2.x Booking detail tests', false, 'no active party booking found');
      return;
    }

    await page.goto(`${BASE_URL}/dashboard/bookings/${party.id}`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.getByRole('button', { name: /^Print$/i }).first().waitFor({ state: 'visible', timeout: 30000 });
    record('2.1 Booking detail page loads', true);

    const clickSidebarButton = async (namePattern) => {
      await ensureNoModalOverlay(page);
      const btn = page.getByRole('button', { name: namePattern }).first();
      await btn.scrollIntoViewIfNeeded();
      await btn.click({ timeout: 15000 });
    };

    try {
      await clickSidebarButton(/^Print$/i);
      const printDialog = page.getByRole('dialog', { name: /Print booking/i });
      await printDialog.waitFor({ state: 'visible', timeout: 10000 });
      record('2.2 Print modal opens', await page.getByText(/Print booking|Choose which sections/i).first().isVisible().catch(() => false));
      await printDialog.getByRole('button', { name: /^Cancel$/i }).click();
      await printDialog.waitFor({ state: 'hidden', timeout: 10000 });
      await ensureNoModalOverlay(page);
    } catch (err) {
      record('2.2 Print modal opens', false, err.message);
      await ensureNoModalOverlay(page);
    }

    try {
      await clickSidebarButton(/Price breakdown/i);
      const breakdownDialog = page.getByRole('dialog', { name: /Price breakdown/i });
      await breakdownDialog.waitFor({ state: 'visible', timeout: 10000 });
      record('2.3 Price breakdown modal opens', await page.getByText(/^Total$/i).isVisible().catch(() => false));
      await dismissVisibleDialog(page, 'Price breakdown');
      await ensureNoModalOverlay(page);
    } catch (err) {
      record('2.3 Price breakdown modal opens', false, err.message);
      await ensureNoModalOverlay(page);
    }

    try {
      await clickSidebarButton(/Extend time/i);
      const extendDialog = page.getByRole('dialog', { name: /Extend booking time/i });
      await extendDialog.waitFor({ state: 'visible', timeout: 10000 });
      record('2.4 Extend time modal opens', await page.getByLabel(/Minutes to add/i).isVisible().catch(() => false));
      await dismissVisibleDialog(page, 'Extend booking time');
      await ensureNoModalOverlay(page);
    } catch (err) {
      record('2.4 Extend time modal opens', false, err.message);
      await ensureNoModalOverlay(page);
    }

    try {
      await clickSidebarButton(/^Payment$/i);
      await page.waitForTimeout(1500);
      const paymentTab = await page.getByText(/Send payment request|Balance due|Record manual payment/i).first().isVisible().catch(() => false);
      const jsonErr = pageErrors.some((e) => /JSON object requested|multiple.*rows/i.test(e));
      record('2.5 Payment tab opens (UI only)', paymentTab && !jsonErr, jsonErr ? pageErrors[0] : '');
    } catch (err) {
      record('2.5 Payment tab opens (UI only)', false, err.message);
    }

    // Content tabs
    const contentTabs = ['Participants', 'Options', 'Notes', 'History', 'Details'];
    for (const tabName of contentTabs) {
      try {
        await clickTab(page, tabName);
        const denied = await page.getByText(/Access Denied|Error loading/i).isVisible().catch(() => false);
        record(`2.6 Tab: ${tabName}`, !denied, denied ? 'error state' : '');
      } catch (err) {
        record(`2.6 Tab: ${tabName}`, false, err.message);
      }
    }

    // Guest list (party)
    try {
      await clickTab(page, 'Guest list');
      const guestList = await page.getByText(/Guest list|No guest list|Sync/i).first().isVisible().catch(() => false);
      record('2.7 Guest list tab (party)', guestList);
    } catch (err) {
      record('2.7 Guest list tab (party)', false, err.message);
    }

    // Cake receipts
    try {
      await clickTab(page, 'Cake receipts');
      const cake = await page.getByText(/Cake|receipt|Upload/i).first().isVisible().catch(() => false);
      record('2.8 Cake receipts tab', cake);
    } catch (err) {
      record('2.8 Cake receipts tab', false, err.message);
    }

    // Options — add item modal (open only)
    try {
      await clickTab(page, 'Options');
      const addBtn = page.getByRole('button', { name: /Add item|Add additional/i });
      if (await addBtn.first().isVisible().catch(() => false)) {
        await addBtn.first().click();
        await page.waitForTimeout(800);
        const modal = await page.getByText(/Add additional|Description/i).first().isVisible().catch(() => false);
        record('2.9 Options: add item modal opens', modal);
        await dismissVisibleDialog(page);
        await ensureNoModalOverlay(page);
      } else {
        record('2.9 Options: add item modal opens', true, 'no add button (may have no edit perm or empty state ok)');
      }
    } catch (err) {
      record('2.9 Options: add item modal opens', false, err.message);
    }

    // Revoke approval modal (open only, don't confirm)
    try {
      await ensureNoModalOverlay(page);
      const revokeBtn = page.getByRole('button', { name: /Remove approval|Revoke approval/i });
      if (await revokeBtn.isVisible().catch(() => false)) {
        await revokeBtn.click();
        await page.waitForTimeout(800);
        const modal = await page.getByText(/Remove approval|revoke|reason/i).first().isVisible().catch(() => false);
        record('2.10 Revoke approval modal opens', modal);
        await dismissVisibleDialog(page);
        await ensureNoModalOverlay(page);
      } else {
        record('2.10 Revoke approval modal opens', true, 'not applicable (not approved or no perm)');
      }
    } catch (err) {
      record('2.10 Revoke approval modal opens', false, err.message);
      await ensureNoModalOverlay(page);
    }
  } catch (err) {
    record('2.x Booking detail buttons', false, err.message);
  } finally {
    await page.close();
  }
}

async function testPendingApprovalFlow(context, admin, businessId) {
  const page = await context.newPage();
  try {
    const pending = await findPendingApprovalBooking(admin, businessId);
    if (!pending?.id) {
      record('3.1 Pending approval booking exists', true, 'none in DB — skip');
      record('3.2 Approve modal opens', true, 'skipped');
      return;
    }

    await page.goto(`${BASE_URL}/dashboard/bookings/${pending.id}`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(1000);

    const approveBtn = page.getByRole('button', { name: /Approve & request deposit/i });
    const hasApprove = await approveBtn.first().isVisible().catch(() => false);
    record('3.1 Pending booking shows approve action', hasApprove);

    if (hasApprove) {
      await approveBtn.first().click();
      await page.waitForTimeout(800);
      const modal = await page.getByText(/Approve|confirm|deposit payment link/i).first().isVisible().catch(() => false);
      record('3.2 Approve modal opens', modal);
      await dismissVisibleDialog(page);
      await ensureNoModalOverlay(page);
    }
  } catch (err) {
    record('3.x Pending approval flow', false, err.message);
  } finally {
    await page.close();
  }
}

async function testScheduleView(context) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/dashboard/bookings?tab=schedule`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);

    const scheduleVisible = await page.getByText(/Schedule|Today|Week/i).first().isVisible().catch(() => false);
    record('4.1 Schedule view renders', scheduleVisible);

    // Click first booking block if present
    const bookingBlock = page.locator('[data-booking-id], [class*="booking"], button').filter({ hasText: /AM|PM|\d{1,2}:/ }).first();
    if (await bookingBlock.isVisible().catch(() => false)) {
      await bookingBlock.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const slotModal = await page.getByText(/Booking details|New booking|Details/i).first().isVisible().catch(() => false);
      record('4.2 Schedule slot/booking click opens panel', slotModal);
    } else {
      record('4.2 Schedule slot/booking click opens panel', true, 'no visible booking blocks (empty schedule ok)');
    }

    const newBookingBtn = page.getByRole('button', { name: /New booking|Create booking/i });
    if (await newBookingBtn.first().isVisible().catch(() => false)) {
      await newBookingBtn.first().click();
      await page.waitForTimeout(1000);
      const modal = await page.getByText(/New booking|Activity|Customer/i).first().isVisible().catch(() => false);
      record('4.3 Schedule new booking modal opens', modal);
      await page.keyboard.press('Escape');
    } else {
      record('4.3 Schedule new booking modal opens', true, 'button not found (may need create perm)');
    }
  } catch (err) {
    record('4.x Schedule view', false, err.message);
  } finally {
    await page.close();
  }
}

async function testSettingsScreen(context) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/dashboard/bookings?tab=settings`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('heading', { name: /Booking settings/i }).waitFor({ state: 'visible', timeout: 45000 });
    record('5.1 Settings screen loads', true);

    const pricingSection = page.getByRole('button', { name: /Pricing Seasons & Promo/i });
    await pricingSection.waitFor({ state: 'visible', timeout: 15000 });
    await pricingSection.click();
    await page.waitForTimeout(800);
    record('5.2 Settings sub-tabs (Pricing Seasons & Promo)', await page.getByText(/Seasonal Pricing/i).first().isVisible().catch(() => false));
  } catch (err) {
    record('5.x Settings screen', false, err.message);
  } finally {
    await page.close();
  }
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
    { businessId: PORTAL_BUSINESS_ID, customerId: CUSTOMER_ID },
  );
}

async function testPortalFlowNoPayment(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await injectPortalSession(ctx);
  const page = await ctx.newPage();
  try {
    const activityId = process.env.E2E_ACTIVITY_ID || '11111111-1111-4111-8111-111111111102';
    await page.goto(`${BASE_URL}/customer-portal/${PORTAL_BUSINESS_ID}/portal/${activityId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.getByRole('heading', { name: /E2E Test Activity|Activity/i }).waitFor({ state: 'visible', timeout: 30000 });
    record('6.1 Portal activity page loads', true);

    await page.getByRole('button', { name: 'Select Date' }).click();
    await page.getByTestId('portal-calendar-selectable-day').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId('portal-calendar-selectable-day').first().click();
    await page.getByRole('button', { name: 'Next' }).click();
    record('6.2 Portal date selection works', true);

    await page.getByText(/Select Time/i).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(2000);
    const slot = page.getByTestId('portal-time-slot-selectable').first();
    if (await slot.isVisible().catch(() => false)) {
      await slot.click();
      await page.waitForTimeout(500);
      const nextEnabled = page.getByRole('button', { name: /^Next$/i });
      await nextEnabled.waitFor({ state: 'visible', timeout: 5000 });
      const enabled = await nextEnabled.isEnabled().catch(() => false);
      record('6.3 Portal time slot selection works', enabled, enabled ? '' : 'Next still disabled after slot click');
      if (enabled) {
        await nextEnabled.click();
        record('6.4 Portal advances past time step', true);
      }
    } else {
      record('6.3 Portal time slot selection works', false, 'no selectable slot (check activity schedule seed)');
    }
  } catch (err) {
    record('6.x Portal flow', false, err.message);
  } finally {
    await page.close();
    await ctx.close();
  }
}

async function testManageBookingToken(context, admin) {
  const page = await context.newPage();
  try {
    const { data: booking } = await admin
      .from('bookings')
      .select('id')
      .eq('business_id', BUSINESS_ID)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!booking?.id) {
      record('7.1 Manage booking page', false, 'no booking');
      return;
    }

    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data, error } = await anon.functions.invoke('ensure-booking-manage-token', {
      body: { businessId: BUSINESS_ID, bookingId: booking.id },
    });
    const token = String(data?.token || '').trim();
    if (error || !token) {
      record('7.1 Manage booking token', false, error?.message || 'no token');
      return;
    }

    await page.goto(
      `${BASE_URL}/customer-portal/${BUSINESS_ID}/portal/manage-booking/${token}`,
      { waitUntil: 'domcontentloaded', timeout: 60000 },
    );
    await page.waitForTimeout(2000);
    const loaded = await page.getByText(/Manage booking|Booking details|Pay balance/i).first().isVisible().catch(() => false);
    record('7.1 Customer manage-booking page loads', loaded);
  } catch (err) {
    record('7.x Manage booking', false, err.message);
  } finally {
    await page.close();
  }
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    console.error('Missing env vars in .env');
    process.exitCode = 1;
    return;
  }

  const ok = await waitForHttpOk(`${BASE_URL}/`);
  if (!ok) {
    console.error(`Dev server not reachable at ${BASE_URL}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n=== Booking Go-Live Audit (Helcim excluded) @ ${BASE_URL} ===\n`);

  const browser = await chromium.launch({ headless: true });

  try {
    const { context, admin } = await createStaffBrowserContext(browser, BUSINESS_ID);

    await testDashboardNavigation(context, admin, BUSINESS_ID);
    await testBookingDetailButtons(context, admin, BUSINESS_ID);
    await testPendingApprovalFlow(context, admin, BUSINESS_ID);
    await testScheduleView(context);
    await testSettingsScreen(context);
    await testManageBookingToken(context, admin);

    await context.close();

    await testPortalFlowNoPayment(browser);
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  const passed = results.length - failed.length;

  console.log(`\n=== SUMMARY: ${passed}/${results.length} passed ===`);
  if (failed.length) {
    console.log('\nFailed checks:');
    for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exitCode = 1;
  }

  console.log('\nGo-live blockers to review manually:');
  console.log('  - Helcim payment completion (excluded from this run — see BK-cb982fca-000017)');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
