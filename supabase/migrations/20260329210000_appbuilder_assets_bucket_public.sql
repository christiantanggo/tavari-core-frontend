-- Branding files (logo, favicon) use getPublicUrl() and are shown in <img src="..."> on
-- public routes (waiver welcome, booking portal, etc.). Browsers do not send Supabase
-- auth on image requests, so a private bucket yields broken images for anonymous users.
UPDATE storage.buckets
SET public = true
WHERE id = 'appbuilder-assets';
