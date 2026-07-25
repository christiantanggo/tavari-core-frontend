-- Add knowledge_base field to voice_agents table
-- This field stores business-specific information that the AI can reference

ALTER TABLE voice_agents 
ADD COLUMN IF NOT EXISTS knowledge_base text;

COMMENT ON COLUMN voice_agents.knowledge_base IS 'Business-specific knowledge base that the AI can reference. The AI should only answer questions based on this information and redirect unknown questions to the business.';


