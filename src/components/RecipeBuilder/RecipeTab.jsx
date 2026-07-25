// Recipe tab — link purchased ingredients to POS menu items with quantities and margin tiers
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronRight, Plus, Save, Search, Trash2 } from 'lucide-react';
import TavariCheckbox from '../UI/TavariCheckbox';
import { formatCurrency, formatFoodCost, formatUnitPrice } from '../../utils/recipeSupplierPricing';
import { suggestedPriceFromCost } from '../../utils/posLineFoodCost';

const MARGIN_TIERS = [
  {
    id: 'tier_50',
    label: 'No labour / No heating or cooling',
    margin: 50,
    requires_heating: false,
    requires_cooling: false,
    labor_intensive: false,
  },
  {
    id: 'tier_60',
    label: 'No Labour, heating or cooling required',
    margin: 60,
    requires_heating: true,
    requires_cooling: true,
    labor_intensive: false,
  },
  {
    id: 'tier_70',
    label: 'Labor, heating or cooling required',
    margin: 70,
    requires_heating: false,
    requires_cooling: false,
    labor_intensive: true,
  },
];

const emptyRecipeDraft = () => ({
  recipeId: null,
  marginTierId: 'tier_60',
  target_margin_percent: 60,
  requires_heating: true,
  requires_cooling: true,
  labor_intensive: false,
  lines: [],
});

