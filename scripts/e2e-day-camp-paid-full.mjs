/**
 * Fast paid day-camp E2E: new child → waiver → registration → T&Cs → Helcim $1.
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5174';
const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const ACTIVITY = '6df2118d-d593-4b10-8253-b121a367027b';
const CHILD = { firstName: 'E2E', lastName: `Paykid${Date.now().toString().slice(-4)}`, dob: '2021-09-01' };
const CUSTOMER = {
  id: 'bb8cca8f-d6ea-4afc-8ded-b253edb0e85c',
  phone: '5198722736',
  email: 'christian.dj.fournier@outlook.com',
  customer_email: 'christian.dj.fournier@outlook.com',
  customer_name: 'Christian Fournier',
  helcim_customer_code: 'CST7595',
};

const log = (ok, msg) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
const body = async (page) => page.locator('body').innerText();

async function draw(page) {
  const c = page.locator('canvas').first();
  if (!(await c.count())) return;
  const b = await c.boundingBox();
  if (!b) return;
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 130, b.y + 50, { steps: 6 });
  await page.mouse.up();
}

async function ack(page, re) {
  const t = page.getByText(re);
  if (await t.count()) await t.first().click({ force: true });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.setDefaultTimeout(20000);
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  let failed = false;

  try {
    const url = `${BASE}/customer-portal/${BIZ}/portal/${ACTIVITY}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ businessId, customer }) => {
      sessionStorage.setItem(`customer-portal-session:${businessId}`, JSON.stringify(customer));
    }, { businessId: BIZ, customer: CUSTOMER });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Select Date/i }).waitFor();

    // Date Aug 21
    await page.getByRole('button', { name: /Select Date/i }).click();
    for (let i = 0; i < 4; i++) {
      const m = await page.evaluate(() => [...document.querySelectorAll('div')].find((n) => /^(July|August) 2026$/.test((n.textContent || '').trim()) && !n.children.length)?.textContent?.trim());
      if (m === 'August 2026') break;
      await page.evaluate(() => {
        const month = [...document.querySelectorAll('div')].find((n) => /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}$/.test((n.textContent || '').trim()));
        month?.parentElement?.querySelectorAll('button')?.[1]?.click();
      });
      await page.waitForTimeout(150);
    }
    await page.locator('[data-testid="portal-calendar-selectable-day"]').filter({ hasText: /^21$/ }).click();
    await page.getByRole('button', { name: /^Next$/i }).last().click();
    await page.locator('[data-testid="portal-time-slot-selectable"]').filter({ hasText: /8:30/ }).click();
    for (let i = 0; i < 15; i++) {
      if (await page.getByRole('button', { name: /^Next$/i }).isEnabled()) {
        await page.getByRole('button', { name: /^Next$/i }).click();
        break;
      }
      await page.waitForTimeout(200);
    }
    log(true, 'Date/time selected');

    // Add child
    await page.getByRole('button', { name: /Add Additional Participant/i }).click();
    await page.locator('label').filter({ hasText: /First Name/i }).locator('..').locator('input').fill(CHILD.firstName);
    await page.locator('label').filter({ hasText: /Last Name/i }).locator('..').locator('input').fill(CHILD.lastName);
    const dob = page.locator('input[aria-label="Birthdate"]').last();
    await dob.fill(CHILD.dob);
    await dob.press('Tab');
    await page.getByRole('button', { name: /^Add Participant$/i }).click();
    await page.getByText(/Participant added successfully/i).waitFor({ timeout: 10000 });
    log(true, `Added ${CHILD.firstName} ${CHILD.lastName}`);

    // Select only child
    await page.evaluate((last) => {
      document.querySelectorAll('[data-participant-checkbox]').forEach((wrap) => {
        const card = wrap.closest('div[role="button"]') || wrap.parentElement?.parentElement;
        const text = card?.textContent || '';
        const input = wrap.querySelector('input[type="checkbox"]');
        const want = text.includes(last);
        if (input && want !== input.checked) wrap.click();
      });
    }, CHILD.lastName);
    await page.getByRole('button', { name: /^Next$/i }).click();
    await page.waitForTimeout(800);

    // Waiver
    if (await page.getByRole('button', { name: /Complete waivers/i }).count()) {
      await page.getByRole('button', { name: /Complete waivers/i }).click();
      for (let i = 0; i < 30; i++) {
        const t = await body(page);
        if (/Your Waiver Has Been Completed|waiverDone=1|Annual camper|Required before booking/i.test(t) || /waiverDone=1/.test(page.url())) break;
        await page.evaluate(() => document.querySelectorAll('div').forEach((d) => { if (d.scrollHeight > d.clientHeight + 50) d.scrollTop = d.scrollHeight; }));
        await ack(page, /I have read and understood the waiver/i);
        await draw(page);
        await ack(page, /digital signature/i);
        for (const re of [/I Agree - Continue/i, /Continue to Waiver Review/i, /Yes, continue/i, /Submit Waiver/i, /^Continue$/i, /Return to booking/i]) {
          const b = page.getByRole('button', { name: re });
          if (await b.count() && (await b.first().isEnabled().catch(() => false))) {
            await b.first().click().catch(() => {});
            break;
          }
        }
        await page.waitForTimeout(500);
      }
      log(true, 'Waiver done');
    }

    // Wait for registration or terms
    for (let i = 0; i < 20; i++) {
      const t = await body(page);
      if (/Annual camper registration|Complete form|Required before booking|Day Camp Terms/i.test(t)) break;
      await page.waitForTimeout(400);
    }

    // Registration
    if (await page.getByRole('button', { name: /Complete form/i }).count()) {
      log(true, 'Reached registration');
      await page.getByRole('button', { name: /Complete form/i }).first().click();
      await page.getByText(/Camp Registration|medical form/i).first().waitFor({ timeout: 20000 });

      const phone = page.locator('input[type="tel"]').first();
      const phoneVal = await phone.inputValue().catch(() => '');
      log(/519|872/.test(phoneVal.replace(/\D/g, '')), `Prefill phone: ${phoneVal || '(empty)'}`);

      const gName = await page.evaluate(() => {
        const sec = [...document.querySelectorAll('div')].find((d) => /Parent\/Guardian 1/i.test(d.textContent || '') && d.querySelectorAll('input').length >= 2);
        return sec?.querySelector('input')?.value || '';
      });
      log(/Christian/i.test(gName), `Prefill guardian: ${gName || '(empty)'}`);

      // Fill required blanks
      const fillLabel = async (labelRe, value) => {
        const lab = page.locator('label').filter({ hasText: labelRe }).first();
        if (!(await lab.count())) return;
        const input = lab.locator('xpath=following-sibling::input[1]');
        if (await input.count()) {
          const v = await input.inputValue();
          if (!String(v || '').trim()) await input.fill(value);
        }
      };
      await fillLabel(/^Address/i, '539 First Street');
      await fillLabel(/^City/i, 'London');
      await fillLabel(/Postal/i, 'N5V 0A1');

      // N/A all
      const nas = page.getByText(/Not applicable \(N\/A\)/i);
      for (let i = 0; i < (await nas.count()); i++) await nas.nth(i).click({ force: true }).catch(() => {});

      await page.locator('input[type="radio"][name="custody"]').first().check({ force: true }).catch(() => {});

      // Emergency
      const emerg = page.locator('div').filter({ has: page.getByRole('heading', { name: /Emergency contact/i }) }).first();
      if (await emerg.count()) {
        const inputs = emerg.locator('input:not([disabled])');
        if (await inputs.count() >= 2) {
          if (!(await inputs.nth(0).inputValue())) await inputs.nth(0).fill('Emergency Contact');
          if (!(await inputs.nth(1).inputValue())) await inputs.nth(1).fill('(519) 555-9999');
        }
      }

      await page.evaluate(() => {
        const lab = [...document.querySelectorAll('label')].find((l) => /Parent\/Guardian/i.test(l.textContent || '') && /pick/i.test(l.closest('div')?.parentElement?.textContent || ''));
        lab?.click();
      });
      await ack(page, /agree to the camp authorization/i);
      await ack(page, /agree to the medical authorization/i);
      await ack(page, /agree to the off premises/i);
      await draw(page);
      await ack(page, /digital signature/i);
      await page.getByRole('button', { name: /Submit camp registration/i }).click();
      await page.waitForTimeout(2500);
      log(true, 'Submitted registration');
      if (await page.getByRole('button', { name: /^Continue$/i }).count()) {
        await page.getByRole('button', { name: /^Continue$/i }).click();
      }
    } else {
      log(false, 'Registration step missing after waiver');
      failed = true;
    }

    // T&Cs
    for (let i = 0; i < 10; i++) {
      if (/Required before booking|Day Camp Terms|Sign to confirm/i.test(await body(page))) break;
      await page.waitForTimeout(400);
    }
    if (/Required before booking|Day Camp Terms|Sign to confirm/i.test(await body(page))) {
      log(true, 'T&Cs open');
      for (let s = 0; s < 12; s++) {
        const t = await body(page);
        if (/Sign to confirm/i.test(t)) {
          await page.locator('input[placeholder*="full name" i]').fill('Christian Fournier').catch(() => {});
          await draw(page);
          await ack(page, /digital signature/i);
          await page.getByRole('button', { name: /Continue booking/i }).click();
          break;
        }
        await ack(page, /I have read and understand this section/i);
        await page.getByRole('button', { name: /Next/i }).last().click().catch(() => {});
        await page.waitForTimeout(250);
      }
      log(true, 'T&Cs done');
    }

    // Confirm → payment
    for (let i = 0; i < 10; i++) {
      const t = await body(page);
      if (/Pay with card|no spaces available/i.test(t)) break;
      if (await page.getByRole('button', { name: /Proceed to Payment/i }).count()) {
        await page.getByRole('button', { name: /Proceed to Payment/i }).click();
        break;
      }
      const next = page.getByRole('button', { name: /^Next$/i });
      if (await next.count() && (await next.isEnabled())) await next.click();
      await page.waitForTimeout(500);
    }

    const payText = await body(page);
    if (/no spaces available for this age/i.test(payText)) {
      log(false, 'Age/ticket block at checkout');
      failed = true;
    } else {
      const pay = page.getByRole('button', { name: /Pay with card/i });
      for (let i = 0; i < 20; i++) {
        if (await pay.isEnabled().catch(() => false)) break;
        await page.waitForTimeout(300);
      }
      if (!(await pay.isEnabled().catch(() => false))) {
        log(false, 'Pay disabled');
        failed = true;
      } else {
        await pay.click();
        log(true, 'Pay with card clicked');
        await page.waitForSelector('#helcimPayIframe', { timeout: 40000 });
        log(true, 'Helcim iframe up');
        const frame = page.frameLocator('#helcimPayIframe');
        await page.waitForTimeout(4000);
        await frame.getByText(/Visa|Mastercard|ending|••••/i).first().click({ timeout: 5000 }).catch(() => {});
        let clicked = false;
        for (const re of [/Process Payment/i, /Pay Now/i, /Pay \$/i, /^Pay$/i, /Confirm Payment/i]) {
          const b = frame.getByRole('button', { name: re });
          if (await b.count()) {
            await b.first().click().catch(() => {});
            clicked = true;
            log(true, `Helcim: ${re}`);
            break;
          }
        }
        if (!clicked) {
          const n = await frame.locator('button').count();
          for (let i = 0; i < Math.min(n, 10); i++) {
            const tx = await frame.locator('button').nth(i).innerText().catch(() => '');
            if (/pay|process|confirm/i.test(tx)) {
              await frame.locator('button').nth(i).click().catch(() => {});
              clicked = true;
              log(true, `Helcim fallback: ${tx.slice(0, 30)}`);
              break;
            }
          }
        }
        const confirmed = await Promise.race([
          page.waitForURL(/booking-confirmed/i, { timeout: 90000 }).then(() => true),
          page.getByText(/Booking Confirmed/i).waitFor({ timeout: 90000 }).then(() => true),
        ]).catch(() => false);
        log(!!confirmed, confirmed ? 'BOOKING CONFIRMED + charged' : 'No confirmation after Helcim');
        if (!confirmed) failed = true;
      }
    }
  } catch (e) {
    log(false, e.message || String(e));
    failed = true;
  } finally {
    await page.screenshot({ path: 'scripts/e2e-day-camp-paid-final.png', fullPage: true }).catch(() => {});
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

main();
