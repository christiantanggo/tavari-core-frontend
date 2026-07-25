// Ingredients tab — purchased cases/products, supplier URLs, case breakdown, order guide
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Save,
  Printer,
  ExternalLink,
  AlertTriangle,
  Search,
  Plus,
  Trash2,
  Edit,
} from 'lucide-react';
import {
  buildIngredientOrderGuide,
  buildSupplierPricePreview,
  computeIngredientUnitCost,
  formatCurrency,
  formatUnitPrice,
  getComparableUnitPrice,
  getLinkedIngredientId,
  getSupplierPackSizeDraft,
  getSupplierPriceDraft,
  mergeSupplierDraftMaps,
  roundFoodCost,
  saveSupplierIngredientPrices,
} from '../../utils/recipeSupplierPricing';
import { RECIPE_SYSCO_BRIDGE_URL } from '../../utils/recipeSupplierBrowserScrape';
import {
  buildCategoriesById,
  buildLikelyCategoryPrefixes,
  getIngredientDisplayName,
  getIngredientPrefixCleanupUpdate,
} from '../../utils/ingredientCategoryUtils';

const IngredientsTab = ({ businessId }) => {
  const [suppliers, setSuppliers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [priceRecords, setPriceRecords] = useState([]);
  const [allIngredients, setAllIngredients] = useState([]);
  const [linkDrafts, setLinkDrafts] = useState({});
  const [priceDrafts, setPriceDrafts] = useState({});
  const [packSizeDrafts, setPackSizeDrafts] = useState({});
  const [expandedIngredientIds, setExpandedIngredientIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [savingLinks, setSavingLinks] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editingIngredient, setEditingIngredient] = useState(null);
  const [showIngredientModal, setShowIngredientModal] = useState(false);
  const [ingredientForm, setIngredientForm] = useState({
    name: '',
    category_id: '',
    unit_of_measure: 'each',
    units_per_case: '',
    case_price: '',
    case_size: '',
  });
  const [caseBreakdownDrafts, setCaseBreakdownDrafts] = useState({});
  const [savingBreakdownId, setSavingBreakdownId] = useState(null);
  const [savingIngredientPricingId, setSavingIngredientPricingId] = useState(null);
  const printRef = useRef(null);

  const ingredientPriceKey = (supplierId, ingredientId) => `${supplierId}:${ingredientId}`;

  const resetIngredientForm = () => ({
    name: '',
    category_id: '',
    unit_of_measure: 'each',
    units_per_case: '',
    case_price: '',
    case_size: '',
  });

  const getCaseBreakdownDraft = (ing, scraped) => {
    const existing = caseBreakdownDrafts[ing.id];
    if (existing) return existing;

    const casePrice = ing.case_price ?? scraped?.shelfPrice ?? '';
    const unitsPerCase = ing.units_per_case ?? scraped?.packSize ?? '';
    return {
      case_price: casePrice !== '' && casePrice != null ? String(casePrice) : '',
      units_per_case: unitsPerCase !== '' && unitsPerCase != null ? String(unitsPerCase) : '',
      case_size: ing.case_size || '',
    };
  };

  const updateCaseBreakdownDraft = (ing, field, value) => {
    const scraped = getBestSupplierPriceForIngredient(ing.id, ing.unit_of_measure);
    setCaseBreakdownDrafts((prev) => ({
      ...prev,
      [ing.id]: {
        ...(prev[ing.id] || getCaseBreakdownDraft(ing, scraped)),
        [field]: value,
      },
    }));
  };

  const getCaseBreakdown = (ing) => {
    const scraped = getBestSupplierPriceForIngredient(ing.id, ing.unit_of_measure);
    const draft = caseBreakdownDrafts[ing.id];
    const casePrice = parseFloat(draft?.case_price ?? ing.case_price) || scraped?.shelfPrice || 0;
    const unitsPerCase = parseFloat(draft?.units_per_case ?? ing.units_per_case) || scraped?.packSize || null;
    const unitCost = computeIngredientUnitCost({
      casePrice,
      unitsPerCase,
      purchaseUnitSize: ing.purchase_unit_size,
      storedCost: draft ? null : ing.cost,
      scrapedUnitPrice: scraped?.unitPrice,
    });
    const caseSize =
      draft?.case_size ??
      ing.case_size ??
      (scraped?.packSize ? `${scraped.packSize} ${ing.unit_of_measure || 'each'}` : '—');
    return { casePrice, unitsPerCase, unitCost, caseSize, scraped };
  };

  const previewDraftUnitCost = (ing, draft) => {
    const scraped = getBestSupplierPriceForIngredient(ing.id, ing.unit_of_measure);
    return computeIngredientUnitCost({
      casePrice: parseFloat(draft?.case_price),
      unitsPerCase: parseFloat(draft?.units_per_case),
      purchaseUnitSize: ing.purchase_unit_size,
      scrapedUnitPrice: scraped?.unitPrice,
    });
  };

  const fetchData = useCallback(async () => {
    if (!businessId) return;
    try {
      setLoading(true);
      const [
        { data: suppliersData, error: suppliersError },
        { data: ingredientsData, error: ingredientsError },
        { data: categoriesData, error: categoriesError },
      ] = await Promise.all([
        supabase.from('rb_suppliers').select('*').eq('business_id', businessId).eq('is_active', true).order('name'),
        supabase.from('ingredients').select('*').eq('business_id', businessId).eq('is_active', true).order('name'),
        supabase
          .from('pos_categories')
          .select('id, name, emoji, color')
          .eq('business_id', businessId)
          .in('category_type', ['recipe_only', 'both'])
          .order('name'),
      ]);

      if (suppliersError) throw suppliersError;
      if (ingredientsError) throw ingredientsError;
      if (categoriesError) throw categoriesError;

      const categoryList = categoriesData || [];
      let ingredientList = ingredientsData || [];
      const likelyPrefixes = buildLikelyCategoryPrefixes(ingredientList);

      const prefixCleanupUpdates = ingredientList
        .map((ing) => {
          const update = getIngredientPrefixCleanupUpdate(ing, categoryList, likelyPrefixes);
          return update ? { id: ing.id, ...update } : null;
        })
        .filter(Boolean);

      if (prefixCleanupUpdates.length > 0) {
        const updatedAt = new Date().toISOString();
        await Promise.all(
          prefixCleanupUpdates.map(({ id, ...fields }) =>
            supabase.from('ingredients').update({ ...fields, updated_at: updatedAt }).eq('id', id),
          ),
        );
        ingredientList = ingredientList.map((ing) => {
          const update = prefixCleanupUpdates.find((row) => row.id === ing.id);
          return update ? { ...ing, ...update } : ing;
        });
      }

      const supplierList = suppliersData || [];
      let prices = [];
      if (supplierList.length > 0) {
        const { data: pricesData, error: pricesError } = await supabase
          .from('rb_supplier_prices')
          .select('*')
          .in('supplier_id', supplierList.map((s) => s.id))
          .eq('is_current', true);
        if (pricesError) throw pricesError;
        prices = pricesData || [];
      }

      const drafts = {};
      const priceDraftValues = {};
      const packSizeDraftValues = {};
      for (const record of prices) {
        const ingredientId = getLinkedIngredientId(record);
        if (ingredientId) {
          const key = ingredientPriceKey(record.supplier_id, ingredientId);
          const ingredient = ingredientList.find((row) => row.id === ingredientId);
          drafts[key] = record.product_url || '';
          priceDraftValues[key] = getSupplierPriceDraft(record);
          packSizeDraftValues[key] = getSupplierPackSizeDraft(record, ingredient);
        }
      }

      setSuppliers(supplierList);
      setCategories(categoryList);
      setAllIngredients(ingredientList);
      setPriceRecords(prices);
      setLinkDrafts((prev) => mergeSupplierDraftMaps(prev, drafts));
      setPriceDrafts((prev) => mergeSupplierDraftMaps(prev, priceDraftValues));
      setPackSizeDrafts((prev) => mergeSupplierDraftMaps(prev, packSizeDraftValues));
    } catch (error) {
      console.error(error);
      toast.error('Failed to load ingredients');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const priceMap = useMemo(() => {
    const map = new Map();
    for (const record of priceRecords) {
      const ingredientId = getLinkedIngredientId(record);
      if (ingredientId) map.set(ingredientPriceKey(record.supplier_id, ingredientId), record);
    }
    return map;
  }, [priceRecords]);

  const getBestSupplierPriceForIngredient = useCallback((ingredientId, unitOfMeasure = 'each') => {
    let best = null;
    for (const supplier of suppliers) {
      const record = priceMap.get(ingredientPriceKey(supplier.id, ingredientId));
      if (!record) continue;
      const unitPrice = getComparableUnitPrice(record, unitOfMeasure);
      if (unitPrice == null) continue;
      const shelfPrice = parseFloat(record.promo_price ?? record.price_per_unit) || 0;
      const packSize = parseFloat(record.pack_size) || null;
      if (!best || unitPrice < best.unitPrice) {
        best = { record, unitPrice, shelfPrice, packSize };
      }
    }
    return best;
  }, [suppliers, priceMap]);

  const categoriesById = useMemo(() => buildCategoriesById(categories), [categories]);

  const getIngredientLabel = useCallback(
    (ingredientId, fallbackName = '') => {
      const ing = allIngredients.find((row) => row.id === ingredientId);
      if (ing) return getIngredientDisplayName(ing, categoriesById);
      return fallbackName;
    },
    [allIngredients, categoriesById],
  );

  const filteredIngredients = useMemo(() => {
    const term = ingredientSearch.trim().toLowerCase();
    return allIngredients.filter((ing) => {
      if (categoryFilter && ing.category_id !== categoryFilter) return false;
      if (!term) return true;
      const displayName = getIngredientDisplayName(ing, categoriesById);
      const categoryName = categoriesById.get(ing.category_id)?.name || '';
      return (
        displayName.toLowerCase().includes(term)
        || ing.name?.toLowerCase().includes(term)
        || categoryName.toLowerCase().includes(term)
        || ing.unit_of_measure?.toLowerCase().includes(term)
      );
    });
  }, [allIngredients, ingredientSearch, categoryFilter, categoriesById]);

  const orderGuide = useMemo(
    () => buildIngredientOrderGuide({ ingredients: allIngredients, suppliers, priceRecords }),
    [allIngredients, suppliers, priceRecords]
  );

  const openIngredientModal = (ingredient = null) => {
    if (ingredient) {
      setEditingIngredient(ingredient);
      setIngredientForm({
        name: getIngredientDisplayName(ingredient, categoriesById),
        category_id: ingredient.category_id || '',
        unit_of_measure: ingredient.unit_of_measure || 'each',
        units_per_case: ingredient.units_per_case ? String(ingredient.units_per_case) : '',
        case_price: ingredient.case_price ? String(ingredient.case_price) : '',
        case_size: ingredient.case_size || '',
      });
    } else {
      setEditingIngredient(null);
      setIngredientForm(resetIngredientForm());
    }
    setShowIngredientModal(true);
  };

  const saveIngredient = async (e) => {
    e.preventDefault();
    if (!ingredientForm.name.trim()) {
      toast.error('Ingredient name is required');
      return;
    }

    const unitsPerCase = parseFloat(ingredientForm.units_per_case);
    const casePrice = parseFloat(ingredientForm.case_price);
    const computedCost = computeIngredientUnitCost({
      casePrice: Number.isFinite(casePrice) ? casePrice : null,
      unitsPerCase: Number.isFinite(unitsPerCase) ? unitsPerCase : null,
      purchaseUnitSize: 1,
      storedCost: editingIngredient?.cost,
    });

    const payload = {
      name: ingredientForm.name.trim(),
      category_id: ingredientForm.category_id || null,
      unit_of_measure: ingredientForm.unit_of_measure || 'each',
      units_per_case: Number.isFinite(unitsPerCase) && unitsPerCase > 0 ? unitsPerCase : null,
      case_price: Number.isFinite(casePrice) && casePrice > 0 ? roundFoodCost(casePrice) : null,
      case_size: ingredientForm.case_size?.trim() || null,
      cost: computedCost > 0 ? computedCost : (editingIngredient?.cost ?? 0),
      cost_sync_enabled: true,
      purchase_unit_size: 1,
      is_active: true,
    };

    try {
      if (editingIngredient) {
        const { error } = await supabase
          .from('ingredients')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingIngredient.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('ingredients')
          .insert({ ...payload, business_id: businessId, cost: 0 });
        if (error) throw error;
      }

      toast.success(editingIngredient ? 'Ingredient updated' : 'Ingredient created');
      setShowIngredientModal(false);
      setEditingIngredient(null);
      setIngredientForm(resetIngredientForm());
      await fetchData();
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to save ingredient');
    }
  };

  const saveCaseBreakdown = async (ing) => {
    const draft = getCaseBreakdownDraft(ing, getBestSupplierPriceForIngredient(ing.id, ing.unit_of_measure));
    const casePrice = parseFloat(draft.case_price);
    const unitsPerCase = parseFloat(draft.units_per_case);

    if (!Number.isFinite(casePrice) || casePrice <= 0) {
      toast.error('Enter a valid case price');
      return;
    }
    if (!Number.isFinite(unitsPerCase) || unitsPerCase <= 0) {
      toast.error('Enter units per case (e.g. 12000 for a 12 L case measured in ml)');
      return;
    }

    const cost = computeIngredientUnitCost({
      casePrice,
      unitsPerCase,
      purchaseUnitSize: ing.purchase_unit_size,
    });

    try {
      setSavingBreakdownId(ing.id);
      const { error } = await supabase
        .from('ingredients')
        .update({
          case_price: roundFoodCost(casePrice),
          units_per_case: unitsPerCase,
          case_size: draft.case_size?.trim() || null,
          cost,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ing.id);
      if (error) throw error;

      setCaseBreakdownDrafts((prev) => {
        const next = { ...prev };
        delete next[ing.id];
        return next;
      });
      toast.success(`Saved ${formatUnitPrice(cost, ing.unit_of_measure || 'each')}`);
      await fetchData();
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to save case breakdown');
    } finally {
      setSavingBreakdownId(null);
    }
  };

  const deleteIngredient = async (ingredient) => {
    const displayName = getIngredientDisplayName(ingredient, categoriesById);
    if (!window.confirm(`Delete ingredient "${displayName}"?`)) return;
    try {
      const { error } = await supabase.from('ingredients').delete().eq('id', ingredient.id);
      if (error) throw error;
      toast.success('Ingredient deleted');
      await fetchData();
    } catch {
      toast.error('Failed to delete ingredient');
    }
  };

  const updateLinkDraft = (supplierId, ingredientId, value) => {
    setLinkDrafts((prev) => ({ ...prev, [ingredientPriceKey(supplierId, ingredientId)]: value }));
  };

  const updatePriceDraft = (supplierId, ingredientId, value) => {
    setPriceDrafts((prev) => ({ ...prev, [ingredientPriceKey(supplierId, ingredientId)]: value }));
  };

  const updatePackSizeDraft = (supplierId, ingredientId, value) => {
    setPackSizeDrafts((prev) => ({ ...prev, [ingredientPriceKey(supplierId, ingredientId)]: value }));
  };

  const getIngredientPricingContext = (ing) => {
    const draft = caseBreakdownDrafts[ing.id];
    return {
      ...ing,
      units_per_case: draft?.units_per_case
        ? parseFloat(draft.units_per_case)
        : ing.units_per_case,
      case_price: draft?.case_price
        ? parseFloat(draft.case_price)
        : ing.case_price,
    };
  };

  const refreshIngredientSupplierPricing = async (ingredientId) => {
    const { data, error } = await supabase
      .from('rb_supplier_prices')
      .select('*')
      .in('supplier_id', suppliers.map((s) => s.id))
      .eq('ingredient_id', ingredientId)
      .eq('is_current', true);

    if (error) throw error;

    setPriceRecords((prev) => [
      ...prev.filter((row) => getLinkedIngredientId(row) !== ingredientId),
      ...(data || []),
    ]);

    setLinkDrafts((prev) => {
      const next = { ...prev };
      for (const supplier of suppliers) {
        const compositeKey = ingredientPriceKey(supplier.id, ingredientId);
        const record = (data || []).find((row) => row.supplier_id === supplier.id);
        if (record) next[compositeKey] = record.product_url || '';
        else delete next[compositeKey];
      }
      return next;
    });

    setPriceDrafts((prev) => {
      const next = { ...prev };
      for (const supplier of suppliers) {
        const compositeKey = ingredientPriceKey(supplier.id, ingredientId);
        const record = (data || []).find((row) => row.supplier_id === supplier.id);
        if (record) next[compositeKey] = getSupplierPriceDraft(record);
        else delete next[compositeKey];
      }
      return next;
    });

    setPackSizeDrafts((prev) => {
      const next = { ...prev };
      const ing = allIngredients.find((row) => row.id === ingredientId);
      for (const supplier of suppliers) {
        const compositeKey = ingredientPriceKey(supplier.id, ingredientId);
        const record = (data || []).find((row) => row.supplier_id === supplier.id);
        if (record) next[compositeKey] = getSupplierPackSizeDraft(record, ing);
        else delete next[compositeKey];
      }
      return next;
    });
  };

  const saveProductLinks = async () => {
    try {
      setSavingLinks(true);
      let savedCount = 0;

      for (const supplier of suppliers) {
        const priceByIngredientId = new Map();
        for (const record of priceRecords) {
          if (record.supplier_id !== supplier.id) continue;
          const ingredientId = getLinkedIngredientId(record);
          if (ingredientId) priceByIngredientId.set(ingredientId, record);
        }

        const supplierPriceDrafts = {};
        const supplierLinkDrafts = {};
        const supplierPackSizeDrafts = {};
        for (const ingredient of allIngredients) {
          const key = ingredientPriceKey(supplier.id, ingredient.id);
          const existing = priceMap.get(key);
          supplierLinkDrafts[ingredient.id] = key in linkDrafts ? linkDrafts[key] : (existing?.product_url || '');
          supplierPriceDrafts[ingredient.id] = key in priceDrafts ? priceDrafts[key] : getSupplierPriceDraft(existing);
          supplierPackSizeDrafts[ingredient.id] = key in packSizeDrafts
            ? packSizeDrafts[key]
            : getSupplierPackSizeDraft(existing, ingredient);
        }

        savedCount += await saveSupplierIngredientPrices(supabase, {
          supplierId: supplier.id,
          ingredients: allIngredients,
          priceDrafts: supplierPriceDrafts,
          linkDrafts: supplierLinkDrafts,
          packSizeDrafts: supplierPackSizeDrafts,
          priceByIngredientId,
        });
      }

      if (savedCount === 0) {
        toast.error('No supplier pricing changes to save');
        return;
      }

      toast.success(`Saved ${savedCount} supplier price${savedCount === 1 ? '' : 's'}`);
      await fetchData();
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to save supplier pricing');
    } finally {
      setSavingLinks(false);
    }
  };

  const saveIngredientSupplierPricing = async (ing) => {
    const pricingIng = getIngredientPricingContext(ing);
    const dirtySuppliers = suppliers.filter((supplier) => {
      const key = ingredientPriceKey(supplier.id, ing.id);
      const existing = priceMap.get(key);
      const nextPrice = key in priceDrafts ? priceDrafts[key] : getSupplierPriceDraft(existing);
      const nextPack = key in packSizeDrafts ? packSizeDrafts[key] : getSupplierPackSizeDraft(existing, ing);
      const nextUrl = (key in linkDrafts ? linkDrafts[key] : (existing?.product_url || '')).trim();
      const prevPrice = getSupplierPriceDraft(existing);
      const prevPack = getSupplierPackSizeDraft(existing, ing);
      const prevUrl = (existing?.product_url || '').trim();
      return String(nextPrice).trim() !== String(prevPrice).trim()
        || String(nextPack).trim() !== String(prevPack).trim()
        || nextUrl !== prevUrl;
    });

    if (dirtySuppliers.length === 0) {
      toast.error('Change a price, units per case, or URL before saving');
      return;
    }

    try {
      setSavingIngredientPricingId(ing.id);
      let savedCount = 0;

      for (const supplier of dirtySuppliers) {
        const key = ingredientPriceKey(supplier.id, ing.id);
        const existing = priceMap.get(key);
        const priceByIngredientId = existing ? new Map([[ing.id, existing]]) : new Map();
        const supplierPriceDrafts = {
          [ing.id]: key in priceDrafts ? priceDrafts[key] : getSupplierPriceDraft(existing),
        };
        const supplierLinkDrafts = {
          [ing.id]: key in linkDrafts ? linkDrafts[key] : (existing?.product_url || ''),
        };
        const supplierPackSizeDrafts = {
          [ing.id]: key in packSizeDrafts ? packSizeDrafts[key] : getSupplierPackSizeDraft(existing, ing),
        };

        savedCount += await saveSupplierIngredientPrices(supabase, {
          supplierId: supplier.id,
          ingredients: [pricingIng],
          priceDrafts: supplierPriceDrafts,
          linkDrafts: supplierLinkDrafts,
          packSizeDrafts: supplierPackSizeDrafts,
          priceByIngredientId,
        });
      }

      if (savedCount === 0) {
        toast.error('Nothing was saved — enter a price or save the case breakdown first');
        return;
      }

      toast.success(`Saved ${savedCount} supplier price${savedCount === 1 ? '' : 's'}`);
      await refreshIngredientSupplierPricing(ing.id);
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to save supplier pricing');
    } finally {
      setSavingIngredientPricingId(null);
    }
  };

  const trySyscoBridgeRefresh = async (supplierPriceIds) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180000);
      const res = await fetch(`${RECIPE_SYSCO_BRIDGE_URL}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          supplier_price_ids: supplierPriceIds?.length ? supplierPriceIds : undefined,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  const refreshPrices = async () => {
    try {
      setRefreshing(true);
      const { data, error } = await supabase.functions.invoke('recipe-refresh-supplier-prices', {
        body: { business_id: businessId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      let refreshed = data?.refreshed ?? 0;
      let failed = data?.failed ?? 0;
      const browserRequired = data?.browser_required || [];

      if (browserRequired.length > 0) {
        const syscoData = await trySyscoBridgeRefresh(browserRequired.map((row) => row.id));
        if (syscoData?.error) {
          failed += browserRequired.length;
          toast.error(`Sysco refresh failed: ${syscoData.error}`, { duration: 8000 });
        } else if (syscoData) {
          refreshed += syscoData.refreshed ?? 0;
          failed += syscoData.failed ?? 0;
          if ((syscoData.refreshed ?? 0) > 0) {
            toast.success(
              `Sysco: synced ${syscoData.refreshed} price${syscoData.refreshed === 1 ? '' : 's'} (case prices verified from shop.sysco.ca)`,
              { duration: 5000 },
            );
          }
        } else {
          failed += browserRequired.length;
          toast.error(
            `Sysco prices were not refreshed. Restart dev server (npm run dev) so the Sysco bridge starts, then try again.`,
            { duration: 10000 },
          );
        }
      }

      if (failed > 0 && refreshed === 0) toast.error(`${failed} price refresh${failed === 1 ? '' : 'es'} failed`);
      else if (failed > 0) toast.error(`Updated ${refreshed}, ${failed} failed`);
      else if (browserRequired.length === 0) {
        toast.success(`Updated ${refreshed} price${refreshed === 1 ? '' : 's'}`);
      }

      await fetchData();
    } catch (error) {
      toast.error(error.message || 'Failed to refresh prices');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <div style={styles.loading}>Loading ingredients...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Ingredients</h2>
          <p style={styles.subtitle}>
            Add the cases and products you purchase. Paste supplier URLs, refresh prices, and Tavari breaks each case down to a unit cost for the Recipe tab.
            Create suppliers on the Settings tab.
          </p>
        </div>
        <div style={styles.headerActions}>
          <button type="button" onClick={() => openIngredientModal()} style={styles.secondaryButton}>
            <Plus size={16} /> New Ingredient
          </button>
          <button type="button" onClick={saveProductLinks} disabled={savingLinks} style={styles.secondaryButton}>
            <Save size={16} /> {savingLinks ? 'Saving...' : 'Save supplier pricing'}
          </button>
          <button type="button" onClick={refreshPrices} disabled={refreshing} style={styles.secondaryButton}>
            <RefreshCw size={16} /> {refreshing ? 'Refreshing...' : 'Refresh Prices'}
          </button>
          <button type="button" onClick={() => window.print()} style={styles.primaryButton} className="no-print">
            <Printer size={16} /> Print Order Guide
          </button>
        </div>
      </div>

      <div style={styles.filterRow}>
        <div style={styles.searchContainer}>
          <Search size={18} style={styles.searchIcon} />
          <input
            type="text"
            value={ingredientSearch}
            onChange={(e) => setIngredientSearch(e.target.value)}
            placeholder="Search ingredients..."
            style={styles.searchInput}
          />
        </div>
        <div style={styles.filterGroup}>
          <label htmlFor="ingredient-category-filter" style={styles.filterLabel}>Category</label>
          <select
            id="ingredient-category-filter"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="">All categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.emoji ? `${cat.emoji} ` : ''}{cat.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={styles.itemList}>
        {filteredIngredients.length === 0 ? (
          <div style={styles.emptyState}>No ingredients yet. Add your first purchased product.</div>
        ) : (
          filteredIngredients.map((ing) => {
            const expanded = expandedIngredientIds.has(ing.id);
            const { casePrice, unitsPerCase, unitCost, caseSize } = getCaseBreakdown(ing);
            const displayName = getIngredientDisplayName(ing, categoriesById);
            const categoryName = categoriesById.get(ing.category_id)?.name;

            return (
              <div key={ing.id} style={styles.itemCard}>
                <div style={styles.itemHeaderRow}>
                  <button
                    type="button"
                    style={styles.itemHeader}
                    onClick={() => {
                      setExpandedIngredientIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(ing.id)) {
                          next.delete(ing.id);
                        } else {
                          next.add(ing.id);
                          const scraped = getBestSupplierPriceForIngredient(ing.id, ing.unit_of_measure);
                          setCaseBreakdownDrafts((drafts) => ({
                            ...drafts,
                            [ing.id]: getCaseBreakdownDraft(ing, scraped),
                          }));
                        }
                        return next;
                      });
                    }}
                  >
                    {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <div style={styles.itemHeaderMain}>
                      <strong>{displayName}</strong>
                      <span style={styles.itemMeta}>
                        {categoryName ? `${categoryName} · ` : ''}
                        {unitCost > 0
                          ? formatUnitPrice(unitCost, ing.unit_of_measure || 'each')
                          : 'Set case price and units per case below'}
                        {casePrice > 0 && unitsPerCase
                          ? ` · Case ${formatCurrency(casePrice)} ÷ ${unitsPerCase} ${ing.unit_of_measure || 'units'}`
                          : ''}
                      </span>
                    </div>
                  </button>
                  <div style={styles.rowActions}>
                    <button type="button" style={styles.iconAction} onClick={() => openIngredientModal(ing)} title="Edit">
                      <Edit size={14} />
                    </button>
                    <button type="button" style={styles.iconAction} onClick={() => deleteIngredient(ing)} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {expanded && (() => {
                  const scraped = getBestSupplierPriceForIngredient(ing.id, ing.unit_of_measure);
                  const draft = getCaseBreakdownDraft(ing, scraped);
                  const previewCost = previewDraftUnitCost(ing, draft);
                  return (
                  <div style={styles.itemBody}>
                    <section style={styles.section}>
                      <h4 style={styles.sectionTitle}>Default case breakdown</h4>
                      <p style={styles.hint}>
                        Optional fallback when a supplier does not specify its own units per case below.
                        Example: a <strong>12 L</strong> syrup case measured in <strong>ml</strong> → units per case = <strong>12000</strong>.
                      </p>
                      <div style={styles.breakdownFormGrid}>
                        <div>
                          <label style={styles.breakdownLabel}>Case price ($)</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={draft.case_price}
                            onChange={(e) => updateCaseBreakdownDraft(ing, 'case_price', e.target.value)}
                            style={styles.input}
                            placeholder="From supplier refresh"
                          />
                        </div>
                        <div>
                          <label style={styles.breakdownLabel}>Units per case ({ing.unit_of_measure || 'each'})</label>
                          <input
                            type="number"
                            step="1"
                            min="1"
                            value={draft.units_per_case}
                            onChange={(e) => updateCaseBreakdownDraft(ing, 'units_per_case', e.target.value)}
                            style={styles.input}
                            placeholder="e.g. 12000"
                          />
                        </div>
                        <div>
                          <label style={styles.breakdownLabel}>Case size label (optional)</label>
                          <input
                            type="text"
                            value={draft.case_size}
                            onChange={(e) => updateCaseBreakdownDraft(ing, 'case_size', e.target.value)}
                            style={styles.input}
                            placeholder="e.g. 12 L"
                          />
                        </div>
                      </div>
                      <div style={styles.previewRow}>
                        <strong>
                          Cost per {ing.unit_of_measure || 'unit'}:{' '}
                          {previewCost > 0
                            ? formatUnitPrice(previewCost, ing.unit_of_measure || 'each')
                            : '—'}
                        </strong>
                        <button
                          type="button"
                          style={styles.primaryButton}
                          disabled={savingBreakdownId === ing.id}
                          onClick={() => saveCaseBreakdown(ing)}
                        >
                          <Save size={14} />
                          {savingBreakdownId === ing.id ? 'Saving...' : 'Save breakdown'}
                        </button>
                      </div>
                    </section>

                    <section style={styles.section}>
                      <h4 style={styles.sectionTitle}>Supplier pricing</h4>
                      <p style={styles.hint}>
                        Enter what you pay at each supplier. Set units per case when this supplier&apos;s case size differs from the default above.
                        Leave units blank to use the default, or enter a unit price by leaving units empty and putting the per-unit amount in the price field.
                      </p>
                      {suppliers.length === 0 ? (
                        <p style={styles.hint}>Add suppliers on the Settings tab first.</p>
                      ) : (
                        suppliers.map((supplier) => {
                          const key = ingredientPriceKey(supplier.id, ing.id);
                          const record = priceMap.get(key);
                          const priceDraftValue = key in priceDrafts ? priceDrafts[key] : getSupplierPriceDraft(record);
                          const packSizeDraftValue = key in packSizeDrafts
                            ? packSizeDrafts[key]
                            : getSupplierPackSizeDraft(record, ing);
                          const pricingIng = getIngredientPricingContext(ing);
                          const priceInDraft = key in priceDrafts;
                          const packInDraft = key in packSizeDrafts;
                          const linkDraftValue = key in linkDrafts ? linkDrafts[key] : (record?.product_url || '');
                          const previewFields = buildSupplierPricePreview(
                            pricingIng,
                            priceDraftValue,
                            packSizeDraftValue,
                            record,
                            { priceInDraft, packInDraft },
                          );
                          const unitPrice = previewFields
                            ? getComparableUnitPrice(previewFields, ing.unit_of_measure || 'each')
                            : null;
                          const defaultPack = pricingIng.units_per_case ? String(pricingIng.units_per_case) : '';
                          return (
                            <div key={supplier.id} style={styles.supplierRow}>
                              <label style={styles.supplierLabel}>{supplier.name}</label>
                              <div style={styles.supplierInputs}>
                                <input
                                  type="number"
                                  step="0.0001"
                                  min="0"
                                  value={priceDraftValue}
                                  onChange={(e) => updatePriceDraft(supplier.id, ing.id, e.target.value)}
                                  placeholder="Case price ($)"
                                  style={styles.urlInput}
                                />
                                <input
                                  type="number"
                                  step="1"
                                  min="1"
                                  value={packSizeDraftValue}
                                  onChange={(e) => updatePackSizeDraft(supplier.id, ing.id, e.target.value)}
                                  placeholder={
                                    defaultPack
                                      ? `Units/case (${ing.unit_of_measure || 'each'}) — default ${defaultPack}`
                                      : `Units/case (${ing.unit_of_measure || 'each'})`
                                  }
                                  style={styles.urlInput}
                                />
                                <input
                                  type="url"
                                  value={linkDraftValue}
                                  onChange={(e) => updateLinkDraft(supplier.id, ing.id, e.target.value)}
                                  placeholder="Product URL (optional)"
                                  style={styles.urlInput}
                                />
                              </div>
                              {unitPrice != null && unitPrice > 0 && (
                                <div style={styles.priceMeta}>
                                  Best comparable: {formatUnitPrice(unitPrice, ing.unit_of_measure || 'each')}
                                </div>
                              )}
                              {record?.scrape_error && (
                                <div style={styles.errorLine}><AlertTriangle size={12} /> {record.scrape_error}</div>
                              )}
                              {linkDraftValue.trim() && (
                                <a href={linkDraftValue.trim()} target="_blank" rel="noreferrer" style={styles.openLink}>
                                  <ExternalLink size={12} /> Open
                                </a>
                              )}
                            </div>
                          );
                        })
                      )}
                      <div style={styles.previewRow}>
                        <span style={styles.hint}>Save after entering prices so they appear in the order guide.</span>
                        <button
                          type="button"
                          style={styles.primaryButton}
                          disabled={savingIngredientPricingId === ing.id}
                          onClick={() => saveIngredientSupplierPricing(ing)}
                        >
                          <Save size={14} />
                          {savingIngredientPricingId === ing.id ? 'Saving...' : 'Save supplier pricing'}
                        </button>
                      </div>
                    </section>
                  </div>
                  );
                })()}
              </div>
            );
          })
        )}
      </div>

      <div style={styles.section} ref={printRef} className="procurement-print-area">
        <h3 style={styles.sectionTitle}>Best price order guide</h3>
        {orderGuide.groups.length === 0 ? (
          <p style={styles.hint}>
            Expand each ingredient, enter prices for your suppliers, click Save supplier pricing, then print.
            For bulk entry, go to Settings and click the tag icon on a supplier.
          </p>
        ) : (
          orderGuide.groups.map((group) => (
            <div key={group.supplierId} style={styles.orderGroup}>
              <h4 style={styles.orderGroupTitle}>Order from {group.supplierName}</h4>
              <ul style={styles.orderList}>
                {group.items.map((row) => (
                  <li key={row.ingredientId}>
                    {getIngredientLabel(row.ingredientId, row.ingredientName)} — {formatUnitPrice(row.unitPrice, row.unitOfMeasure || 'each')}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      {showIngredientModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3>{editingIngredient ? 'Edit ingredient' : 'New ingredient'}</h3>
            <form onSubmit={saveIngredient}>
              <label style={styles.label}>Category</label>
              <select
                value={ingredientForm.category_id}
                onChange={(e) => setIngredientForm((p) => ({ ...p, category_id: e.target.value }))}
                style={styles.input}
              >
                <option value="">Uncategorized</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.emoji ? `${cat.emoji} ` : ''}{cat.name}
                  </option>
                ))}
              </select>
              {categories.length === 0 && (
                <p style={styles.hint}>No categories yet. Add recipe categories in POS Categories or import them first.</p>
              )}
              <label style={styles.label}>Product / case name</label>
              <input required value={ingredientForm.name} onChange={(e) => setIngredientForm((p) => ({ ...p, name: e.target.value }))} style={styles.input} />
              <label style={styles.label}>Recipe unit</label>
              <input
                value={ingredientForm.unit_of_measure}
                onChange={(e) => setIngredientForm((p) => ({ ...p, unit_of_measure: e.target.value }))}
                style={styles.input}
                placeholder="each, slice, oz, etc."
              />
              <label style={styles.label}>Units per case</label>
              <input
                type="number"
                step="1"
                min="1"
                value={ingredientForm.units_per_case}
                onChange={(e) => setIngredientForm((p) => ({ ...p, units_per_case: e.target.value }))}
                style={styles.input}
                placeholder="e.g. 12000 for a 12 L case in ml"
              />
              <label style={styles.label}>Case price ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={ingredientForm.case_price}
                onChange={(e) => setIngredientForm((p) => ({ ...p, case_price: e.target.value }))}
                style={styles.input}
                placeholder="Optional — usually filled by Refresh Prices"
              />
              <label style={styles.label}>Case size label (optional)</label>
              <input
                value={ingredientForm.case_size}
                onChange={(e) => setIngredientForm((p) => ({ ...p, case_size: e.target.value }))}
                style={styles.input}
                placeholder="e.g. 12 L"
              />
              {(() => {
                const preview = computeIngredientUnitCost({
                  casePrice: parseFloat(ingredientForm.case_price),
                  unitsPerCase: parseFloat(ingredientForm.units_per_case),
                });
                return preview > 0 ? (
                  <p style={styles.hint}>
                    Preview: {formatUnitPrice(preview, ingredientForm.unit_of_measure || 'each')}
                  </p>
                ) : null;
              })()}
              <p style={styles.hint}>Case price can also be filled by Refresh Prices after you save a supplier URL.</p>
              <div style={styles.modalActions}>
                <button type="button" onClick={() => { setShowIngredientModal(false); setEditingIngredient(null); }} style={styles.secondaryButton}>Cancel</button>
                <button type="submit" style={styles.primaryButton}>{editingIngredient ? 'Save changes' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .procurement-print-area, .procurement-print-area * { visibility: visible; }
          .procurement-print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
};

const styles = {
  container: { padding: '4px' },
  loading: { padding: '40px', textAlign: 'center', color: TavariStyles.colors.gray600 },
  header: { display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' },
  title: { fontSize: '24px', fontWeight: 'bold', color: TavariStyles.colors.gray800, marginBottom: '6px' },
  subtitle: { fontSize: '15px', color: TavariStyles.colors.gray600, maxWidth: '720px' },
  headerActions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  primaryButton: {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', fontSize: '13px',
    borderRadius: '8px', border: 'none', backgroundColor: TavariStyles.colors.primary, color: '#fff', cursor: 'pointer',
  },
  secondaryButton: {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', fontSize: '13px',
    borderRadius: '8px', border: `1px solid ${TavariStyles.colors.gray300}`, backgroundColor: TavariStyles.colors.white, cursor: 'pointer',
  },
  filterRow: { display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '16px' },
  searchContainer: { position: 'relative', flex: '1 1 240px', maxWidth: '400px' },
  filterGroup: {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
    backgroundColor: TavariStyles.colors.gray50, borderRadius: '8px', border: `1px solid ${TavariStyles.colors.gray200}`,
  },
  filterLabel: { fontSize: '13px', color: TavariStyles.colors.gray600, whiteSpace: 'nowrap' },
  filterSelect: {
    border: 'none', backgroundColor: 'transparent', fontSize: '14px',
    color: TavariStyles.colors.gray700, cursor: 'pointer', minWidth: '140px',
  },
  searchIcon: { position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: TavariStyles.colors.gray400 },
  searchInput: { width: '100%', padding: '10px 12px 10px 40px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' },
  itemList: { display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' },
  itemCard: { border: `1px solid ${TavariStyles.colors.gray200}`, borderRadius: '10px', overflow: 'hidden', backgroundColor: TavariStyles.colors.white },
  itemHeaderRow: { display: 'flex', alignItems: 'stretch', background: TavariStyles.colors.gray50 },
  itemHeader: {
    flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px',
    border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', minWidth: 0,
  },
  itemHeaderMain: { flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' },
  itemMeta: { fontSize: '13px', color: TavariStyles.colors.gray600 },
  rowActions: { display: 'flex', gap: '6px', alignItems: 'center', padding: '0 12px 0 0' },
  iconAction: { border: `1px solid ${TavariStyles.colors.gray300}`, backgroundColor: TavariStyles.colors.white, borderRadius: '6px', padding: '6px', cursor: 'pointer', display: 'flex' },
  itemBody: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' },
  section: { borderTop: `1px solid ${TavariStyles.colors.gray100}`, paddingTop: '16px' },
  sectionTitle: { margin: '0 0 12px', fontSize: '15px', color: TavariStyles.colors.gray800 },
  breakdownGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '8px' },
  breakdownFormGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '12px' },
  previewRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '8px' },
  breakdownLabel: { display: 'block', fontSize: '11px', color: TavariStyles.colors.gray500, textTransform: 'uppercase', marginBottom: '4px' },
  supplierRow: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' },
  supplierLabel: { fontSize: '13px', fontWeight: '600' },
  supplierInputs: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '8px',
  },
  urlInput: { padding: '8px 10px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '6px', fontSize: '13px' },
  priceMeta: { fontSize: '13px', color: TavariStyles.colors.gray600 },
  errorLine: { fontSize: '13px', color: TavariStyles.colors.error, display: 'flex', alignItems: 'center', gap: '4px' },
  openLink: { fontSize: '13px', color: TavariStyles.colors.primary },
  hint: { fontSize: '13px', color: TavariStyles.colors.gray600, margin: '8px 0 0' },
  emptyState: { padding: '32px', textAlign: 'center', color: TavariStyles.colors.gray500 },
  orderGroup: { marginBottom: '16px' },
  orderGroupTitle: { fontSize: '14px', marginBottom: '8px' },
  orderList: { margin: 0, paddingLeft: '20px', fontSize: '13px' },
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' },
  modal: { backgroundColor: TavariStyles.colors.white, borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto' },
  label: { display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', marginTop: '12px' },
  input: { width: '100%', padding: '10px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' },
};

export default IngredientsTab;
