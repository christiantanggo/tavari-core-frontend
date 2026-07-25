/**
 * OTWK: seed Party Terms & Conditions package, attach to party activities,
 * and refresh customer-facing activity descriptions/sections from website + Bookeo copy.
 *
 * Usage: node scripts/seed-otwk-party-terms-and-descriptions.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const BIRTHDAY_TYPE_ID = 'e87ee858-1f8c-4a39-b169-f3e9afbfe97d';
const DROP_IN_TYPE_ID = '2676aa5c-54a0-44fa-bd98-1854cd93fbcf';
const DAY_CAMP_TYPE_ID = '87cb7e10-0e87-43b8-a512-d07243db9117';

const PRIVATE_FACILITY_INVENTORY_ID = 'e72ebc1c-679f-4ac2-ad21-6254b9d3bef8';

const ACTIVITY_IDS = {
  classic: 'd4f2f7a0-d20e-4045-90dd-09a94765a4fa',
  super: 'b939a283-14ad-4a04-aa47-6158ab7fb14f',
  ultimate: '7815d4a7-6938-4cf8-a7ca-5bb51cc3d308',
  party12: 'ec8c38d6-5e61-4640-9be8-52ea886b5df3',
  party24: 'cfb7c4fb-b0b6-499c-b612-6366a22e56e5',
  party36: '264b29d8-2605-4d7f-ab95-7fd8b933ac0c',
  dropIn: '59cf5820-0ec2-49d4-b1d3-8c7475d72e47',
  paDay2526: '6df2118d-d593-4b10-8253-b121a367027b',
  paDay2627: '4953a3fc-cb09-41c0-85c3-c249bf21ef34',
  singleDayCamp: '25477f78-90a9-4f80-bf4e-155f25d4d550',
  weekCamp: '509bdac0-30fd-400c-a03b-889eb2c80e62',
  community: '1e3b8c42-5095-41bc-b11d-b8121043b8bb',
};

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const TERMS_STEPS = [
  {
    title: 'Before we approve your party',
    body: `Please read each section carefully. These policies help your party run smoothly with no surprises.

Once you acknowledge and sign these Terms & Conditions, we can send your Party Approval and Deposit Request. Your remaining balance is due on the day of your party.

Card on file
• A valid card on file is required to finalize your party booking.
• If a card on file is not provided, the final balance must be paid upon arrival on party day.

Deposits may be paid by cash, debit, credit card, or e-transfer.`,
  },
  {
    title: '1. Party capacity & room time',
    body: `Your party package includes a set number of children and free adults and/or non-walking babies (as listed on your package).

Additional guests
• Extra children (ages 2–17), adults, and children under 24 months may be charged the applicable general admission rate at the front gate, subject to availability.
• A non-walking baby means a child who remains in a car seat. Any child who is crawling, walking, or removed from their car seat is charged applicable admission.
• Guest count includes everyone entering past the front gate, whether playing or not.

Party room
• Your 90-minute private party room time is for group celebration: food, cake/cupcakes, and gift opening if time allows.
• Rooms are prepared for your package size and include 18 chairs.
• Additional chairs cannot be added, and room time cannot be extended — another party may be booked immediately after yours.`,
  },
  {
    title: '2. Cakes & cupcakes only (outside food)',
    body: `Cakes and cupcakes are the only outside desserts permitted at Off The Wall Kids.

Not permitted
• Donuts, cookies, cake pops, muffins, tarts, puddings
• Candy, dessert trays, ice cream (ice cream cakes are permitted)
• Any other outside desserts or food items

Receipt required
• All cakes and cupcakes must arrive with an itemized proof-of-purchase receipt.
• No receipt = no entry.
• Debit-machine slips alone are not accepted. The receipt must identify the bakery, grocery store, or business.
• Bring the receipt on party day; cakes/cupcakes must stay in your private party room.

No homemade products
• Homemade cakes/cupcakes are not permitted.
• Home-based bakeries and uninspected kitchens are not permitted.
• Products must come from a licensed commercial bakery, grocery store, or approved inspected business.

These rules support food safety and allergy policies for every family visiting.`,
  },
  {
    title: '3. Goodie bags & food vouchers',
    body: `Goodie bags
• May not contain candy, gum, snacks, chocolate, chips, or any food items.
• Please use toys, stickers, small activities, crafts, or other non-food treats.

Food vouchers (if included with your package)
• Have no cash value.
• Apply only to food purchased during your current party.
• Cannot be transferred or redeemed on a future visit.
• Unused vouchers have no cash value.
• Vouchers are applied to your final bill at the end of your party.`,
  },
  {
    title: '4. Mandatory guest list',
    body: `All parties must submit a completed guest list with first and last names of every guest attending — children and adults — before arrival.

This helps us verify waivers, prepare for your guests, and keep check-in smooth.

Guest lists must be submitted before your party date.

Collecting names from RSVPs
We understand that schools will not give you a list of first names and last names of students for your guest list. When your guests RSVP back to you in person, by phone, by text, or by email, ask for their first name, last name, and who will be attending (the child, parent, etc.).`,
  },
  {
    title: '5. Decorations & cleanup',
    body: `You are responsible for removing all decorations you bring into the party room, including balloons, banners, wall/table decorations, displays, and party supplies.

Prohibited
• Confetti cannons, confetti bombs, confetti shooters, and piñatas

A $25 cleanup charge may apply if decorations are left behind, confetti is used, or additional staff cleanup is required.`,
  },
  {
    title: '6. Party add-on cancellations',
    body: `Fresh food platters, party hosts, and mascots are ordered and scheduled specifically for your party.

Cancel at least 7 days before your party for:
• Fresh fruit, vegetable, breakfast, hot dog platters, and chip bowls
• Party hosts and mascots

Cancellations with less than 7 days' notice may still be charged in full.`,
  },
  {
    title: '7. Informing your guests',
    body: `By agreeing to these terms, you confirm you have read them and will inform all guests of Off The Wall Kids rules, including:

Socks-only facility
• Everyone past the front gate must wear socks — children, adults, spectators, and drop-off/pick-up parents (playing or not).
• Guests without socks will not be permitted past the front gate.
• Socks can be purchased by you or your guests at our admission counter.

No outside food or drink
• Outside food and beverages are not permitted (except cakes/cupcakes as outlined in these terms), to follow food safety and allergy policies.

Waivers required for all guests
• Every guest past the front gate needs an updated waiver — playing children, non-playing adults, spectators, pick-up/drop-off adults, and babies.
• No exceptions.`,
  },
  {
    title: '8. Cancellation & change policy',
    body: `Deposits are non-refundable but may be placed on account as a credit.

• In a government-mandated closure, deposits may become refundable.
• Cancellations more than 14 days before your party may receive a credit on account.
• Cancellations within 14 days of your party forfeit the deposit.

This also applies to date changes, time changes, and package downgrades.

Sickness
• Handled case by case. Deposits remain non-refundable but may transfer as credit toward a future party.

Package size changes
• A smaller package may be upgraded to a larger package if space is available.
• Larger packages cannot be reduced to a smaller package within 14 days of the party.
• If a reduction occurs within 14 days: the original deposit is forfeited and a new deposit is required for the new package.

How to cancel or change
• Email info@offthewallkids.ca so there is a dated record of your request.`,
  },
  {
    title: 'Final acknowledgment',
    body: `Your party request is not finalized until these Terms & Conditions are acknowledged and signed.

By continuing, you confirm:
• You understand all party policies, important information, and the cancellation policy above.
• You will help make the celebration fun, safe, and stress-free for your guests and ours.

Thank you — Off The Wall Kids`,
  },
];

const ACTIVITY_CONTENT = {
  [ACTIVITY_IDS.classic]: {
    description:
      'Classic Birthday Party for up to 10 kids and 10 adults. Includes 90 minutes in a private party room, unlimited facility play until close, and one included party food bundle (choose from three options when booking).',
    inclusions: [
      'Up to 10 kids and 10 adults included',
      '90 minutes in the private party room',
      'Unlimited play in the facility until we close',
      '1 included party food bundle — choose when booking',
    ],
    sections: [
      {
        header: 'About this party',
        details:
          'Host an indoor birthday at Off The Wall Kids London — no weather worries, exclusive play structures, and a dedicated party room so you can celebrate while the kids play.',
      },
      {
        header: "What's included",
        details:
          'Up to 10 kids and 10 adults\n90 minutes in the private party room (on your booked schedule)\nUnlimited play in the facility until we close (party room access ends after your 90 minutes)\n1 included party food bundle — choose from 3 options when booking\nFree adult admission as listed on your package',
      },
      {
        header: 'Good to know',
        details:
          'Socks are required for everyone past admission. Outside food is limited to cakes/cupcakes with a receipt (see party Terms & Conditions). A completed guest list is required before party day.',
      },
    ],
  },
  [ACTIVITY_IDS.super]: {
    description:
      'Super Birthday Party for up to 20 kids and 20 adults. Includes 90 minutes in a private party room, unlimited facility play until close, and two included party food bundles (choose when booking).',
    inclusions: [
      'Up to 20 kids and 20 adults included',
      '90 minutes in the private party room',
      'Unlimited play in the facility until we close',
      '2 included party food bundles — choose when booking',
    ],
    sections: [
      {
        header: 'About this party',
        details:
          'Our mid-size party package for bigger celebrations — private room time, unlimited playground play until close, and food credit built into your package.',
      },
      {
        header: "What's included",
        details:
          'Up to 20 kids and 20 adults\n90 minutes in the private party room (on your booked schedule)\nUnlimited play in the facility until we close (party room access ends after your 90 minutes)\n2 included party food bundles — choose from 3 options when booking\nFree adult admission as listed on your package',
      },
      {
        header: 'Good to know',
        details:
          'Socks are required for everyone past admission. Outside food is limited to cakes/cupcakes with a receipt (see party Terms & Conditions). A completed guest list is required before party day.',
      },
    ],
  },
  [ACTIVITY_IDS.ultimate]: {
    description:
      'Ultimate Birthday Party for up to 30 kids and 30 adults. Includes 90 minutes in a private party room, unlimited facility play until close, and all three included party food bundles.',
    inclusions: [
      'Up to 30 kids and 30 adults included',
      '90 minutes in the private party room',
      'Unlimited play in the facility until we close',
      'All 3 party food bundles included',
    ],
    sections: [
      {
        header: 'About this party',
        details:
          'Our largest standard party package — room for a big guest list, private party room time, unlimited play until close, and all included food bundle options.',
      },
      {
        header: "What's included",
        details:
          'Up to 30 kids and 30 adults\n90 minutes in the private party room (on your booked schedule)\nUnlimited play in the facility until we close (party room access ends after your 90 minutes)\nAll 3 included party food bundles\nFree adult admission as listed on your package',
      },
      {
        header: 'Good to know',
        details:
          'Socks are required for everyone past admission. Outside food is limited to cakes/cupcakes with a receipt (see party Terms & Conditions). A completed guest list is required before party day.',
      },
    ],
  },
  [ACTIVITY_IDS.party12]: {
    description:
      'Legacy party package for up to 12 kids and 12 adults (staff / import). 90 minutes private room + unlimited play until close.',
    inclusions: [
      'Up to 12 kids and 12 adults included',
      '90 minutes in the private party room',
      'Unlimited play until we close',
    ],
    sections: [
      {
        header: "What's included",
        details:
          'Up to 12 kids and 12 adults\n90 minutes in the private party room\nUnlimited play in the facility until we close\nStaff / Bookeo import package',
      },
    ],
  },
  [ACTIVITY_IDS.party24]: {
    description:
      'Legacy party package for up to 24 kids and 24 adults (staff / import). 90 minutes private room + unlimited play until close.',
    inclusions: [
      'Up to 24 kids and 24 adults included',
      '90 minutes in the private party room',
      'Unlimited play until we close',
    ],
    sections: [
      {
        header: "What's included",
        details:
          'Up to 24 kids and 24 adults\n90 minutes in the private party room\nUnlimited play in the facility until we close\nStaff / Bookeo import package',
      },
    ],
  },
  [ACTIVITY_IDS.party36]: {
    description:
      'Legacy party package for up to 36 kids and 36 adults (staff / import). 90 minutes private room + unlimited play until close.',
    inclusions: [
      'Up to 36 kids and 36 adults included',
      '90 minutes in the private party room',
      'Unlimited play until we close',
    ],
    sections: [
      {
        header: "What's included",
        details:
          'Up to 36 kids and 36 adults\n90 minutes in the private party room\nUnlimited play in the facility until we close\nStaff / Bookeo import package',
      },
    ],
  },
  [ACTIVITY_IDS.dropIn]: {
    description:
      'Drop-in play with unlimited time from your booked start until we close (subject to private events or early closings). Enjoy the jumping pillow, ninja course, ballistics arena, donut slide, and main structure. Guests who book online are guaranteed at least 2 hours from their start time.',
    inclusions: [
      'Unlimited play from your booked time until close',
      '1 free adult per paying child (additional adults may be charged)',
      '1 free non-moving baby per paying child (additional babies may be charged)',
      'Doors typically 10am–8pm; final admissions often 6:30pm on regular days',
    ],
    sections: [
      {
        header: "What's included",
        details:
          'Drop-in play — unlimited time until we close.\nDoors open at 10am and close at 8:00pm on regular days. Final admissions are typically at 6:30pm. Private events and holidays may change hours — check the website for the day you visit.\n\n1 free adult per paying child. Additional adults may be charged.\n1 free non-moving baby per paying child. Additional non-moving babies may be charged.\nUnder age 1 without a paying sibling is not free.\n\nBook online for unlimited play from your start time until close. Online guests receive a guaranteed 2 hours from their booked start time. Other guests may also be in the facility.',
      },
      {
        header: '$10 at 10am deal',
        details:
          'Tickets must be purchased online for the 10:00am time slot, and you must arrive by 10:30am or regular admission rates apply.',
      },
      {
        header: 'Facility notes',
        details:
          'Socks required for everyone past admission. Waivers required. No outside food or drink (formula/water exceptions as posted). Come play on the jumping pillow, ninja course, ballistics arena, donut slide, and main structure.',
      },
    ],
  },
  [ACTIVITY_IDS.paDay2526]: {
    description:
      'PA Day day camp at Off The Wall Kids London for school PA Days (2025–2026). Full-day supervised camp with access to our indoor playground — lunch and snacks included where listed on the booking.',
    inclusions: [
      'Full-day PA Day camp program',
      'Indoor playground access with counsellor-led activities',
      'Lunch and snacks included where listed at booking',
      'Camper registration / medical form required',
    ],
    sections: [
      {
        header: 'About this camp',
        details:
          'When school is out for a PA Day, campers spend the day at our East London indoor playground with supervised activities on the volcano slide, donut slide, ballistics arena, and more.',
      },
      {
        header: "What's included",
        details:
          'Full-day PA Day camp (see schedule on your booking)\nSupervised play and counsellor-led activities\nLunch and snacks included when listed for that date\nCamper registration and medical form required before camp',
      },
    ],
  },
  [ACTIVITY_IDS.paDay2627]: {
    description:
      'PA Day day camp at Off The Wall Kids London for school PA Days (2026–2027). Full-day supervised camp with indoor playground access — lunch and snacks included where listed on the booking.',
    inclusions: [
      'Full-day PA Day camp program',
      'Indoor playground access with counsellor-led activities',
      'Lunch and snacks included where listed at booking',
      'Camper registration / medical form required',
    ],
    sections: [
      {
        header: 'About this camp',
        details:
          'PA Day camp for the 2026–2027 school year — supervised full-day programming inside our indoor playground.',
      },
      {
        header: "What's included",
        details:
          'Full-day PA Day camp (see schedule on your booking)\nSupervised play and counsellor-led activities\nLunch and snacks included when listed for that date\nCamper registration and medical form required before camp',
      },
    ],
  },
  [ACTIVITY_IDS.singleDayCamp]: {
    description:
      'Single-day summer camp for ages 4–12. Full day (typically 8:30am–4:30pm) with lunch and snacks included, counsellor-led activities, and full indoor playground access.',
    inclusions: [
      'Ages 4–12',
      'Full day ~8:30am–4:30pm',
      'Lunch and snacks included',
      'Camper registration / medical form required',
    ],
    sections: [
      {
        header: 'About this camp',
        details:
          'A full single day of summer camp at Off The Wall Kids London — structured games, supervised play, and the same playground families love for birthdays and drop-in visits.',
      },
      {
        header: "What's included",
        details:
          'Ages 4–12\nTypical hours 8:30am–4:30pm (confirm on booking)\nLunch and snacks included\nCounsellor-led activities and full facility access\nCamper registration and medical form required',
      },
    ],
  },
  [ACTIVITY_IDS.weekCamp]: {
    description:
      'Week-long summer day camp for ages 4–12. Monday–Friday (typically 8:30am–4:30pm) with lunch and snacks included, themed weeks, counsellor-led activities, and full indoor playground access.',
    inclusions: [
      'Ages 4–12',
      'Monday–Friday full days (~8:30am–4:30pm)',
      'Lunch and snacks included',
      'Camper registration / medical form required',
    ],
    sections: [
      {
        header: 'About this camp',
        details:
          'Keep kids active all summer with a full week of camp inside our climate-controlled indoor playground in East London. Themed weeks, lunch included, and counsellor-led fun.',
      },
      {
        header: "What's included",
        details:
          'Ages 4–12\nMonday–Friday, typically 8:30am–4:30pm (confirm on booking)\nLunch and snacks included\nCounsellor-led activities and full facility access\nCamper registration and medical form required',
      },
    ],
  },
  [ACTIVITY_IDS.community]: {
    description:
      'Community Partner Night — private / partner event booking at Off The Wall Kids London. Hours and inclusions follow the partner agreement for that date.',
    inclusions: ['Community / partner event booking', 'See staff notes for that date'],
    sections: [
      {
        header: 'About this booking',
        details:
          'Reserved for community partner nights and related private event bookings. Confirm timing and guest rules with Off The Wall Kids staff.',
      },
    ],
  },
};

function fixDigitalHostName(addonSettings) {
  if (!addonSettings || typeof addonSettings !== 'object') return { changed: false, next: addonSettings };
  const portal = addonSettings.portal_options;
  if (!portal || !Array.isArray(portal.groups)) return { changed: false, next: addonSettings };

  let changed = false;
  const groups = portal.groups.map((group) => {
    const options = Array.isArray(group.options)
      ? group.options.map((opt) => {
          const name = String(opt?.name || '');
          if (/^Digital Host \(TV Screen$/i.test(name) || /^Digital Host \(TV Screen$/i.test(name.trim())) {
            changed = true;
            return { ...opt, name: 'Digital Host (TV Screen)' };
          }
          if (name.includes('Digital Host (TV Screen') && !name.includes(')')) {
            changed = true;
            return { ...opt, name: 'Digital Host (TV Screen)' };
          }
          return opt;
        })
      : group.options;
    return { ...group, options };
  });

  return {
    changed,
    next: changed
      ? { ...addonSettings, portal_options: { ...portal, groups } }
      : addonSettings,
  };
}

async function upsertTermsPackage() {
  const { data: existing } = await supabase
    .from('booking_terms_packages')
    .select('id, name')
    .eq('business_id', BIZ)
    .ilike('name', '%Party Terms%')
    .maybeSingle();

  let packageId = existing?.id || null;

  if (packageId) {
    const { error } = await supabase
      .from('booking_terms_packages')
      .update({
        name: 'Party Terms & Conditions',
        description:
          'Important party policies, food rules, guest requirements, and cancellation terms for birthday parties and private facility bookings.',
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', packageId)
      .eq('business_id', BIZ);
    if (error) throw error;
    await supabase.from('booking_terms_steps').delete().eq('package_id', packageId).eq('business_id', BIZ);
    console.log('Updated existing Party Terms package:', packageId);
  } else {
    packageId = randomUUID();
    const { error } = await supabase.from('booking_terms_packages').insert({
      id: packageId,
      business_id: BIZ,
      name: 'Party Terms & Conditions',
      description:
        'Important party policies, food rules, guest requirements, and cancellation terms for birthday parties and private facility bookings.',
      is_active: true,
    });
    if (error) throw error;
    console.log('Created Party Terms package:', packageId);
  }

  const steps = TERMS_STEPS.map((step, index) => ({
    package_id: packageId,
    business_id: BIZ,
    step_order: index,
    title: step.title,
    body: step.body,
    require_acknowledge: true,
  }));

  const { error: stepError } = await supabase.from('booking_terms_steps').insert(steps);
  if (stepError) throw stepError;
  console.log(`Inserted ${steps.length} terms steps`);
  return packageId;
}

async function ensurePrivateFacilityActivity(termsPackageId) {
  const { data: existing } = await supabase
    .from('booking_activities')
    .select('id, activity_name, terms_package_id, ticket_settings, addon_settings')
    .eq('business_id', BIZ)
    .ilike('activity_name', '%Private Facility%')
    .maybeSingle();

  const description =
    'Private facility rental for up to 150 people (75 kids and 75 adults). Includes a 2-hour party block, $150 food credit, and exclusive use of the facility — no other public guests during your rental.';
  const inclusions = [
    '2-hour private party / facility rental',
    'Up to 150 people (75 kids & 75 adults)',
    '$150 food credit',
    'No other public guests in the facility during your rental',
  ];
  const sections = [
    {
      header: 'About this rental',
      details:
        'Book the whole facility for a large celebration or private event. Your group gets exclusive access for the booked window — ideal when a standard party package is not enough space.',
    },
    {
      header: "What's included",
      details:
        '2-hour private facility rental\nUp to 150 people (75 kids and 75 adults)\n$150 food credit toward concession\nNo other public guests in the facility during your rental',
    },
    {
      header: 'Good to know',
      details:
        'Socks required for everyone past admission. Party Terms & Conditions apply (cakes/cupcakes rules, guest list, waivers, cancellation policy). Contact Off The Wall Kids to confirm availability for large private rentals.',
    },
  ];

  let activityId = existing?.id;
  if (!activityId) {
    activityId = randomUUID();
    const ticketSettings = {
      inventory_item_ids: [PRIVATE_FACILITY_INVENTORY_ID],
      primary_inventory_item_id: PRIVATE_FACILITY_INVENTORY_ID,
    };
    const { error } = await supabase.from('booking_activities').insert({
      id: activityId,
      business_id: BIZ,
      type_id: BIRTHDAY_TYPE_ID,
      activity_name: 'Private Facility Rental',
      description,
      website_package_inclusions: inclusions,
      website_show_party_package: true,
      website_food_credit: 150,
      website_sort_order: 40,
      duration_minutes: 120,
      max_capacity: 150,
      requires_waiver: true,
      requires_camper_registration: false,
      is_active: true,
      portal_visible: false,
      party_included_kids: 75,
      party_included_adults: 75,
      ticket_settings: ticketSettings,
      terms_package_id: termsPackageId,
    });
    if (error) throw error;
    console.log('Created Private Facility Rental activity:', activityId);
  } else {
    const { error } = await supabase
      .from('booking_activities')
      .update({
        description,
        website_package_inclusions: inclusions,
        website_show_party_package: true,
        website_food_credit: 150,
        duration_minutes: 120,
        requires_waiver: true,
        is_active: true,
        terms_package_id: termsPackageId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activityId)
      .eq('business_id', BIZ);
    if (error) throw error;
    console.log('Updated Private Facility Rental activity:', activityId);
  }

  await replaceSections(activityId, sections);
  return activityId;
}

async function replaceSections(activityId, sections) {
  await supabase.from('booking_activity_sections').delete().eq('activity_id', activityId).eq('business_id', BIZ);
  if (!sections?.length) return;
  const rows = sections.map((section, index) => ({
    activity_id: activityId,
    business_id: BIZ,
    section_header: section.header,
    section_details: section.details,
    display_order: index,
  }));
  const { error } = await supabase.from('booking_activity_sections').insert(rows);
  if (error) throw error;
}

async function attachTermsToPartyActivities(termsPackageId) {
  const partyIds = [
    ACTIVITY_IDS.classic,
    ACTIVITY_IDS.super,
    ACTIVITY_IDS.ultimate,
    ACTIVITY_IDS.party12,
    ACTIVITY_IDS.party24,
    ACTIVITY_IDS.party36,
  ];

  const { error } = await supabase
    .from('booking_activities')
    .update({ terms_package_id: termsPackageId, updated_at: new Date().toISOString() })
    .eq('business_id', BIZ)
    .in('id', partyIds);
  if (error) throw error;
  console.log(`Attached terms package to ${partyIds.length} party activities`);
}

async function refreshActivityContent() {
  for (const [activityId, content] of Object.entries(ACTIVITY_CONTENT)) {
    const { data: activity, error: fetchError } = await supabase
      .from('booking_activities')
      .select('id, activity_name, addon_settings')
      .eq('id', activityId)
      .eq('business_id', BIZ)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!activity) {
      console.warn('Skip missing activity', activityId);
      continue;
    }

    const { changed, next } = fixDigitalHostName(activity.addon_settings);
    const updates = {
      description: content.description,
      website_package_inclusions: content.inclusions,
      updated_at: new Date().toISOString(),
    };
    if (changed) updates.addon_settings = next;

    const { error } = await supabase
      .from('booking_activities')
      .update(updates)
      .eq('id', activityId)
      .eq('business_id', BIZ);
    if (error) throw error;

    await replaceSections(activityId, content.sections);
    console.log(
      `Updated content: ${activity.activity_name}${changed ? ' (fixed Digital Host name)' : ''}`,
    );
  }
}

async function main() {
  const packageId = await upsertTermsPackage();
  await attachTermsToPartyActivities(packageId);
  const privateId = await ensurePrivateFacilityActivity(packageId);
  await refreshActivityContent();

  const { data: verify } = await supabase
    .from('booking_activities')
    .select('activity_name, terms_package_id, portal_visible')
    .eq('business_id', BIZ)
    .not('terms_package_id', 'is', null)
    .order('activity_name');

  console.log('\nActivities with Party Terms attached:');
  for (const row of verify || []) {
    console.log(` - ${row.activity_name} (portal=${row.portal_visible})`);
  }
  console.log('\nPrivate Facility activity id:', privateId);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
