-- Align vending module catalog copy with standalone add-on positioning

UPDATE public.app_modules
SET
  description = 'Cloud vending devices, kiosk links, optional catalog mapping. Standalone add-on; Tavari POS is not required.',
  icon = 'FiCpu'
WHERE module_key = 'vending';
