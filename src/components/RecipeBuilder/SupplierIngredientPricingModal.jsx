import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import {
  buildSupplierPricePreview,
  formatUnitPrice,
  getComparableUnitPrice,
  getSupplierPackSizeDraft,
  getSupplierPriceDraft,
  isDraftFieldCleared,
  resolveLinkDraft,
  saveSupplierIngredientPrices,
} from '../../utils/recipeSupplierPricing';

const SupplierIngredientPricingModal = ({ businessId, supplier, onClose, onSaved }) => {
  const [ingredients, setIngredients] = useState([]);
  const [priceByIngredientId, setPriceByIngredientId] = useState(new Map());
  const [priceDrafts, setPriceDrafts] = useState({});
  const [packSizeDrafts, setPackSizeDrafts] = useState({});
  const [linkDrafts, setLinkDrafts] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirtyIngredientIds, setDirtyIngredientIds] = useState(() => new Set());

  const markDirty = (ingredientId) => {
    setDirtyIngredientIds((prev) => {
      const next = new Set(prev);
      next.add(ingredientId);
      return next;
    });
  };

  const loadData = useCallback(async () => {
    if (!businessId || !supplier?.id) return;
    try {
      setLoading(true);
      const [{ data: ingredientsData, error: ingredientsError }, { data: pricesData, error: pricesError }] =
        await Promise.all([
          supabase
            .from('ingredients')
            .select('id, name, unit_of_measure, units_per_case, case_size')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .order('name'),
          supabase
            .from('rb_supplier_prices')
            .select('*')
            .eq('supplier_id', supplier.id)
            .eq('is_current', true),
        ]);

      if (ingredientsError) throw ingredientsError;
      if (pricesError) throw pricesError;

      const priceMap = new Map();
      const nextPriceDrafts = {};
      const nextPackSizeDrafts = {};
      const nextLinkDrafts = {};

      for (const record of pricesData || []) {
        if (!record.ingredient_id) continue;
        const ingredient = (ingredientsData || []).find((row) => row.id === record.ingredient_id);
        priceMap.set(record.ingredient_id, record);
        nextPriceDrafts[record.ingredient_id] = getSupplierPriceDraft(record);
        nextPackSizeDrafts[record.ingredient_id] = getSupplierPackSizeDraft(record, ingredient);
        nextLinkDrafts[record.ingredient_id] = record.product_url || '';
      }

      setIngredients(ingredientsData || []);
      setPriceByIngredientId(priceMap);
      setPriceDrafts(nextPriceDrafts);
      setPackSizeDrafts(nextPackSizeDrafts);
      setLinkDrafts(nextLinkDrafts);
      setDirtyIngredientIds(new Set());
    } catch (error) {
      console.error(error);
      toast.error('Failed to load ingredient prices');
    } finally {
      setLoading(false);
    }
  }, [businessId, supplier?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredIngredients = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return ingredients;
    return ingredients.filter(
      (ing) =>
        ing.name?.toLowerCase().includes(term)
        || ing.unit_of_measure?.toLowerCase().includes(term),
    );
  }, [ingredients, search]);

  const pricedCount = useMemo(
    () =>
      ingredients.filter((ing) => {
        const existing = priceByIngredientId.get(ing.id);
        const priceInDraft = ing.id in priceDrafts;
        const packInDraft = ing.id in packSizeDrafts;
        const priceDraft = priceInDraft ? priceDrafts[ing.id] : getSupplierPriceDraft(existing);
        const packDraft = packInDraft ? packSizeDrafts[ing.id] : getSupplierPackSizeDraft(existing, ing);
        return Boolean(buildSupplierPricePreview(ing, priceDraft, packDraft, existing, { priceInDraft, packInDraft }));
      }).length,
    [ingredients, priceDrafts, packSizeDrafts, priceByIngredientId],
  );

  const handleSave = async () => {
    const changedIngredients = ingredients.filter((ing) => dirtyIngredientIds.has(ing.id));
    if (changedIngredients.length === 0) {
      toast.error('Change at least one price before saving');
      return;
    }

    const missingPrice = changedIngredients.filter((ing) => {
      const existing = priceByIngredientId.get(ing.id);
      const priceCleared = isDraftFieldCleared(priceDrafts, ing.id);
      const url = resolveLinkDraft(linkDrafts, ing.id, existing);
      if (priceCleared && !url) return false;
      const priceInDraft = ing.id in priceDrafts;
      const packInDraft = ing.id in packSizeDrafts;
      const draft = priceInDraft ? priceDrafts[ing.id] : getSupplierPriceDraft(existing);
      const packDraft = packInDraft ? packSizeDrafts[ing.id] : getSupplierPackSizeDraft(existing, ing);
      return !buildSupplierPricePreview(ing, draft, packDraft, existing, { priceInDraft, packInDraft });
    });
    if (missingPrice.length > 0) {
      toast.error('Enter a price ($) for each row you changed');
      return;
    }

    try {
      setSaving(true);
      const savedCount = await saveSupplierIngredientPrices(supabase, {
        supplierId: supplier.id,
        ingredients: changedIngredients,
        priceDrafts,
        linkDrafts,
        packSizeDrafts,
        priceByIngredientId,
      });
      toast.success(`Saved ${savedCount} price${savedCount === 1 ? '' : 's'}`);
      await loadData();
      onSaved?.();
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to save prices');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div>
            <h3 style={styles.title}>Ingredient prices — {supplier.name}</h3>
            <p style={styles.subtitle}>
              Enter what you pay at this supplier. Set units per case when this supplier&apos;s case size differs from the ingredient default.
              {' '}
              {pricedCount} of {ingredients.length} priced.
            </p>
          </div>
          <button type="button" onClick={onClose} style={styles.closeButton} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div style={styles.toolbar}>
          <div style={styles.searchWrap}>
            <Search size={16} style={styles.searchIcon} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ingredients..."
              style={styles.searchInput}
            />
          </div>
          <button type="button" onClick={handleSave} disabled={saving || loading} style={styles.saveButton}>
            <Save size={16} />
            {saving ? 'Saving...' : 'Save prices'}
          </button>
        </div>

        {loading ? (
          <div style={styles.loading}>Loading ingredients...</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Ingredient</th>
                  <th style={styles.thUnit}>Unit</th>
                  <th style={styles.thPrice}>Case price ($)</th>
                  <th style={styles.thPack}>Units/case</th>
                  <th style={styles.thUrl}>Product URL (optional)</th>
                  <th style={styles.thPerUnit}>Per unit</th>
                </tr>
              </thead>
              <tbody>
                {filteredIngredients.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={styles.emptyCell}>No ingredients match your search.</td>
                  </tr>
                ) : (
                  filteredIngredients.map((ing) => {
                    const existing = priceByIngredientId.get(ing.id);
                    const priceInDraft = ing.id in priceDrafts;
                    const packInDraft = ing.id in packSizeDrafts;
                    const priceDraft = priceInDraft ? priceDrafts[ing.id] : getSupplierPriceDraft(existing);
                    const packDraft = packInDraft ? packSizeDrafts[ing.id] : getSupplierPackSizeDraft(existing, ing);
                    const previewFields = buildSupplierPricePreview(ing, priceDraft, packDraft, existing, { priceInDraft, packInDraft });
                    const unitPrice = previewFields
                      ? getComparableUnitPrice(previewFields, ing.unit_of_measure || 'each')
                      : null;
                    const defaultPack = ing.units_per_case ? String(ing.units_per_case) : '';

                    return (
                      <tr key={ing.id}>
                        <td style={styles.td}>{ing.name}</td>
                        <td style={styles.tdUnit}>{ing.unit_of_measure || 'each'}</td>
                        <td style={styles.tdPrice}>
                          <input
                            type="number"
                            step="0.0001"
                            min="0"
                            value={priceDraft}
                            onChange={(e) => {
                              markDirty(ing.id);
                              setPriceDrafts((prev) => ({ ...prev, [ing.id]: e.target.value }));
                            }}
                            placeholder="Case price"
                            style={styles.input}
                          />
                        </td>
                        <td style={styles.tdPack}>
                          <input
                            type="number"
                            step="1"
                            min="1"
                            value={packDraft}
                            onChange={(e) => {
                              markDirty(ing.id);
                              setPackSizeDrafts((prev) => ({ ...prev, [ing.id]: e.target.value }));
                            }}
                            placeholder={defaultPack ? `Default ${defaultPack}` : 'Units/case'}
                            style={styles.input}
                          />
                        </td>
                        <td style={styles.tdUrl}>
                          <input
                            type="url"
                            value={linkDrafts[ing.id] ?? ''}
                            onChange={(e) => {
                              markDirty(ing.id);
                              setLinkDrafts((prev) => ({ ...prev, [ing.id]: e.target.value }));
                            }}
                            placeholder="https://..."
                            style={styles.input}
                          />
                        </td>
                        <td style={styles.tdPerUnit}>
                          {unitPrice != null && unitPrice > 0
                            ? formatUnitPrice(unitPrice, ing.unit_of_measure || 'each')
                            : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1100,
    padding: '16px',
  },
  modal: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: '12px',
    width: '100%',
    maxWidth: '1200px',
    maxHeight: '92vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
    padding: '20px 24px',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
  },
  title: { margin: 0, fontSize: '20px', color: TavariStyles.colors.gray800 },
  subtitle: { margin: '6px 0 0', fontSize: '14px', color: TavariStyles.colors.gray600, maxWidth: '760px' },
  closeButton: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: TavariStyles.colors.gray500,
    padding: '4px',
  },
  toolbar: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    padding: '16px 24px',
    borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
    flexWrap: 'wrap',
  },
  searchWrap: { position: 'relative', flex: '1 1 240px', maxWidth: '360px' },
  searchIcon: {
    position: 'absolute',
    left: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: TavariStyles.colors.gray400,
  },
  searchInput: {
    width: '100%',
    padding: '10px 12px 10px 34px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '8px',
    fontSize: '14px',
    boxSizing: 'border-box',
  },
  saveButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: TavariStyles.colors.primary,
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
  },
  loading: { padding: '40px', textAlign: 'center', color: TavariStyles.colors.gray600 },
  tableWrap: { overflow: 'auto', flex: 1, padding: '0 24px 24px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: {
    textAlign: 'left',
    padding: '10px 8px',
    borderBottom: `2px solid ${TavariStyles.colors.gray200}`,
    color: TavariStyles.colors.gray700,
    position: 'sticky',
    top: 0,
    backgroundColor: TavariStyles.colors.white,
    zIndex: 1,
  },
  thUnit: { textAlign: 'left', padding: '10px 8px', borderBottom: `2px solid ${TavariStyles.colors.gray200}`, width: '80px', position: 'sticky', top: 0, backgroundColor: TavariStyles.colors.white },
  thPrice: { textAlign: 'left', padding: '10px 8px', borderBottom: `2px solid ${TavariStyles.colors.gray200}`, width: '130px', position: 'sticky', top: 0, backgroundColor: TavariStyles.colors.white },
  thPack: { textAlign: 'left', padding: '10px 8px', borderBottom: `2px solid ${TavariStyles.colors.gray200}`, width: '110px', position: 'sticky', top: 0, backgroundColor: TavariStyles.colors.white },
  thUrl: { textAlign: 'left', padding: '10px 8px', borderBottom: `2px solid ${TavariStyles.colors.gray200}`, position: 'sticky', top: 0, backgroundColor: TavariStyles.colors.white },
  thPerUnit: { textAlign: 'left', padding: '10px 8px', borderBottom: `2px solid ${TavariStyles.colors.gray200}`, width: '120px', position: 'sticky', top: 0, backgroundColor: TavariStyles.colors.white },
  td: { padding: '8px', borderBottom: `1px solid ${TavariStyles.colors.gray100}`, verticalAlign: 'middle' },
  tdUnit: { padding: '8px', borderBottom: `1px solid ${TavariStyles.colors.gray100}`, color: TavariStyles.colors.gray600 },
  tdPrice: { padding: '8px', borderBottom: `1px solid ${TavariStyles.colors.gray100}` },
  tdPack: { padding: '8px', borderBottom: `1px solid ${TavariStyles.colors.gray100}` },
  tdUrl: { padding: '8px', borderBottom: `1px solid ${TavariStyles.colors.gray100}` },
  tdPerUnit: { padding: '8px', borderBottom: `1px solid ${TavariStyles.colors.gray100}`, color: TavariStyles.colors.gray700, whiteSpace: 'nowrap' },
  input: {
    width: '100%',
    padding: '8px 10px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '6px',
    fontSize: '13px',
    boxSizing: 'border-box',
  },
  emptyCell: { padding: '24px', textAlign: 'center', color: TavariStyles.colors.gray500 },
};

export default SupplierIngredientPricingModal;
