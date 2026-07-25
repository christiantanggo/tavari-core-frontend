-- One-time: move wallkids legacy import rows to the correct business.
-- Run in Supabase Dashboard → SQL Editor (or: npx supabase db query --linked --file scripts/reassign-legacy-waivers-to-business.sql)
-- If you get a unique-violation on (business_id, source_system, legacy_row_id), the target business
-- already has that legacy_row_id; delete or merge the duplicate in the wrong business first, then re-run.

UPDATE public.legacy_waivers
SET business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
WHERE business_id = '69f610dc-1201-4447-9fea-bec62970b917'
  AND source_system = 'wallkids';

-- Verify:
-- select count(*) from public.legacy_waivers
--   where business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc' and source_system = 'wallkids';
-- select count(*) from public.legacy_waivers
--   where business_id = '69f610dc-1201-4447-9fea-bec62970b917' and source_system = 'wallkids';
