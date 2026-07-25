/**
 * Playwright helpers for Sysco Shop (login + product price scrape).
 */
import { chromium } from 'playwright';

export function isSyscoShopUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'shop.sysco.ca' || host === 'shop.sysco.com';
  } catch {
    return /shop\.sysco\.(ca|com)/i.test(String(url));
  }
}

export function parseMoney(value) {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function normalizeUnit(unit) {
  if (!unit) return '';
  const key = String(unit).trim().toLowerCase();
  const aliases = {
    ea: 'each',
    each: 'each',
    pc: 'each',
    pcs: 'each',
    ct: 'each',
    count: 'each',
    kg: 'kg',
    g: 'g',
    l: 'l',
    lt: 'l',
    ml: 'ml',
    lb: 'lb',
    oz: 'oz',
  };
  return aliases[key] || key;
}

export function parsePackLabel(text) {
  if (!text) return { packSize: null, packSizeUnit: null, packLabel: null };
  const match = String(text).match(/(\d+)\s*\/\s*([\d,.]+)\s*([A-Za-z]+)/);
  if (!match) return { packSize: null, packSizeUnit: null, packLabel: null };
  const packCount = parseMoney(match[1]);
  const size = parseMoney(match[2].replace(/,/g, ''));
  const unit = normalizeUnit(match[3]);
  return {
    packSize: size || packCount,
    packSizeUnit: unit,
    packLabel: `${match[1]}/${match[2]} ${match[3]}`.trim(),
  };
}

export function extractProductId(url) {
  const match = String(url).match(/\/product\/(\d+)/i);
  return match ? match[1] : null;
}

async function dismissCookies(page) {
  for (const label of ['Sounds Good!', 'Accept All Cookies', 'Accept All', 'Reject All']) {
    const btn = page.getByRole('button', { name: label }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(600);
      return;
    }
  }
}

export async function loginToSysco(page, { email, password }) {
  if (!email || !password) {
    throw new Error('Sysco login email and password are required');
  }

  await page.goto('https://shop.sysco.ca/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  await dismissCookies(page);

  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.getByRole('button', { name: /^next$/i }).click();

  await page.waitForURL(/secure\.sysco\.com|shop\.sysco\.ca/, { timeout: 30000 });
  const oktaPass = page.locator('input[type="password"], input[name="password"]').first();
  await oktaPass.waitFor({ state: 'visible', timeout: 20000 });
  await oktaPass.fill(password);

  await page.getByRole('button', { name: /verify|sign in|log in|submit/i }).first().click();
  await page.waitForURL(/shop\.sysco\.ca/, { timeout: 60000 });
  await page.waitForTimeout(3000);
}

function parseGraphqlProduct(node, productId) {
  if (!node || typeof node !== 'object') return null;
  const id = String(node.productId || node.supc || '');
  if (productId && id && id !== productId) return null;

  const info = node.productInfo || node;
  const name = info.name || info.description || null;
  const pack = info.packSize || {};
  const packLabel = pack.pack && pack.size
    ? `${pack.pack}/${pack.size} ${pack.uom || ''}`.trim()
    : null;
  const parsedPack = parsePackLabel(packLabel);

  const priceInfo = node.priceInfoV2 || node.priceInfo || {};
  const casePrice = parseMoney(
    priceInfo.case?.netPrice
    ?? priceInfo.case?.price
    ?? priceInfo.case?.customerReferencePrice,
  );

  if (casePrice == null && !name) return null;

  return {
    productName: name,
    shelfPrice: casePrice,
    packSize: parsedPack.packSize,
    packSizeUnit: parsedPack.packSizeUnit,
    packLabel: parsedPack.packLabel || packLabel,
  };
}

function walkJsonForProduct(node, productId, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkJsonForProduct(item, productId, out);
    return;
  }

  const parsed = parseGraphqlProduct(node, productId);
  if (parsed?.shelfPrice != null) out.push(parsed);

  for (const value of Object.values(node)) {
    walkJsonForProduct(value, productId, out);
  }
}

export async function scrapeSyscoProduct(page, productUrl) {
  const productId = extractProductId(productUrl);
  const graphqlHits = [];

  const onResponse = async (res) => {
    const url = res.url();
    if (!/gateway-api\.shop\.sysco\.ca\/graphql/i.test(url)) return;
    try {
      const body = await res.json();
      const hits = [];
      walkJsonForProduct(body, productId, hits);
      graphqlHits.push(...hits);
    } catch {
      // ignore
    }
  };

  page.on('response', onResponse);
  try {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(8000);

    const bestGraphql = graphqlHits.find((h) => h.shelfPrice != null);
    if (bestGraphql) return bestGraphql;

    const bodyText = await page.locator('body').innerText();
    const titleMatch = bodyText.match(new RegExp(`(\\d+\\/\\d+\\s*\\w+)[\\s\\S]{0,120}?${productId || '\\d+'}`, 'i'));
    const packFromText = parsePackLabel(titleMatch?.[1] || bodyText);

    const priceMatches = [...bodyText.matchAll(/\$\s*([\d,]+\.\d{2})\s*CS/gi)];
    const shelfPrice = priceMatches.length ? parseMoney(priceMatches[0][1]) : null;

    const nameMatch = bodyText.match(/Description\s+(.+?)\s+Read More/i)
      || bodyText.match(/([A-Za-z0-9][^\n$]{4,80})\s+🍁?\s*\d+\/\d+/);
    const productName = nameMatch?.[1]?.trim() || null;

    if (shelfPrice == null) {
      throw new Error('Could not parse Sysco case price from product page');
    }

    return {
      productName,
      shelfPrice,
      packSize: packFromText.packSize,
      packSizeUnit: packFromText.packSizeUnit,
      packLabel: packFromText.packLabel,
    };
  } finally {
    page.off('response', onResponse);
  }
}

export async function withSyscoBrowser(fn, { headless = true } = {}) {
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'en-CA',
    });
    const page = await context.newPage();
    return await fn({ browser, context, page });
  } finally {
    await browser.close();
  }
}
