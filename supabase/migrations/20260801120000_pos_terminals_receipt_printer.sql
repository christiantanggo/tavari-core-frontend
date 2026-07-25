-- Per-register-station receipt printer (ESC/POS network) next to Helcim hardware
ALTER TABLE public.pos_terminals
  ADD COLUMN IF NOT EXISTS receipt_printer_ip text,
  ADD COLUMN IF NOT EXISTS receipt_printer_port integer NOT NULL DEFAULT 9100,
  ADD COLUMN IF NOT EXISTS receipt_printer_type text NOT NULL DEFAULT 'escpos';

COMMENT ON COLUMN public.pos_terminals.receipt_printer_ip IS 'LAN IP of ESC/POS receipt printer for this register station';
COMMENT ON COLUMN public.pos_terminals.receipt_printer_port IS 'Raw TCP port for receipt printer (typically 9100)';
COMMENT ON COLUMN public.pos_terminals.receipt_printer_type IS 'Receipt printer protocol: escpos or none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pos_terminals_receipt_printer_type_check'
  ) THEN
    ALTER TABLE public.pos_terminals
      ADD CONSTRAINT pos_terminals_receipt_printer_type_check
      CHECK (receipt_printer_type IN ('escpos', 'none'));
  END IF;
END $$;
