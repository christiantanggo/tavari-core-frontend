-- Wide products: two adjacent columns vend two RS485 motors at the same time.

ALTER TABLE public.vending_device_slots
  ADD COLUMN IF NOT EXISTS dual_vend_col_num INTEGER,
  ADD COLUMN IF NOT EXISTS rs485_lane_byte_secondary INTEGER;

ALTER TABLE public.vending_device_slots
  DROP CONSTRAINT IF EXISTS vending_device_slots_dual_vend_col_check;

ALTER TABLE public.vending_device_slots
  ADD CONSTRAINT vending_device_slots_dual_vend_col_check
  CHECK (
    dual_vend_col_num IS NULL
    OR (
      dual_vend_col_num >= 1
      AND dual_vend_col_num <= 10
      AND dual_vend_col_num <> col_num
    )
  );

ALTER TABLE public.vending_device_slots
  DROP CONSTRAINT IF EXISTS vending_device_slots_rs485_lane_secondary_check;

ALTER TABLE public.vending_device_slots
  ADD CONSTRAINT vending_device_slots_rs485_lane_secondary_check
  CHECK (
    rs485_lane_byte_secondary IS NULL
    OR (rs485_lane_byte_secondary >= 0 AND rs485_lane_byte_secondary <= 99)
  );

COMMENT ON COLUMN public.vending_device_slots.dual_vend_col_num IS
  'When set, this slot also fires the motor at (row_num, dual_vend_col_num) simultaneously (wide product).';

COMMENT ON COLUMN public.vending_device_slots.rs485_lane_byte_secondary IS
  'Optional override lane byte for dual_vend_col_num; defaults from row/col.';

ALTER TABLE public.vending_device_dispense_commands
  ADD COLUMN IF NOT EXISTS lane_byte_secondary INTEGER
  CHECK (lane_byte_secondary IS NULL OR (lane_byte_secondary >= 0 AND lane_byte_secondary <= 99));

COMMENT ON COLUMN public.vending_device_dispense_commands.lane_byte_secondary IS
  'Second motor lane for simultaneous dual-column RS485 test vends.';
