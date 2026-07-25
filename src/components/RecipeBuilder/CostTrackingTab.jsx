// src/components/RecipeBuilder/CostTrackingTab.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { TrendingUp, TrendingDown, DollarSign, Calculator, AlertTriangle, RefreshCw } from 'lucide-react';

const CostTrackingTab = ({ businessId, onNavigateToTab }) => {
  const [recipes, setRecipes] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [costHistory, setCostHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [selectedIngredient, setSelectedIngredient] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateFormData, setUpdateFormData] = useState({
    cost: 0,
    reason: '',
    effective_date: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    if (businessId) {
      fetchData();
    }
  }, [businessId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch recipes
      const { data: recipesData, error: recipesError } = await supabase
        .from('pos_modifier_groups')
        .select(`
          *,
          pos_modifier_group_items (
            id,
            modifier_group_id,
            inventory_id,
            ingredient_id,
            unit_of_measure,
            prep_notes,
            multiplier,
            created_at,
            updated_at
          )
        `)
        .eq('business_id', businessId)
        .in('group_type', ['recipe_dish', 'recipe_batch'])
        .order('name');

      if (recipesError) throw recipesError;

      // Fetch ingredients
      const { data: ingredientsData, error: ingredientsError } = await supabase
        .from('ingredients')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('name');

      if (ingredientsError) throw ingredientsError;

      // Fetch suppliers to get pricing
      const { data: suppliersData, error: suppliersError } = await supabase
        .from('rb_suppliers')
        .select('id, name, preferred_supplier')
        .eq('business_id', businessId)
        .eq('is_active', true);

      if (suppliersError) throw suppliersError;

      // Fetch supplier prices (cases)
      const { data: supplierPricesData, error: pricesError } = await supabase
        .from('rb_supplier_prices')
        .select(`
          *,
          inventory (
            id,
            name,
            unit_of_measure
          )
        `)
        .eq('is_current', true)
        .in('supplier_id', suppliersData?.map(s => s.id) || []);

      if (pricesError) throw pricesError;

      // Fetch inventory items (cases)
      const { data: inventoryData, error: inventoryError } = await supabase
        .from('inventory')
        .select('id, name, unit_of_measure, ingredient_type')
        .eq('business_id', businessId);

      if (inventoryError) throw inventoryError;

      // Calculate ingredient costs from supplier prices
      const enrichedIngredients = ingredientsData.map(ingredient => {
        // Find matching supplier prices for this ingredient
        // Match by supplier_id and potentially SKU
        const matchingPrices = supplierPricesData.filter(price => {
          if (ingredient.supplier_id && price.supplier_id === ingredient.supplier_id) {
            // If SKU matches, prefer that; otherwise use any from supplier
            if (ingredient.supplier_sku && price.sku === ingredient.supplier_sku) {
              return true;
            }
            if (!ingredient.supplier_sku) {
              return true;
            }
          }
          return false;
        });

        // Calculate cost from supplier prices
        let calculatedCost = ingredient.cost || 0;
        let costSource = 'manual';

        if (matchingPrices.length > 0) {
          // Prefer preferred supplier, then most recent
          const preferredSupplier = suppliersData.find(s => 
            s.preferred_supplier && matchingPrices.some(p => p.supplier_id === s.id)
          );

          const bestPrice = preferredSupplier
            ? matchingPrices.find(p => p.supplier_id === preferredSupplier.id) || matchingPrices[0]
            : matchingPrices[0];

          if (bestPrice) {
            // Calculate cost per unit from case pricing
            // price_per_unit is the price per unit in the pack
            // pack_size is how many units are in the pack
            // pack_size_unit is the unit of measure for the pack (e.g., "slices", "each", "oz")
            
            const pricePerUnit = parseFloat(bestPrice.price_per_unit) || 0;
            const packSize = parseFloat(bestPrice.pack_size) || 1;
            const packSizeUnit = bestPrice.pack_size_unit || '';
            const priceUnit = bestPrice.unit_of_measure || '';
            
            // If pack_size_unit matches ingredient unit_of_measure, calculate cost per unit
            if (packSizeUnit === ingredient.unit_of_measure && packSize > 0) {
              // price_per_unit could be per unit OR total pack price
              // If price_per_unit seems like a total (very high), divide by pack_size
              // Otherwise, use price_per_unit directly
              // For now, assume price_per_unit is already per unit in the pack
              // So cost per unit = price_per_unit
              calculatedCost = pricePerUnit;
              costSource = 'supplier';
            }
            // If price_unit matches ingredient unit_of_measure, use price_per_unit directly
            else if (priceUnit === ingredient.unit_of_measure) {
              calculatedCost = pricePerUnit;
              costSource = 'supplier';
            }
            // If pack_size_unit is empty but priceUnit matches, use price_per_unit
            else if (!packSizeUnit && priceUnit === ingredient.unit_of_measure) {
              calculatedCost = pricePerUnit;
              costSource = 'supplier';
            }
          }
        }

        return {
          ...ingredient,
          calculatedCost,
          costSource,
          supplierPrices: matchingPrices
        };
      });

      // Fetch cost history from audit logs
      const { data: auditData, error: auditError } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('business_id', businessId)
        .eq('event_type', 'pos_action')
        .order('created_at', { ascending: false })
        .limit(50);

      if (auditError) throw auditError;

      // Enrich recipes with ingredient data
      const enrichedRecipes = recipesData.map(recipe => ({
        ...recipe,
        pos_modifier_group_items: recipe.pos_modifier_group_items?.map(item => {
          const ingredientId = item.ingredient_id || item.inventory_id;
          const ingredient = ingredientId 
            ? enrichedIngredients.find(ing => ing.id === ingredientId)
            : null;
          
          return {
            ...item,
            inventory_id: ingredientId,
            ingredient: ingredient || null
          };
        }) || []
      }));

      setRecipes(enrichedRecipes);
      setIngredients(enrichedIngredients);
      setCostHistory(auditData || []);
    } catch (error) {
      console.error('Error fetching cost tracking data:', error);
      toast.error('Failed to load cost tracking data');
    } finally {
      setLoading(false);
    }
  };

  const calculateRecipeCost = (recipe) => {
    if (!recipe.pos_modifier_group_items) return 0;
    return recipe.pos_modifier_group_items.reduce((total, item) => {
      const ingredient = item.ingredient || item.inventory;
      // Use calculated cost from supplier prices if available, otherwise use manual cost
      const ingredientCost = ingredient?.calculatedCost !== undefined && ingredient?.costSource === 'supplier'
        ? ingredient.calculatedCost
        : ingredient?.cost || 0;
      const multiplier = parseFloat(item.multiplier) || 1;
      return total + (ingredientCost * multiplier);
    }, 0);
  };

  const calculateSuggestedPrice = (recipe) => {
    const cost = calculateRecipeCost(recipe);
    const margin = recipe.target_margin_percent || 60;
    return cost / (1 - margin / 100);
  };

  const getCostTrend = (ingredient) => {
    const history = costHistory.filter(log => 
      log.event_type === 'pos_action' && 
      log.details?.action === 'ingredient_cost_update' &&
      log.details?.ingredient_id === ingredient.id
    ).slice(0, 5);
    
    if (history.length < 2) return 'stable';
    
    const recent = parseFloat(history[0].details?.new_cost || 0);
    const previous = parseFloat(history[1].details?.new_cost || 0);
    
    if (recent > previous) return 'increasing';
    if (recent < previous) return 'decreasing';
    return 'stable';
  };

  const handleUpdateCost = async (ingredient) => {
    setSelectedIngredient(ingredient);
    setUpdateFormData({
      cost: ingredient.cost || 0,
      reason: '',
      effective_date: new Date().toISOString().split('T')[0]
    });
    setShowUpdateModal(true);
  };

  const handleSubmitCostUpdate = async (e) => {
    e.preventDefault();
    try {
      const { error } = await supabase
        .from('ingredients')
        .update({ 
          cost: parseFloat(updateFormData.cost),
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedIngredient.id);

      if (error) throw error;

      // Log the cost change
      const { error: logError } = await supabase
        .from('audit_logs')
        .insert({
          business_id: businessId,
          event_type: 'pos_action',
          details: {
            action: 'ingredient_cost_update',
            ingredient_id: selectedIngredient.id,
            old_cost: selectedIngredient.cost,
            new_cost: updateFormData.cost,
            ingredient_name: selectedIngredient.name,
            reason: updateFormData.reason,
            effective_date: updateFormData.effective_date
          }
        });

      if (logError) throw logError;

      toast.success('Cost updated successfully');
      setShowUpdateModal(false);
      setSelectedIngredient(null);
      fetchData();
    } catch (error) {
      console.error('Error updating cost:', error);
      toast.error('Failed to update cost');
    }
  };

  const getTopCostIngredients = () => {
    return ingredients
      .filter(ing => ing.cost > 0)
      .sort((a, b) => (b.cost || 0) - (a.cost || 0))
      .slice(0, 10);
  };

  const getMostExpensiveRecipes = () => {
    return recipes
      .map(recipe => ({
        ...recipe,
        totalCost: calculateRecipeCost(recipe),
        suggestedPrice: calculateSuggestedPrice(recipe)
      }))
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 10);
  };

  if (loading) {
    return <div style={styles.loading}>Loading cost tracking data...</div>;
  }

  return (
    <div style={styles.container}>
      {/* Getting Started Guide */}
      <div style={styles.guideSection}>
        <h3 style={styles.guideTitle}>Getting Started</h3>
        <div style={styles.guideSteps}>
          <div 
            style={styles.guideStep}
            onClick={() => onNavigateToTab && onNavigateToTab('suppliers')}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
              e.currentTarget.style.borderColor = TavariStyles.colors.primary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
              e.currentTarget.style.borderColor = TavariStyles.colors.gray200;
            }}
          >
            <div style={styles.stepNumber}>1</div>
            <div style={styles.stepContent}>
              <div style={styles.stepTitle}>Add your Suppliers</div>
              <div style={styles.stepDescription}>Set up your supplier information and pricing</div>
            </div>
            <div style={styles.stepArrow}>→</div>
          </div>
          <div 
            style={styles.guideStep}
            onClick={() => onNavigateToTab && onNavigateToTab('ingredients')}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
              e.currentTarget.style.borderColor = TavariStyles.colors.primary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
              e.currentTarget.style.borderColor = TavariStyles.colors.gray200;
            }}
          >
            <div style={styles.stepNumber}>2</div>
            <div style={styles.stepContent}>
              <div style={styles.stepTitle}>Add your Cases</div>
              <div style={styles.stepDescription}>Break down cases into ingredients with proper costing</div>
            </div>
            <div style={styles.stepArrow}>→</div>
          </div>
          <div 
            style={styles.guideStep}
            onClick={() => onNavigateToTab && onNavigateToTab('ingredients')}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
              e.currentTarget.style.borderColor = TavariStyles.colors.primary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
              e.currentTarget.style.borderColor = TavariStyles.colors.gray200;
            }}
          >
            <div style={styles.stepNumber}>3</div>
            <div style={styles.stepContent}>
              <div style={styles.stepTitle}>Add your Recipes</div>
              <div style={styles.stepDescription}>Create recipes using your ingredients</div>
            </div>
            <div style={styles.stepArrow}>→</div>
          </div>
        </div>
      </div>

      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.title}>Cost Tracking & Analysis</h2>
        <p style={styles.subtitle}>Monitor ingredient costs and recipe profitability</p>
        <button onClick={fetchData} style={styles.refreshButton}>
          <RefreshCw size={16} />
          Refresh Data
        </button>
      </div>

      {/* Summary Cards */}
      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <DollarSign size={24} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryValue}>
              ${ingredients.reduce((sum, ing) => sum + (ing.cost || 0), 0).toFixed(2)}
            </div>
            <div style={styles.summaryLabel}>Total Ingredient Costs</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <Calculator size={24} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryValue}>
              {recipes.length}
            </div>
            <div style={styles.summaryLabel}>Active Recipes</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <TrendingUp size={24} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryValue}>
              {costHistory.filter(log => 
                parseFloat(log.details?.new_cost || 0) > parseFloat(log.details?.old_cost || 0)
              ).length}
            </div>
            <div style={styles.summaryLabel}>Recent Cost Increases</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <AlertTriangle size={24} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryValue}>
              {ingredients.filter(ing => !ing.cost || ing.cost === 0).length}
            </div>
            <div style={styles.summaryLabel}>Missing Costs</div>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div style={styles.contentGrid}>
        {/* Top Cost Ingredients */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Highest Cost Ingredients</h3>
          <div style={styles.listContainer}>
            {getTopCostIngredients().map((ingredient, index) => {
              const trend = getCostTrend(ingredient);
              return (
                <div key={ingredient.id} style={styles.listItem}>
                  <div style={styles.itemRank}>#{index + 1}</div>
                  <div style={styles.itemInfo}>
                    <div style={styles.itemName}>{ingredient.name}</div>
                    <div style={styles.itemDetails}>
                      {ingredient.unit_of_measure && `${ingredient.unit_of_measure} • `}
                      {ingredient.category_id && 'Categorized'}
                    </div>
                  </div>
                  <div style={styles.itemCost}>
                    ${ingredient.calculatedCost !== undefined && ingredient.costSource === 'supplier'
                      ? ingredient.calculatedCost.toFixed(2)
                      : ingredient.cost?.toFixed(2) || '0.00'}
                    {ingredient.costSource === 'supplier' && (
                      <div style={styles.costSource}>from supplier</div>
                    )}
                  </div>
                  <div style={styles.itemTrend}>
                    {trend === 'increasing' && <TrendingUp size={16} style={{ color: TavariStyles.colors.error }} />}
                    {trend === 'decreasing' && <TrendingDown size={16} style={{ color: TavariStyles.colors.success }} />}
                    {trend === 'stable' && <div style={styles.stableIcon}>—</div>}
                  </div>
                  <button
                    onClick={() => handleUpdateCost(ingredient)}
                    style={styles.updateButton}
                    title="Update cost"
                  >
                    Update
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Most Expensive Recipes */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Most Expensive Recipes</h3>
          <div style={styles.listContainer}>
            {getMostExpensiveRecipes().map((recipe, index) => (
              <div key={recipe.id} style={styles.listItem}>
                <div style={styles.itemRank}>#{index + 1}</div>
                <div style={styles.itemInfo}>
                  <div style={styles.itemName}>{recipe.name}</div>
                  <div style={styles.itemDetails}>
                    {recipe.serving_size} serving{recipe.serving_size !== 1 ? 's' : ''} • 
                    {recipe.pos_modifier_group_items?.length || 0} ingredients
                  </div>
                </div>
                <div style={styles.itemCost}>
                  ${recipe.totalCost.toFixed(2)}
                </div>
                <div style={styles.itemPrice}>
                  ${recipe.suggestedPrice.toFixed(2)}
                </div>
                <div style={styles.itemMargin}>
                  {recipe.target_margin_percent || 60}%
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Cost History */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Recent Cost Changes</h3>
        <div style={styles.historyContainer}>
          {costHistory.length === 0 ? (
            <div style={styles.emptyState}>No cost changes recorded yet</div>
          ) : (
            costHistory.map((log, index) => (
              <div key={index} style={styles.historyItem}>
                <div style={styles.historyDate}>
                  {new Date(log.created_at).toLocaleDateString()}
                </div>
                <div style={styles.historyIngredient}>
                  {log.details?.ingredient_name || 'Unknown Ingredient'}
                </div>
                <div style={styles.historyChange}>
                  ${log.details?.old_cost || '0.00'} → ${log.details?.new_cost || '0.00'}
                </div>
                <div style={styles.historyReason}>
                  {log.details?.reason || 'No reason provided'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Update Cost Modal */}
      {showUpdateModal && selectedIngredient && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>
              Update Cost: {selectedIngredient.name}
            </h3>
            
            <form onSubmit={handleSubmitCostUpdate} style={styles.form}>
              <div style={styles.formGroup}>
                <label style={styles.label}>New Cost per Unit *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={updateFormData.cost}
                  onChange={(e) => setUpdateFormData({...updateFormData, cost: e.target.value})}
                  style={styles.input}
                  required
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Unit of Measure</label>
                <input
                  type="text"
                  value={selectedIngredient.unit_of_measure || ''}
                  style={styles.input}
                  disabled
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Effective Date</label>
                <input
                  type="date"
                  value={updateFormData.effective_date}
                  onChange={(e) => setUpdateFormData({...updateFormData, effective_date: e.target.value})}
                  style={styles.input}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Reason for Change</label>
                <textarea
                  value={updateFormData.reason}
                  onChange={(e) => setUpdateFormData({...updateFormData, reason: e.target.value})}
                  style={styles.textarea}
                  rows={3}
                  placeholder="e.g., Supplier price increase, seasonal adjustment, etc."
                />
              </div>

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setShowUpdateModal(false)}
                  style={styles.cancelButton}
                >
                  Cancel
                </button>
                <button type="submit" style={styles.saveButton}>
                  Update Cost
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    padding: '20px'
  },
  guideSection: {
    backgroundColor: TavariStyles.colors.primaryBg || '#f0f9ff',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '30px',
    border: `2px solid ${TavariStyles.colors.primary || '#008080'}`
  },
  guideTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: TavariStyles.colors.gray800,
    marginBottom: '20px',
    textAlign: 'center'
  },
  guideSteps: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  guideStep: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '16px',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: '8px',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  stepNumber: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    fontWeight: 'bold',
    flexShrink: 0
  },
  stepContent: {
    flex: 1
  },
  stepTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: TavariStyles.colors.gray800,
    marginBottom: '4px'
  },
  stepDescription: {
    fontSize: '14px',
    color: TavariStyles.colors.gray600
  },
  stepArrow: {
    fontSize: '20px',
    color: TavariStyles.colors.primary,
    fontWeight: 'bold',
    flexShrink: 0
  },
  header: {
    marginBottom: '30px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: TavariStyles.colors.gray800,
    marginBottom: '8px'
  },
  subtitle: {
    fontSize: '16px',
    color: TavariStyles.colors.gray600
  },
  refreshButton: {
    ...TavariStyles.components.button?.base,
    backgroundColor: TavariStyles.colors.infoBg,
    color: TavariStyles.colors.infoText,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    fontSize: '14px'
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '30px'
  },
  summaryCard: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: '12px',
    padding: '20px',
    boxShadow: TavariStyles.shadows?.base || '0 2px 4px rgba(0,0,0,0.1)',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  summaryIcon: {
    width: '48px',
    height: '48px',
    borderRadius: '8px',
    backgroundColor: TavariStyles.colors.primaryBg,
    color: TavariStyles.colors.primary,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  summaryContent: {
    flex: 1
  },
  summaryValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: TavariStyles.colors.gray800,
    marginBottom: '4px'
  },
  summaryLabel: {
    fontSize: '14px',
    color: TavariStyles.colors.gray600
  },
  contentGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '24px',
    marginBottom: '30px'
  },
  section: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: '12px',
    padding: '20px',
    boxShadow: TavariStyles.shadows?.base || '0 2px 4px rgba(0,0,0,0.1)',
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: TavariStyles.colors.gray800,
    marginBottom: '16px',
    borderBottom: `2px solid ${TavariStyles.colors.primary}`,
    paddingBottom: '8px'
  },
  listContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  listItem: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr 1fr auto 1fr',
    gap: '12px',
    alignItems: 'center',
    padding: '12px',
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: '8px',
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  itemRank: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: TavariStyles.colors.gray500,
    textAlign: 'center'
  },
  itemInfo: {
    flex: 1
  },
  itemName: {
    fontSize: '14px',
    fontWeight: '500',
    color: TavariStyles.colors.gray800,
    marginBottom: '2px'
  },
  itemDetails: {
    fontSize: '13px',
    color: TavariStyles.colors.gray500
  },
  itemCost: {
    fontSize: '14px',
    fontWeight: '600',
    color: TavariStyles.colors.primary,
    textAlign: 'right',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end'
  },
  costSource: {
    fontSize: '10px',
    color: TavariStyles.colors.gray500,
    fontStyle: 'italic',
    marginTop: '2px'
  },
  itemPrice: {
    fontSize: '14px',
    fontWeight: '600',
    color: TavariStyles.colors.success,
    textAlign: 'right'
  },
  itemMargin: {
    fontSize: '13px',
    color: TavariStyles.colors.gray600,
    textAlign: 'right'
  },
  itemTrend: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  stableIcon: {
    fontSize: '16px',
    color: TavariStyles.colors.gray400
  },
  updateButton: {
    backgroundColor: TavariStyles.colors.warningBg,
    color: TavariStyles.colors.warningText,
    border: 'none',
    padding: '6px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  historyContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '300px',
    overflowY: 'auto'
  },
  historyItem: {
    display: 'grid',
    gridTemplateColumns: '100px 1fr 120px 1fr',
    gap: '12px',
    padding: '12px',
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: '8px',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    fontSize: '14px'
  },
  historyDate: {
    color: TavariStyles.colors.gray600,
    fontSize: '13px'
  },
  historyIngredient: {
    fontWeight: '500',
    color: TavariStyles.colors.gray800
  },
  historyChange: {
    color: TavariStyles.colors.primary,
    fontWeight: '500'
  },
  historyReason: {
    color: TavariStyles.colors.gray600,
    fontSize: '13px',
    fontStyle: 'italic'
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
    color: TavariStyles.colors.gray500,
    fontStyle: 'italic'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modal: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: '12px',
    padding: '24px',
    width: '90%',
    maxWidth: '1000px',
    maxHeight: '90vh',
    overflowY: 'auto'
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    marginBottom: '20px',
    color: TavariStyles.colors.gray800
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  label: {
    fontSize: '14px',
    fontWeight: '500',
    color: TavariStyles.colors.gray700
  },
  input: {
    padding: '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '8px',
    fontSize: '14px'
  },
  textarea: {
    padding: '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '8px',
    fontSize: '14px',
    resize: 'vertical'
  },
  modalActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
    marginTop: '20px'
  },
  cancelButton: {
    padding: '12px 24px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '8px',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.gray700,
    cursor: 'pointer',
    fontSize: '14px'
  },
  saveButton: {
    ...TavariStyles.components.button?.base,
    ...TavariStyles.components.button?.variants?.primary,
    padding: '12px 24px',
    fontSize: '14px'
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '200px',
    fontSize: '16px',
    color: TavariStyles.colors.gray600
  }
};

export default CostTrackingTab;
