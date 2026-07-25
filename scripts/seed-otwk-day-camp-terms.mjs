/**
 * OTWK: seed Day Camp Terms & Conditions package and attach to day camp activities.
 *
 * Usage: node scripts/seed-otwk-day-camp-terms.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

const DAY_CAMP_ACTIVITY_IDS = [
  '6df2118d-d593-4b10-8253-b121a367027b', // PA Day 2025-2026
  '4953a3fc-cb09-41c0-85c3-c249bf21ef34', // PA Day 2026-2027
  '25477f78-90a9-4f80-bf4e-155f25d4d550', // Single-day summer
  '509bdac0-30fd-400c-a03b-889eb2c80e62', // Week-long summer
];

const PACKAGE_NAME = 'Day Camp Terms & Conditions';

const TERMS_STEPS = [
  {
    title: 'Welcome & what happens next',
    body: `Thanks for booking your child a spot at Off The Wall Kids Day Camp. We are excited to welcome your child for a day of play and fun activities.

Your deposit holds your spot. The final amount can be paid the morning of drop-off. Contact us at info@offthewallkids.ca if you would like to pay the full amount before camp morning.

Please read each section carefully and acknowledge before continuing your booking.`,
  },
  {
    title: '1. Registration & medical information',
    body: `Each camper must have a current Registration & Camper Medical Information form on file.

• Forms remain valid for 12 months from the date completed.
• If your child already has a valid form that covers the camp date you are booking, you will not be asked to fill it out again.
• If the form is missing or will be expired by camp day, you must complete it during this booking.
• Even if your child has no special medical information, please still complete the medical sections with N/A so nothing is left blank.

This keeps emergency contacts, allergies, medications, and authorized pickup details accurate and up to date.`,
  },
  {
    title: '2. Waivers',
    body: `Please have an updated waiver completed for your children before camp day.

Waivers can be completed through Off The Wall Kids (www.offthewallkids.ca) or during the booking process when required.`,
  },
  {
    title: '3. Socks-only facility',
    body: `Off The Wall Kids is a socks-only facility.

• Please ensure your children have socks to wear inside the facility.
• We recommend sending a couple of extra pairs.
• Please speak with your children about keeping their socks on during Day Camp.
• Campers who do not follow the socks-only rule will be unable to play in the play structure and surrounding play area.`,
  },
  {
    title: '4. No outside food or drink',
    body: `No outside food or drink is permitted at Off The Wall Kids.

• Please send ONLY a personal water bottle with your child.
• Lunch and snack are provided — do not send other food or drink items.
• Please do not send extra money for treats; that is best left for pickup time.`,
  },
  {
    title: '5. Pick-up procedures',
    body: `For your child's safety, campers are only released to adults listed as authorized pick-ups on the Registration & Camper Medical Information form.

• Only people you list as authorized pick-ups may collect your child — no exceptions.
• Authorized pick-ups must be 16 years of age or older.
• Photo ID is required every day at pick-up. Please bring ID so staff can verify who is collecting your child.
• If pick-up plans change, update authorized pick-ups on the registration form (or contact us) before camp day.

At pick-up, the Supervisor will check photo ID and confirm the adult is on your child's authorized pick-up list before releasing your camper.`,
  },
  {
    title: '6. Cancellation policy',
    body: `Deposits are NON-REFUNDABLE.

If you cancel a Day Camp booking:
• Cancelled within 48 hours of the camp date: your deposit may be added to your account for future visits.
• Cancelled after the 48-hour mark: the deposit paid to hold your spot is forfeited.
• Full-week bookings receiving the Full Week Discount: if days are missed during the week, you remain responsible to pay for the missed days because the discount applies across all booked days.
• No-show: the deposit for that booking is forfeited.

Please contact us if you have any questions.`,
  },
];

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: existing } = await supabase
    .from('booking_terms_packages')
    .select('id, name')
    .eq('business_id', BIZ)
    .eq('name', PACKAGE_NAME)
    .maybeSingle();

  let packageId = existing?.id || null;

  if (!packageId) {
    packageId = randomUUID();
    const { error } = await supabase.from('booking_terms_packages').insert({
      id: packageId,
      business_id: BIZ,
      name: PACKAGE_NAME,
      description:
        'Day Camp policies: registration/medical forms, waivers, socks-only, no outside food, pick-up procedures, and cancellation.',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    console.log('Created package', packageId);
  } else {
    console.log('Using existing package', packageId);
  }

  await supabase.from('booking_terms_steps').delete().eq('package_id', packageId).eq('business_id', BIZ);

  const steps = TERMS_STEPS.map((step, index) => ({
    id: randomUUID(),
    business_id: BIZ,
    package_id: packageId,
    step_order: index + 1,
    title: step.title,
    body: step.body,
    require_acknowledge: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { error: stepsError } = await supabase.from('booking_terms_steps').insert(steps);
  if (stepsError) throw stepsError;
  console.log(`Inserted ${steps.length} steps`);

  for (const activityId of DAY_CAMP_ACTIVITY_IDS) {
    const { error } = await supabase
      .from('booking_activities')
      .update({
        terms_package_id: packageId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activityId)
      .eq('business_id', BIZ);
    if (error) {
      console.warn('Failed to attach terms to', activityId, error.message);
    } else {
      console.log('Attached terms to activity', activityId);
    }
  }

  // Seed camp guide URLs on ticket_settings for companion email
  const guideByActivity = {
    '6df2118d-d593-4b10-8253-b121a367027b': 'https://www.offthewallkids.ca/pa-day-activities-london-ontario',
    '4953a3fc-cb09-41c0-85c3-c249bf21ef34': 'https://www.offthewallkids.ca/pa-day-activities-london-ontario',
    '25477f78-90a9-4f80-bf4e-155f25d4d550': 'https://www.offthewallkids.ca/summer-camps-london-ontario',
    '509bdac0-30fd-400c-a03b-889eb2c80e62': 'https://www.offthewallkids.ca/summer-camps-london-ontario',
  };

  for (const [activityId, guideUrl] of Object.entries(guideByActivity)) {
    const { data: act } = await supabase
      .from('booking_activities')
      .select('ticket_settings')
      .eq('id', activityId)
      .eq('business_id', BIZ)
      .maybeSingle();
    const settings = act?.ticket_settings && typeof act.ticket_settings === 'object' ? { ...act.ticket_settings } : {};
    settings.camp_guide_url = guideUrl;
    // Keep auto-approve for day camp
    if (!settings.online_payment || typeof settings.online_payment !== 'object') {
      settings.online_payment = { auto_approve: true };
    } else if (settings.online_payment.auto_approve === false) {
      // Do not flip staff-approval activities accidentally; only set when missing
    } else {
      settings.online_payment = { ...settings.online_payment, auto_approve: true };
    }
    await supabase
      .from('booking_activities')
      .update({ ticket_settings: settings, updated_at: new Date().toISOString() })
      .eq('id', activityId)
      .eq('business_id', BIZ);
    console.log('Set camp_guide_url for', activityId);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
