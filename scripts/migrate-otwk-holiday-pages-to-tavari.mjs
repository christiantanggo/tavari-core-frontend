/**
 * One-off: copy OTWK HOLIDAY_PAGES config into Tavari business_website_holiday_pages.
 *
 * Usage (from tavari-core-frontend root):
 *   node scripts/migrate-otwk-holiday-pages-to-tavari.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

loadEnv({ path: path.join(root, '.env') });

const TAVARI_BUSINESS_ID = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

const HOLIDAY_PAGES = [
  {
    slug: 'family-day-activities-london-ontario',
    route_path: '/family-day-activities-london-ontario',
    name: 'Family Day',
    event_keys: ['family-day'],
    event_keywords: ['family day'],
    seo_title: 'Family Day Activities London Ontario — Indoor Playground Open Hours',
    seo_description:
      'Family Day activities in London Ontario at Off The Wall Kids. Check holiday hours, booking, parking, socks, waiver, and indoor playground tips.',
    h1: 'Family Day Activities in London Ontario',
    intro:
      'Looking for something active and weather-proof on Family Day? Off The Wall Kids is an indoor playground in East London with slides, climbing, play structures, and space for kids to burn energy.',
    search_question: 'Is Off The Wall Kids open on Family Day?',
    when_text:
      'Family Day hours can vary by year. Check the hours shown below and confirm your visit through the booking portal before you arrive.',
    planning_tip:
      'Family Day can be busy. Booking online is recommended, and arriving a little early helps with parking and check-in.',
    primary_cta_label: 'Book Family Day Play',
    related_links: [
      { label: 'Holiday Hours', href: '/holiday-hours-london-ontario' },
      { label: 'Indoor Playground', href: '/indoor-playground-london-ontario' },
      { label: 'Parking', href: '/parking' },
    ],
  },
  {
    slug: 'thanksgiving-weekend-kids-activities-london-ontario',
    route_path: '/thanksgiving-weekend-kids-activities-london-ontario',
    name: 'Thanksgiving Weekend',
    event_keys: ['thanksgiving-weekend'],
    event_keywords: ['thanksgiving'],
    seo_title: 'Thanksgiving Weekend Kids Activities London Ontario',
    seo_description:
      'Thanksgiving weekend kids activities in London Ontario. Check Off The Wall Kids holiday hours, booking, parking, and indoor playground visit tips.',
    h1: 'Thanksgiving Weekend Kids Activities in London Ontario',
    intro:
      'If the kids need to move during Thanksgiving weekend, Off The Wall Kids gives families an indoor option for active play in London Ontario.',
    search_question: 'Is Off The Wall Kids open Thanksgiving weekend?',
    when_text:
      'Thanksgiving weekend hours may vary, especially on the holiday Monday. Use the hours below and booking portal for current availability.',
    planning_tip:
      'Holiday weekends can bring more drop-in traffic. Booking ahead helps secure your visit window.',
    primary_cta_label: 'Book Thanksgiving Weekend Play',
    related_links: [
      { label: 'Holiday Hours', href: '/holiday-hours-london-ontario' },
      { label: 'Things to Do With Kids', href: '/things-to-do-with-kids-london-ontario' },
      { label: 'First Visit Guide', href: '/first-visit-guide' },
    ],
  },
  {
    slug: 'easter-weekend-kids-activities-london-ontario',
    route_path: '/easter-weekend-kids-activities-london-ontario',
    name: 'Easter Weekend',
    event_keys: ['good-friday', 'easter-monday', 'easter-weekend'],
    event_keywords: ['easter', 'good friday', 'easter monday'],
    seo_title: 'Easter Weekend Kids Activities London Ontario',
    seo_description:
      'Easter weekend kids activities in London Ontario. Check Off The Wall Kids Easter hours, booking, parking, waiver, socks, and indoor play tips.',
    h1: 'Easter Weekend Kids Activities in London Ontario',
    intro:
      'Easter weekend weather can be unpredictable. Off The Wall Kids gives families an indoor playground option for kids to run, climb, and slide.',
    search_question: 'Is Off The Wall Kids open Easter weekend?',
    when_text:
      'Easter weekend hours can change by day. Check the current hours below and book online when available.',
    planning_tip:
      'Bring socks for everyone and complete your waiver before arriving if possible.',
    primary_cta_label: 'Book Easter Weekend Play',
    related_links: [
      { label: 'Holiday Hours', href: '/holiday-hours-london-ontario' },
      { label: 'Toddler Indoor Playground', href: '/toddler-indoor-playground-london' },
      { label: 'FAQ', href: '/faq' },
    ],
  },
  {
    slug: 'new-years-day-kids-activities-london-ontario',
    route_path: '/new-years-day-kids-activities-london-ontario',
    name: "New Year's Day",
    event_keys: ['new-years-day'],
    event_keywords: ['new year', 'new year’s', "new year's"],
    seo_title: "New Year's Day Kids Activities London Ontario",
    seo_description:
      "New Year's Day kids activities in London Ontario. Check Off The Wall Kids holiday hours, booking, parking, and indoor playground visit details.",
    h1: "New Year's Day Kids Activities in London Ontario",
    intro:
      "Start the year with active indoor play. Off The Wall Kids is a warm, weather-proof option for families looking for things to do with kids on New Year's Day.",
    search_question: "Is Off The Wall Kids open on New Year's Day?",
    when_text:
      "New Year's Day hours may differ from regular hours. Check the live hours below before visiting.",
    planning_tip:
      'Holiday hours and capacity can change, so booking online is the best way to plan your visit.',
    primary_cta_label: "Book New Year's Day Play",
    related_links: [
      { label: 'Holiday Hours', href: '/holiday-hours-london-ontario' },
      { label: 'Winter Break Camp', href: '/winter-break-camp-london-ontario' },
      { label: 'Parking', href: '/parking' },
    ],
  },
  {
    slug: 'christmas-break-activities-london-ontario',
    route_path: '/christmas-break-activities-london-ontario',
    name: 'Christmas Break',
    event_keys: ['christmas-eve', 'christmas-day', 'boxing-day', 'christmas-break'],
    event_keywords: ['christmas', 'christmas eve', 'boxing day', 'winter break'],
    seo_title: 'Christmas Break Activities London Ontario — Indoor Playground',
    seo_description:
      'Christmas Break activities in London Ontario for kids. Check Off The Wall Kids holiday hours, winter break camp, booking, parking, and indoor play details.',
    h1: 'Christmas Break Activities in London Ontario',
    intro:
      'Christmas Break is a busy time for families looking for indoor things to do. Off The Wall Kids offers active indoor play and winter break camp options in London Ontario.',
    search_question: 'Is Off The Wall Kids open during Christmas Break?',
    when_text:
      "Christmas Break hours can vary around Christmas Eve, Christmas Day, Boxing Day, and New Year's. Check the live hours below before you visit.",
    planning_tip:
      'School breaks are busier than normal weekdays. Book ahead and review parking before leaving home.',
    primary_cta_label: 'Book Christmas Break Play',
    related_links: [
      { label: 'Winter Break Camp', href: '/winter-break-camp-london-ontario' },
      { label: 'Holiday Hours', href: '/holiday-hours-london-ontario' },
      { label: 'Things to Do With Kids', href: '/things-to-do-with-kids-london-ontario' },
    ],
  },
];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in tavari-core-frontend/.env`);
  return value;
}

async function main() {
  const tavariBase = requireEnv('SUPABASE_URL');
  const tavariServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const tavari = createClient(tavariBase, tavariServiceKey);

  for (let index = 0; index < HOLIDAY_PAGES.length; index += 1) {
    const page = HOLIDAY_PAGES[index];
    const row = {
      business_id: TAVARI_BUSINESS_ID,
      slug: page.slug,
      route_path: page.route_path,
      name: page.name,
      event_keys: page.event_keys,
      event_keywords: page.event_keywords,
      seo_title: page.seo_title,
      seo_description: page.seo_description,
      h1: page.h1,
      intro: page.intro,
      search_question: page.search_question,
      when_text: page.when_text,
      planning_tip: page.planning_tip,
      primary_cta_label: page.primary_cta_label,
      related_links: page.related_links,
      sort_order: index,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const { error } = await tavari
      .from('business_website_holiday_pages')
      .upsert(row, { onConflict: 'business_id,slug' });

    if (error) {
      console.error(`Failed ${page.slug}:`, error.message);
    } else {
      console.log(`Upserted holiday page ${page.slug}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
