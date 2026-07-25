const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing Supabase environment variables.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

const businessId = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const templateKey = 'off-the-wall-kids-london-liability-waiver-test-2';
const baseUrl = 'http://localhost:5174';
const testId = Date.now();
const phone = `519555${String(testId).slice(-4)}`;
const email = `cursor-waiver-flow-${testId}@example.com`;

async function drawSignature(page) {
  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 30000 });
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('Signature canvas not found');
  }

  const startX = box.x + 40;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 50, startY - 20, { steps: 8 });
  await page.mouse.move(startX + 100, startY + 20, { steps: 8 });
  await page.mouse.move(startX + 150, startY - 10, { steps: 8 });
  await page.mouse.move(startX + 210, startY + 15, { steps: 8 });
  await page.mouse.up();
}

async function clickIfVisible(page, label) {
  const button = page.getByRole('button', { name: label });
  if (await button.count()) {
    await button.click();
    return true;
  }
  return false;
}

async function run() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
  const url = `${baseUrl}/waiver/${businessId}/${templateKey}?autoStart=1`;

  try {
    await supabase.from('pos_loyalty_accounts').upsert({
      business_id: businessId,
      customer_name: 'Cursor MarketingTest',
      customer_email: email,
      customer_phone: phone,
      is_active: true,
      balance: 0,
      points: 0,
      total_earned: 0,
      total_spent: 0
    }, {
      onConflict: 'business_id,customer_email'
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await page.fill('input[type=tel]', phone);
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.waitForTimeout(1200);
    await page.locator('input').nth(0).fill('Cursor');
    await page.locator('input').nth(1).fill('MarketingTest');
    const selects = page.locator('select');
    await selects.nth(0).selectOption('1990');
    await selects.nth(1).selectOption('01');
    await selects.nth(2).selectOption('15');
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=tel]').fill(phone);
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Continue to Waiver Review' }).click();
    await page.waitForTimeout(600);
    await clickIfVisible(page, /Yes, continue/i);

    await page.waitForTimeout(1600);
    await page.getByText('I have read and understood the waiver. I agree to the terms and conditions.').click();
    await page.getByRole('button', { name: 'I Agree - Continue' }).click();

    await page.waitForTimeout(1800);
    await drawSignature(page);
    await page.getByText('I acknowledge that this is my digital signature and has the same legal effect as a handwritten signature').click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: 'Continue to Submit' }).click();
    await page.waitForTimeout(1200);
    await clickIfVisible(page, /Yes, continue/i);

    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Submit Waiver' }).waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('button', { name: 'Submit Waiver' }).click();
    await page.waitForTimeout(8000);

    const bodyText = await page.locator('body').innerText();

    const { data: waiver, error: waiverError } = await supabase
      .from('waiver_signatures')
      .select('id, email, signed_at, created_at')
      .eq('business_id', businessId)
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (waiverError) {
      throw waiverError;
    }
    if (!waiver?.id) {
      throw new Error(`No waiver found for ${email}`);
    }

    const { data: consentRows, error: consentError } = await supabase
      .from('waiver_consents')
      .select('consent_type, consent_given, acknowledged_at')
      .eq('waiver_id', waiver.id)
      .order('acknowledged_at', { ascending: true });

    if (consentError) {
      throw consentError;
    }

    const { data: contact, error: contactError } = await supabase
      .from('mail_contacts')
      .select('id, email, subscribed, unsubscribed_at, source, created_at, updated_at')
      .eq('business_id', businessId)
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (contactError) {
      throw contactError;
    }

    console.log(JSON.stringify({
      ok: true,
      url,
      email,
      phone,
      completionText: bodyText.slice(0, 2000),
      waiver,
      consentRows,
      contact
    }, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
