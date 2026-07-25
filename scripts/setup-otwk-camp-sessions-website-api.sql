-- OTWK London: expose camp sessions via tavari-api-camp-sessions.
-- Run after camp schedules exist (setup-otwk-*-camp-schedule.mjs).

-- PA Day camp (2025-2026)
UPDATE public.booking_activities SET
  website_show_camp_sessions = true,
  website_camp_program = 'pa_day',
  website_camp_age_min = 4,
  website_camp_age_max = 12,
  website_camp_schedule_summary = '8:30am–4:30pm full day with lunch, snacks & drinks included',
  portal_visible = true
WHERE id = '6df2118d-d593-4b10-8253-b121a367027b'
  AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

-- PA Day camp (2026-2027 — TVDSB calendar)
UPDATE public.booking_activities SET
  website_show_camp_sessions = true,
  website_camp_program = 'pa_day',
  website_camp_age_min = 4,
  website_camp_age_max = 12,
  website_camp_schedule_summary = '8:30am–4:30pm full day with lunch, snacks & drinks included',
  portal_visible = true
WHERE id = '4953a3fc-cb09-41c0-85c3-c249bf21ef34'
  AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

-- Week-long summer camp
UPDATE public.booking_activities SET
  website_show_camp_sessions = true,
  website_camp_program = 'summer_week',
  website_camp_age_min = 4,
  website_camp_age_max = 12,
  website_camp_schedule_summary = '8:30am–4:30pm Monday–Friday with lunch & snacks included',
  portal_visible = true
WHERE id = '509bdac0-30fd-400c-a03b-889eb2c80e62'
  AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

-- Single-day summer camp
UPDATE public.booking_activities SET
  website_show_camp_sessions = true,
  website_camp_program = 'summer_single',
  website_camp_age_min = 4,
  website_camp_age_max = 12,
  website_camp_schedule_summary = '8:30am–4:30pm full day with lunch & snacks included',
  portal_visible = true
WHERE id = '25477f78-90a9-4f80-bf4e-155f25d4d550'
  AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

-- When March Break / Winter Break activities exist, set website_camp_program accordingly:
-- UPDATE public.booking_activities SET website_show_camp_sessions = true, website_camp_program = 'march_break', ...
-- UPDATE public.booking_activities SET website_show_camp_sessions = true, website_camp_program = 'winter_break', ...