const RecipeTab = ({ businessId }) => {
  const [inventoryItems, setInventoryItems] = useState([]);
  const [allIngredients, setAllIngredients] = useState([]);
  const [recipesByItemId, setRecipesByItemId] = useState({});
  const [recipeDrafts, setRecipeDrafts] = useState({});
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [savingRecipeId, setSavingRecipeId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchData = useCallback(async () => {
    if (!businessId) return;
    try {
      setLoading(true);
      const [
        { data: inventoryData, error: inventoryError },
        { data: ingredientsData, error: ingredientsError },
        { data: recipesData, error: recipesError },
      ] = await Promise.all([
        supabase
          .from('pos_inventory')
          .select('id, name, sku, cost, price, is_active, is_bundle, is_modifier_item, display_on_pos')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .eq('is_bundle', false)
          .order('name'),
        supabase.from('ingredients').select('*').eq('business_id', businessId).eq('is_active', true).order('name'),
        supabase
          .from('pos_modifier_groups')
          .select(`
            id, name, pos_inventory_id, target_margin_percent,
            requires_heating, requires_cooling, labor_intensive,
            pos_modifier_group_items (
              id, ingredient_id, unit_of_measure, prep_notes, multiplier
            )
          `)
          .eq('business_id', businessId)
          .eq('group_type', 'recipe_dish'),
      ]);

      if (inventoryError) throw inventoryError;
      if (ingredientsError) throw ingredientsError;
      if (recipesError) throw recipesError;

      const recipeMap = {};
      for (const recipe of recipesData || []) {
        if (recipe.pos_inventory_id) recipeMap[recipe.pos_inventory_id] = recipe;
      }

      setInventoryItems(inventoryData || []);
      setAllIngredients(ingredientsData || []);
      setRecipesByItemId(recipeMap);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load recipes');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const resolveMarginTierId = (recipe) => {
    if (!recipe) return 'tier_60';
    const match = MARGIN_TIERS.find(
      (tier) =>
        tier.margin === (recipe.target_margin_percent || 60)
        && tier.requires_heating === Boolean(recipe.requires_heating)
        && tier.requires_cooling === Boolean(recipe.requires_cooling)
        && tier.labor_intensive === Boolean(recipe.labor_intensive)
    );
    if (match) return match.id;
    if (recipe.target_margin_percent === 50) return 'tier_50';
    if (recipe.target_margin_percent === 70) return 'tier_70';
    return 'tier_60';
  };

  const getRecipeDraft = (itemId) => {
    if (recipeDrafts[itemId]) return recipeDrafts[itemId];
    const recipe = recipesByItemId[itemId];
    if (!recipe) return emptyRecipeDraft();
    return {
      recipeId: recipe.id,
      marginTierId: resolveMarginTierId(recipe),
      target_margin_percent: recipe.target_margin_percent || 60,
      requires_heating: Boolean(recipe.requires_heating),
      requires_cooling: Boolean(recipe.requires_cooling),
      labor_intensive: Boolean(recipe.labor_intensive),
      lines: (recipe.pos_modifier_group_items || []).map((line) => ({
        ingredient_id: line.ingredient_id,
        unit_of_measure: line.unit_of_measure || '',
        multiplier: line.multiplier ?? 1,
        prep_notes: line.prep_notes || '',
      })),
    };
  };

  const setRecipeDraft = (itemId, draft) => {
    setRecipeDrafts((prev) => ({ ...prev, [itemId]: draft }));
  };

  const setMarginTier = (itemId, tierId) => {
    const draft = getRecipeDraft(itemId);
    const tier = MARGIN_TIERS.find((t) => t.id === tierId) || MARGIN_TIERS[1];
    setRecipeDraft(itemId, {
      ...draft,
      marginTierId: tier.id,
      target_margin_percent: tier.margin,
      requires_heating: tier.requires_heating,
      requires_cooling: tier.requires_cooling,
      labor_intensive: tier.labor_intensive,
    });
  };

  const calculateRecipeCost = (draft) =>
    (draft.lines || []).reduce((total, line) => {
      const ing = allIngredients.find((i) => i.id === line.ingredient_id);
      if (!ing) return total;
      return total + (parseFloat(ing.cost) || 0) * (parseFloat(line.multiplier) || 0);
    }, 0);

  const formatLineCost = (ingredientId, multiplier) =>
    formatFoodCost(
      (parseFloat(allIngredients.find((i) => i.id === ingredientId)?.cost) || 0) *
        (parseFloat(multiplier) || 0),
    );

  const saveRecipe = async (item) => {
    const draft = getRecipeDraft(item.id);
    const recipeCost = calculateRecipeCost(draft);

    try {
      setSavingRecipeId(item.id);
      const payload = {
        name: item.name,
        business_id: businessId,
        group_type: 'recipe_dish',
        pos_inventory_id: item.id,
        target_margin_percent: parseFloat(draft.target_margin_percent) || 60,
        requires_heating: draft.requires_heating,
        requires_cooling: draft.requires_cooling,
        labor_intensive: draft.labor_intensive,
        is_active: true,
      };

      let recipeId = draft.recipeId;
      if (recipeId) {
        const { error } = await supabase.from('pos_modifier_groups').update(payload).eq('id', recipeId);
        if (error) throw error;
        await supabase.from('pos_modifier_group_items').delete().eq('modifier_group_id', recipeId);
      } else {
        const { data, error } = await supabase.from('pos_modifier_groups').insert(payload).select().single();
        if (error) throw error;
        recipeId = data.id;
      }

      const rows = (draft.lines || [])
        .filter((line) => line.ingredient_id)
        .map((line) => ({
          modifier_group_id: recipeId,
          ingredient_id: line.ingredient_id,
          inventory_id: null,
          unit_of_measure: line.unit_of_measure || '',
          prep_notes: line.prep_notes || '',
          multiplier: parseFloat(line.multiplier) || 0,
        }));

      if (rows.length) {
        const { error } = await supabase.from('pos_modifier_group_items').insert(rows);
        if (error) throw error;
      }

      if (recipeCost >= 0) {
        const { error: costError } = await supabase
          .from('pos_inventory')
          .update({ cost: Math.round(recipeCost * 1e6) / 1e6 })
          .eq('id', item.id);
        if (costError) throw costError;
      }

      toast.success('Recipe saved');
      setRecipeDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await fetchData();
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to save recipe');
    } finally {
      setSavingRecipeId(null);
    }
  };

  const filterItems = useCallback((items, term) => {
    const q = term.trim().toLowerCase();
    return (items || []).filter((item) => {
      if (!q) return true;
      return item.name?.toLowerCase().includes(q) || item.sku?.toLowerCase().includes(q);
    });
  }, []);

  const menuItems = useMemo(
    () => filterItems(inventoryItems.filter((item) => item.is_modifier_item !== true), searchTerm),
    [inventoryItems, searchTerm, filterItems],
  );

  const modifierItems = useMemo(
    () => filterItems(inventoryItems.filter((item) => item.is_modifier_item === true), searchTerm),
    [inventoryItems, searchTerm, filterItems],
  );

  const toggleExpanded = (itemId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const renderRecipeCard = (item, { itemType = 'inventory' } = {}) => {
    const expanded = expandedIds.has(item.id);
    const draft = getRecipeDraft(item.id);
    const recipeCost = calculateRecipeCost(draft);
    const margin = parseFloat(draft.target_margin_percent) || 60;
    const suggestedPrice =
      recipeCost > 0 ? suggestedPriceFromCost(recipeCost, margin) : null;
    const storedCost = parseFloat(item.cost) || 0;
    const sellPrice = parseFloat(item.price) || 0;
    const isModifier = itemType === 'modifier';
    const priceLabel = isModifier ? 'Suggested add-on' : 'Suggested sell';

    return (
      <div key={item.id} style={styles.itemCard}>
        <button type="button" style={styles.itemHeader} onClick={() => toggleExpanded(item.id)}>
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <div style={styles.itemHeaderMain}>
            <strong>{item.name}</strong>
            <span style={styles.itemMeta}>
              {item.sku ? `SKU ${item.sku}` : isModifier ? 'Modifier' : 'Menu item'}
              {sellPrice > 0 ? ` · POS price ${formatCurrency(sellPrice)}` : ''}
              {recipeCost > 0
                ? ` · Recipe cost ${formatFoodCost(recipeCost)}`
                : storedCost > 0
                  ? ` · Stored cost ${formatFoodCost(storedCost)}`
                  : ''}
              {suggestedPrice != null ? ` · ${priceLabel} ${formatCurrency(suggestedPrice)}` : ''}
            </span>
          </div>
        </button>

        {expanded && (
          <div style={styles.itemBody}>
            <section style={styles.section}>
              <h4 style={styles.sectionTitle}>
                {isModifier ? 'Margin for this modifier' : 'Suggested margin'}
              </h4>
              {isModifier && (
                <p style={styles.sectionHint}>
                  Use this when the modifier adds food cost (size, flavor, extras). Suggested add-on price
                  covers this recipe cost at your target margin — set the sell price or override in POS → Modifiers.
                </p>
              )}
              <div style={styles.marginOptions}>
                {MARGIN_TIERS.map((tier) => (
                  <TavariCheckbox
                    key={tier.id}
                    id={`margin-${item.id}-${tier.id}`}
                    appearance="native"
                    checked={draft.marginTierId === tier.id}
                    onChange={() => setMarginTier(item.id, tier.id)}
                    label={`${tier.label} (${tier.margin}% margin)`}
                  />
                ))}
              </div>
              {suggestedPrice != null && (
                <p style={styles.suggestedPriceLine}>
                  {priceLabel}: <strong>{formatCurrency(suggestedPrice)}</strong>
                  <span style={styles.itemMeta}> at {margin}% margin on {formatFoodCost(recipeCost)} cost</span>
                </p>
              )}
            </section>

            <section style={styles.section}>
              <div style={styles.sectionHeaderRow}>
                <h4 style={styles.sectionTitle}>Ingredients</h4>
                <span style={styles.costBadge}>Total cost: {formatFoodCost(recipeCost)}</span>
              </div>

              {(draft.lines || []).map((line, index) => (
                <div key={index} style={styles.recipeLine}>
                  <select
                    value={line.ingredient_id || ''}
                    onChange={(e) => {
                      const lines = [...draft.lines];
                      const ing = allIngredients.find((i) => i.id === e.target.value);
                      lines[index] = {
                        ...lines[index],
                        ingredient_id: e.target.value || null,
                        unit_of_measure: ing?.unit_of_measure || lines[index].unit_of_measure,
                      };
                      setRecipeDraft(item.id, { ...draft, lines });
                    }}
                    style={styles.select}
                  >
                    <option value="">Select ingredient...</option>
                    {allIngredients.map((ing) => (
                      <option key={ing.id} value={ing.id}>
                        {ing.name} ({formatUnitPrice(ing.cost, ing.unit_of_measure || 'each')})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.multiplier ?? 1}
                    onChange={(e) => {
                      const lines = [...draft.lines];
                      lines[index] = { ...lines[index], multiplier: e.target.value };
                      setRecipeDraft(item.id, { ...draft, lines });
                    }}
                    style={styles.qtyInput}
                    title="Quantity"
                  />
                  <span style={styles.unitLabel}>{line.unit_of_measure || 'each'}</span>
                  <span style={styles.lineCost}>
                    {formatLineCost(line.ingredient_id, line.multiplier)}
                  </span>
                  <button
                    type="button"
                    style={styles.iconButton}
                    onClick={() => {
                      const lines = draft.lines.filter((_, i) => i !== index);
                      setRecipeDraft(item.id, { ...draft, lines });
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}

              <div style={styles.recipeActions}>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() =>
                    setRecipeDraft(item.id, {
                      ...draft,
                      lines: [...(draft.lines || []), { ingredient_id: null, multiplier: 1, unit_of_measure: '', prep_notes: '' }],
                    })
                  }
                >
                  <Plus size={14} /> Add ingredient
                </button>
                <button
                  type="button"
                  style={styles.primaryButton}
                  disabled={savingRecipeId === item.id}
                  onClick={() => saveRecipe(item)}
                >
                  <Save size={14} />
                  {savingRecipeId === item.id ? 'Saving...' : 'Save recipe'}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    );
  };

  const renderColumn = (title, hint, items, itemType, emptyMessage) => (
    <div style={styles.column}>
      <h3 style={styles.columnHeading}>{title}</h3>
      {hint && <p style={styles.columnHint}>{hint}</p>}
      <div style={styles.columnList}>
        {items.length === 0 ? (
          <div style={styles.emptyState}>{emptyMessage}</div>
        ) : (
          items.map((item) => renderRecipeCard(item, { itemType }))
        )}
      </div>
    </div>
  );

  if (loading) return <div style={styles.loading}>Loading recipes...</div>;

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Recipes</h2>
          <p style={styles.subtitle}>
            Assign purchased ingredients to menu items and modifier options. Food cost syncs to POS inventory;
            at sale, the register adds parent cost plus each selected modifier&apos;s cost.
          </p>
        </div>
      </div>

      <div style={styles.filterRow}>
        <div style={styles.searchContainer}>
          <Search size={18} style={styles.searchIcon} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search inventory and modifiers..."
            style={styles.searchInput}
          />
        </div>
      </div>

      <div className="recipe-two-column-grid" style={styles.twoColumnGrid}>
        {renderColumn(
          'Inventory',
          'Sellable menu items — base recipe (cup, protein, packaging, etc.).',
          menuItems,
          'inventory',
          'No menu items yet. Create them in POS → Inventory, then add ingredients here.',
        )}
        {renderColumn(
          'Modifiers',
          'Customer choices (flavor, size, add-ons) — assign extra ingredients and set margin for add-on pricing.',
          modifierItems,
          'modifier',
          'No modifier items yet. Create them in POS → Modifiers, then add ingredients here.',
        )}
      </div>

      <style>{`
        .recipe-two-column-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          align-items: start;
        }
        @media (max-width: 960px) {
          .recipe-two-column-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

const styles = {
  loading: { padding: '40px', textAlign: 'center', color: TavariStyles.colors.gray600 },
  header: { marginBottom: '20px' },
  title: { fontSize: '24px', fontWeight: 'bold', color: TavariStyles.colors.gray800, marginBottom: '6px' },
  subtitle: { fontSize: '15px', color: TavariStyles.colors.gray600, maxWidth: '900px' },
  filterRow: { display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' },
  searchContainer: { position: 'relative', flex: 1, minWidth: '220px' },
  searchIcon: { position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: TavariStyles.colors.gray400 },
  searchInput: {
    width: '100%', padding: '10px 12px 10px 40px', border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box',
  },
  twoColumnGrid: { width: '100%' },
  column: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  columnHeading: {
    fontSize: '18px',
    fontWeight: '700',
    color: TavariStyles.colors.gray800,
    margin: 0,
    paddingBottom: '8px',
    borderBottom: `2px solid ${TavariStyles.colors.primary}`,
  },
  columnHint: {
    fontSize: '13px',
    color: TavariStyles.colors.gray600,
    margin: '0 0 8px',
    lineHeight: 1.45,
  },
  columnList: { display: 'flex', flexDirection: 'column', gap: '10px' },
  itemCard: { border: `1px solid ${TavariStyles.colors.gray200}`, borderRadius: '10px', overflow: 'hidden', backgroundColor: TavariStyles.colors.white },
  itemHeader: {
    width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px',
    border: 'none', background: TavariStyles.colors.gray50, cursor: 'pointer', textAlign: 'left',
  },
  itemHeaderMain: { flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' },
  itemMeta: { fontSize: '13px', color: TavariStyles.colors.gray600 },
  itemBody: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '20px' },
  section: { borderTop: `1px solid ${TavariStyles.colors.gray100}`, paddingTop: '16px' },
  sectionTitle: { margin: '0 0 12px', fontSize: '15px', color: TavariStyles.colors.gray800 },
  sectionHint: { fontSize: '13px', color: TavariStyles.colors.gray600, margin: '0 0 10px', lineHeight: 1.45 },
  suggestedPriceLine: { fontSize: '13px', color: TavariStyles.colors.gray800, margin: '12px 0 0' },
  sectionHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
  marginOptions: { display: 'flex', flexDirection: 'column', gap: '10px' },
  costBadge: { fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.primary },
  recipeLine: { display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap' },
  select: { flex: 1, minWidth: '200px', padding: '8px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '6px' },
  qtyInput: { width: '80px', padding: '8px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '6px' },
  unitLabel: { fontSize: '13px', color: TavariStyles.colors.gray600, minWidth: '40px' },
  lineCost: { fontSize: '13px', fontWeight: '600', minWidth: '70px' },
  iconButton: {
    border: `1px solid ${TavariStyles.colors.gray300}`, background: TavariStyles.colors.white,
    borderRadius: '6px', padding: '6px', cursor: 'pointer',
  },
  recipeActions: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' },
  primaryButton: {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', fontSize: '13px',
    borderRadius: '8px', border: 'none', backgroundColor: TavariStyles.colors.primary, color: '#fff', cursor: 'pointer',
  },
  secondaryButton: {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', fontSize: '13px',
    borderRadius: '8px', border: `1px solid ${TavariStyles.colors.gray300}`, backgroundColor: TavariStyles.colors.white, cursor: 'pointer',
  },
  emptyState: {
    padding: '24px 16px',
    textAlign: 'center',
    color: TavariStyles.colors.gray500,
    fontSize: '13px',
    lineHeight: 1.5,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: '8px',
    border: `1px dashed ${TavariStyles.colors.gray300}`,
  },
};

export default RecipeTab;
