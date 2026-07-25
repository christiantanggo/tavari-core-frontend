-- Revert ticket prices for business cb982fca-cf7a-4f59-b9c7-55ca0364eddc
-- After $1.00 test pricing — run this when testing is done.
-- Snapshot taken before test pricing change.

UPDATE pos_inventory SET price = 9.29 WHERE id = '265a93f2-4fab-4218-b600-9524643b5710'; -- Aged 0-11 Months
UPDATE pos_inventory SET price = 9.29 WHERE id = '58eefcbc-784c-4f27-ac57-4d178689f4c0'; -- Gen Admission (Aged 0-23 Months)
UPDATE pos_inventory SET price = 13.27 WHERE id = '89cbb714-1f73-4e5f-b0ea-894242fc71f4'; -- Gen Admission (Aged 2-17)
UPDATE pos_inventory SET price = 5.31 WHERE id = '8ac8b82d-24f4-46d3-a1aa-f90e61259579'; -- Adult
