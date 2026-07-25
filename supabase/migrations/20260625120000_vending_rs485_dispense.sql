-- RS485 local dispense: no vendor cloud required on device.

ALTER TABLE public.vending_devices
  ADD COLUMN IF NOT EXISTS dispense_mode TEXT NOT NULL DEFAULT 'cloud';

ALTER TABLE public.vending_devices
  DROP CONSTRAINT IF EXISTS vending_devices_dispense_mode_check;

ALTER TABLE public.vending_devices
  ADD CONSTRAINT vending_devices_dispense_mode_check
  CHECK (dispense_mode IN ('cloud', 'rs485'));

COMMENT ON COLUMN public.vending_devices.dispense_mode IS
  'cloud = Yishouyun order_build; rs485 = on-tablet serial bridge (ttyS4).';

ALTER TABLE public.vending_device_slots
  ADD COLUMN IF NOT EXISTS rs485_lane_byte INTEGER;

COMMENT ON COLUMN public.vending_device_slots.rs485_lane_byte IS
  'RS485 lane byte 0x00-0x63 for dispense command. Null = derive from row/col.';
