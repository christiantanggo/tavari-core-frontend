-- Add voice_style field to voice_agents table
-- This field allows customization of voice delivery style

ALTER TABLE voice_agents 
ADD COLUMN IF NOT EXISTS voice_style text;

COMMENT ON COLUMN voice_agents.voice_style IS 'Voice style/delivery mode (e.g., conversational, professional, friendly, energetic). Used by voice providers that support style variations.';

