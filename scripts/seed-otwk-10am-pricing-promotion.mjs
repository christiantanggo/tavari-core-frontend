/**
 * Seed OTWK $10 at 10am automatic pricing promotion.
 * Run: node scripts/seed-otwk-10am-pricing-promotion.mjs
 */
import { createClient } from '@supabase/supabase-js';

const BUSINESS_ID = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const CHILD_TICKET_ID = '89cbb714-1f73-4e5f-b0ea-894242fc71f4';
const INFANT_TICKET_ID = '58eefcbc-784c-4f27-ac57-4d178689f4c0';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRole) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRole);

async function resolveTicketIds() {
  const { data, error } = await supabase
    .from('pos_inventory')
    .select('id, name, price')
    .eq('business_id', BUSINESS_ID)
    .eq('is_active', true)
    .ilike('name', '%admission%');

  if (error) throw error;

  const child = data.find((row) => /2.?17|2-17|ages 2/i.test(row.name));
  const infant = data.find((row) => /0.?23|0-23|months/i.test(row.name));

  return {
    childId: child?.id || CHILD_TICKET_ID,
    infantId: infant?.id || INFANT_TICKET_ID,
    rows: data,
  };
}

async function main() {
  const { childId, infantId, rows } = await resolveTicketIds();
  console.log('Admission tickets found:', rows.map((row) => `${row.name} (${row.id})`).join(', '));

  const payload = {
    business_id: BUSINESS_ID,
    name: '$10 at 10am',
    description: 'Online admission is $10 for the 10:00 AM time slot.',
    is_active: true,
    priority: 100,
    promo_code: null,
    channel: 'online',
    activity_scope: { mode: 'all', category_keys: [], activity_ids: [] },
    visit_times: ['10:00:00'],
    price_adjustments: {
      mode: 'override_prices',
      items: [
        { inventory_item_id: childId, price: 10 },
        { inventory_item_id: infantId, price: 10 },
      ],
    },
    apply_conditional_free_rules: true,
  };

  const { data: existing, error: existingError } = await supabase
    .from('booking_pricing_promotions')
    .select('id, name')
    .eq('business_id', BUSINESS_ID)
    .eq('name', payload.name)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.id) {
    const { error } = await supabase
      .from('booking_pricing_promotions')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw error;
    console.log('Updated promotion:', existing.id);
    return;
  }

  const { data, error } = await supabase
    .from('booking_pricing_promotions')
    .insert(payload)
    .select('id')
    .single();
  if (error) throw error;
  console.log('Created promotion:', data.id);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
