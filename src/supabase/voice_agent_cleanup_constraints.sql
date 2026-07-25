-- Cleanup script to drop existing constraints before running the main migration
-- Run this first if you get constraint already exists errors

-- Drop constraints if they exist (safe to run multiple times)
DO $$ 
BEGIN
    -- Drop foreign key constraints
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_bookings_business_id_fkey'
    ) THEN
        ALTER TABLE voice_agent_bookings DROP CONSTRAINT voice_agent_bookings_business_id_fkey;
        RAISE NOTICE 'Dropped constraint: voice_agent_bookings_business_id_fkey';
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_bookings_agent_id_fkey'
    ) THEN
        ALTER TABLE voice_agent_bookings DROP CONSTRAINT voice_agent_bookings_agent_id_fkey;
        RAISE NOTICE 'Dropped constraint: voice_agent_bookings_agent_id_fkey';
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_bookings_call_id_fkey'
    ) THEN
        ALTER TABLE voice_agent_bookings DROP CONSTRAINT voice_agent_bookings_call_id_fkey;
        RAISE NOTICE 'Dropped constraint: voice_agent_bookings_call_id_fkey';
    END IF;
    
    -- Drop check constraints
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_bookings_booking_type_check'
    ) THEN
        ALTER TABLE voice_agent_bookings DROP CONSTRAINT voice_agent_bookings_booking_type_check;
        RAISE NOTICE 'Dropped constraint: voice_agent_bookings_booking_type_check';
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_bookings_status_check'
    ) THEN
        ALTER TABLE voice_agent_bookings DROP CONSTRAINT voice_agent_bookings_status_check;
        RAISE NOTICE 'Dropped constraint: voice_agent_bookings_status_check';
    END IF;
    
    -- Drop unique constraints
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_bookings_confirmation_code_key'
    ) THEN
        ALTER TABLE voice_agent_bookings DROP CONSTRAINT voice_agent_bookings_confirmation_code_key;
        RAISE NOTICE 'Dropped constraint: voice_agent_bookings_confirmation_code_key';
    END IF;
    
    RAISE NOTICE 'Constraint cleanup complete. You can now run the main migration.';
END $$;

