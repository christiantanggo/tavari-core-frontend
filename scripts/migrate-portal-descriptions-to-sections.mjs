/**
 * Move customer-facing booking_activities.description into booking_activity_sections
 * for portal-visible activities, then clear description.
 *
 * Run: node scripts/migrate-portal-descriptions-to-sections.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = process.env.MIGRATE_BUSINESS_ID || 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const DROP_IN_ID = '59cf5820-0ec2-49d4-b1d3-8c7475d72e47';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function sectionDetailsFromDescription(activityId, description) {
  const text = String(description || '').trim();
  if (!text) return '';
  if (activityId === DROP_IN_ID) {
    return 'Drop-In Play - Unlimited Time!';
  }
  return text.split('·').map((part) => part.trim()).filter(Boolean).join('\n');
}

async function main() {
  const { data: activities, error } = await supabase
    .from('booking_activities')
    .select('id, activity_name, description, business_id')
    .eq('business_id', BIZ)
    .eq('portal_visible', true)
    .eq('is_active', true);

  if (error) throw error;

  for (const activity of activities || []) {
    const desc = String(activity.description || '').trim();
    const { count } = await supabase
      .from('booking_activity_sections')
      .select('id', { count: 'exact', head: true })
      .eq('activity_id', activity.id);

    if ((count || 0) === 0 && desc) {
      const details = sectionDetailsFromDescription(activity.id, desc);
      if (details) {
        const { error: insertError } = await supabase.from('booking_activity_sections').insert({
          activity_id: activity.id,
          business_id: activity.business_id,
          section_header: "What's included",
          section_details: details,
          display_order: 0,
        });
        if (insertError) throw insertError;
        console.log('section created:', activity.activity_name);
      }
    }

    if (desc) {
      const { error: clearError } = await supabase
        .from('booking_activities')
        .update({ description: null, updated_at: new Date().toISOString() })
        .eq('id', activity.id);
      if (clearError) throw clearError;
      console.log('cleared description:', activity.activity_name);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
