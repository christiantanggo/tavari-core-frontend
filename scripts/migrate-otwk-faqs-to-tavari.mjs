/**
 * One-off: consolidate OTWK FAQ sources into Tavari business_website_faqs.
 *
 * Sources (priority: saved OTWK data, else built-in defaults):
 *   page_content 'faq'           → page_key faq
 *   page_content 'first-visit-guide' → page_key first-visit
 *   site_settings home_faqs      → page_key home-teaser
 *   admission-pricing defaults   → page_key admission
 *
 * Usage (from tavari-core-frontend root):
 *   node scripts/migrate-otwk-faqs-to-tavari.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const otwkRoot = path.resolve(root, '../../OTWK - Website Rebuild');

loadEnv({ path: path.join(root, '.env') });

const TAVARI_BUSINESS_ID = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

const UNLIMITED_PLAY_LINE =
  'Unlimited play until close for online bookings and walk-ins. The last booking slot before we close ends at closing time.';
const SOCKS_REQUIRED_LINE =
  'Socks are required for everyone past the admission counter — any age, playing or not. Grip socks ({{grip_socks_price}}) are available at the admission counter.';

const DEFAULT_FAQ_PAGE_FAQS = [
  { q: 'What are your hours?', a: 'We are open 10:00am to 8:00pm, 7 days a week at 539 First St, London Ontario.' },
  { q: 'Do I need to book in advance?', a: `Booking online is recommended: ${UNLIMITED_PLAY_LINE} {{walk_in_message}}` },
  { q: 'Are socks required?', a: `Yes. ${SOCKS_REQUIRED_LINE}` },
  { q: 'Can I bring outside food?', a: 'No outside food, drink, or candy except formula and water. Food and drinks are available at our concession.' },
  { q: 'Do I need a waiver?', a: 'Yes. Every person passing the admission counter needs a waiver, any age. Sign a digital waiver on our Sign Waiver page before you arrive, or use our waiver kiosk at the facility. Digital waivers stay valid for about 12 months — use the waiver status checker on our First Visit Guide or Admission page to see if you need to sign again.' },
  { q: 'What are admission rates?', a: 'Rates vary by age (0–23 months, 2–17) and additional adults. One adult per child is free. Check our Admission & Pricing page or booking site for current pricing.' },
  { q: 'Do you host birthday parties?', a: 'Yes. We offer {{party_packages_summary}}. All include 90 minutes in a private party room on schedule, unlimited play in the facility until we close, and food credit. See our Birthday Parties page for details and book through our portal.' },
  { q: 'Do you offer PA Day or summer camps?', a: 'Yes. We run PA Day camps, summer camps, and March Break camps. Registration is through our booking site; spots are limited.' },
  { q: 'Where do I park?', a: 'Parking is available at our location. See our Parking page for a map, lot details, and tips for busy PA Days and school breaks.' },
  { q: 'Is Off The Wall Kids parent-supervised?', a: 'Yes. Parents and guardians are responsible for their children at all times. We are a parent-supervised play facility.' },
  { q: 'Do you accept donation requests for raffles or fundraisers?', a: 'We do not provide raffle prizes, auction donations, or gift cards. Schools and organizations can raise funds through our Community Partner fundraising nights instead. See our Fundraising & Community Partners page for details.' },
];

const DEFAULT_FIRST_VISIT_FAQS = [
  { q: 'What should I bring?', a: `Bring yourself and the kids in comfortable clothes. Socks are required for everyone past the admission counter. You can purchase grip socks ({{grip_socks_price}}) at the admission counter if needed. No outside food or drink except formula and water.` },
  { q: 'Are socks required?', a: 'Yes. Socks are required for everyone past the admission counter, including parents and children. Grip socks ({{grip_socks_price}}) can be purchased at the admission counter if you forget.' },
  { q: 'Do I need a waiver?', a: 'Yes. Every person passing the admission counter needs a waiver, any age. Sign a digital waiver on our Sign Waiver page before you arrive, or use our waiver kiosk at the facility. Digital waivers stay valid for about 12 months — use the waiver status checker on our First Visit Guide or Admission page to see if you need to sign again.' },
  { q: 'Where do I park?', a: 'Parking is available at our location. See our Parking page for lot locations, street parking behind the building, and busy-period tips.' },
  { q: 'Can I bring food?', a: 'No outside food, drink, or candy is allowed except formula and water. We have a full-service concession with food and drinks for purchase. No food or drink on the play equipment or carpeted areas.' },
  { q: 'What are the best times to visit?', a: `Weekday mornings and early afternoons are often less busy. Weekends and school breaks can be busier — booking online gives you ${UNLIMITED_PLAY_LINE}` },
  { q: 'What are the age recommendations?', a: 'We welcome ages 0–17. We have areas suitable for toddlers (0–23 months have a lower admission rate with one free adult per child) through to older kids. Parents are responsible for supervising their children at all times.' },
];

const DEFAULT_HOME_TEASER_FAQS = [
  { q: 'What are your hours?', a: 'We are open 10:00am to 8:00pm, 7 days a week at 539 First St, London Ontario.' },
  { q: 'Do I need to book in advance?', a: `Booking online is recommended: ${UNLIMITED_PLAY_LINE} {{walk_in_message}}` },
  { q: 'Are socks required?', a: `Yes. ${SOCKS_REQUIRED_LINE}` },
];

const DEFAULT_ADMISSION_FAQS = [
  { q: 'What are Off The Wall Kids admission prices?', a: 'Admission is priced by age, with separate rates for ages 0-23 months, ages 2-17, and additional adults. Online booking usually gives the best available admission rate.' },
  { q: 'Is one adult included with child admission?', a: 'Yes. One adult per child is free. Additional adults have a separate admission rate.' },
  { q: 'How long can we play?', a: 'Guests enjoy Unlimited Play Until We Close for online bookings and walk-ins. The only exception is the last booking slot before we close — play ends at closing time.' },
  { q: 'Are socks required?', a: `Yes. ${SOCKS_REQUIRED_LINE}` },
];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in tavari-core-frontend/.env`);
  return value;
}

function runOtwkQuery(sql) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'otwk-faqs-'));
  const sqlPath = path.join(tempDir, 'query.sql');
  writeFileSync(sqlPath, sql, 'utf8');
  try {
    const output = execFileSync(
      'npx',
      ['supabase', 'db', 'query', '--linked', '--file', sqlPath, '-o', 'json'],
      { cwd: otwkRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, shell: true },
    );
    const jsonStart = output.indexOf('{');
    if (jsonStart < 0) throw new Error('OTWK query returned no JSON');
    return JSON.parse(output.slice(jsonStart));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function normalizeFaqs(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      q: String(x.q ?? x.question ?? '').trim(),
      a: String(x.a ?? x.answer ?? '').trim(),
    }))
    .filter((x) => x.q || x.a);
}

function slugify(pageKey, index, question) {
  const base = String(question || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'item';
  return `${pageKey}-${String(index).padStart(3, '0')}-${base}`;
}

function fetchPageContentFaqs(pageSlug) {
  const sql = [
    `SELECT content->'faqs' AS faqs`,
    `FROM public.page_content`,
    `WHERE page_slug = '${pageSlug.replace(/'/g, "''")}'`,
    `LIMIT 1;`,
  ].join('\n');
  const payload = runOtwkQuery(sql);
  const row = payload.rows?.[0];
  return normalizeFaqs(row?.faqs);
}

function fetchHomeFaqs() {
  const sql = [
    `SELECT value AS home_faqs`,
    `FROM public.site_settings`,
    `WHERE key = 'home_faqs'`,
    `LIMIT 1;`,
  ].join('\n');
  const payload = runOtwkQuery(sql);
  const raw = payload.rows?.[0]?.home_faqs;
  if (!raw) return [];
  try {
    return normalizeFaqs(JSON.parse(String(raw)));
  } catch {
    return [];
  }
}

async function upsertFaqs(tavari, pageKey, faqs, category = null) {
  for (let index = 0; index < faqs.length; index += 1) {
    const faq = faqs[index];
    if (!faq.q && !faq.a) continue;
    const row = {
      business_id: TAVARI_BUSINESS_ID,
      slug: slugify(pageKey, index, faq.q),
      page_key: pageKey,
      category,
      question: faq.q,
      answer: faq.a,
      sort_order: index,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    const { error } = await tavari
      .from('business_website_faqs')
      .upsert(row, { onConflict: 'business_id,slug' });
    if (error) {
      console.error(`Failed ${pageKey} #${index}:`, error.message);
    } else {
      console.log(`Upserted ${pageKey} #${index}: ${faq.q.slice(0, 60)}`);
    }
  }
}

async function main() {
  const tavariBase = requireEnv('SUPABASE_URL');
  const tavariServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const tavari = createClient(tavariBase, tavariServiceKey);

  const faqPage = fetchPageContentFaqs('faq');
  const firstVisit = fetchPageContentFaqs('first-visit-guide');
  const homeTeaser = fetchHomeFaqs();

  await upsertFaqs(tavari, 'faq', faqPage.length > 0 ? faqPage : DEFAULT_FAQ_PAGE_FAQS, 'general');
  await upsertFaqs(tavari, 'first-visit', firstVisit.length > 0 ? firstVisit : DEFAULT_FIRST_VISIT_FAQS, 'first-visit');
  await upsertFaqs(tavari, 'home-teaser', homeTeaser.length > 0 ? homeTeaser : DEFAULT_HOME_TEASER_FAQS, 'home');
  await upsertFaqs(tavari, 'admission', DEFAULT_ADMISSION_FAQS, 'admission');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
