-- Allow participant_id to be NULL on booking_participants so customer portal can insert
-- participants when the participant comes from waiver_participants (no row in booking_customer_participants).
-- The FK to booking_customer_participants remains; null is allowed.
ALTER TABLE booking_participants
  ALTER COLUMN participant_id DROP NOT NULL;
