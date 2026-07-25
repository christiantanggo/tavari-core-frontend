-- Atomic stock adjustments for POS inventory (including bundle component deduction).

CREATE OR REPLACE FUNCTION public.apply_pos_inventory_stock_adjustments(
  p_business_id uuid,
  p_adjustments jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  adj record;
  applied_count integer := 0;
BEGIN
  IF p_business_id IS NULL OR p_adjustments IS NULL OR jsonb_typeof(p_adjustments) != 'array' THEN
    RETURN 0;
  END IF;

  FOR adj IN
    SELECT
      (elem->>'inventory_id')::uuid AS inventory_id,
      (elem->>'quantity_delta')::integer AS quantity_delta
    FROM jsonb_array_elements(p_adjustments) AS elem
    WHERE (elem->>'inventory_id') IS NOT NULL
      AND (elem->>'quantity_delta') IS NOT NULL
      AND (elem->>'quantity_delta')::integer != 0
  LOOP
    UPDATE public.pos_inventory
    SET
      stock_quantity = GREATEST(0, COALESCE(stock_quantity, 0) + adj.quantity_delta),
      updated_at = now()
    WHERE id = adj.inventory_id
      AND business_id = p_business_id
      AND track_stock = true;

    IF FOUND THEN
      applied_count := applied_count + 1;
    END IF;
  END LOOP;

  RETURN applied_count;
END;
$$;

COMMENT ON FUNCTION public.apply_pos_inventory_stock_adjustments(uuid, jsonb) IS
  'Apply stock deltas to tracked pos_inventory rows. Used for sales (negative delta) and restocks (positive).';

GRANT EXECUTE ON FUNCTION public.apply_pos_inventory_stock_adjustments(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pos_inventory_stock_adjustments(uuid, jsonb) TO service_role;
