// src/components/RecipeBuilder/RecipesTab.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { Plus, Edit, Trash2, Search, ChefHat, Clock, Thermometer, Snowflake } from 'lucide-react';
import TavariCheckbox from '../UI/TavariCheckbox';

const RecipesTab = ({ businessId }) => {
  const [recipes, setRecipes] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [showIngredientsModal, setShowIngredientsModal] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    serving_size: 1,
    prep_time_minutes: null,
    requires_heating: false,
    requires_cooling: false,
    labor_intensive: false,
    target_margin_percent: 60
  });
  const [recipeIngredients, setRecipeIngredients] = useState([]);

  useEffect(() => {
    if (businessId) {
      fetchRecipes();
      fetchIngredients();
    }
  }, [businessId]);

  const fetchRecipes = async () => {
    try {
      // First fetch recipes (modifier groups)
      // Explicitly select ingredient_id to ensure it's included
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
        .eq('group_type', 'recipe_dish')
        .order('name');

      if (recipesError) throw recipesError;

      // Then fetch ingredients separately and enrich the recipe items
      if (recipesData && recipesData.length > 0) {
        const { data: ingredientsData } = await supabase
          .from('ingredients')
          .select('id, name, cost, unit_of_measure')
          .eq('business_id', businessId)
          .eq('is_active', true);

        // Enrich recipe items with ingredient data
        const enrichedRecipes = recipesData.map(recipe => ({
          ...recipe,
          pos_modifier_group_items: recipe.pos_modifier_group_items?.map(item => {
            // For recipes: use ingredient_id if available (new structure), otherwise fallback to inventory_id (old structure)
            const ingredientId = item.ingredient_id || item.inventory_id;
            
            const ingredient = ingredientId 
              ? ingredientsData?.find(ing => ing.id === ingredientId)
              : null;
            
            return {
              ...item,
              inventory_id: ingredientId, // Store in inventory_id for display compatibility
              ingredient: ingredient || null
            };
          }) || []
        }));

        setRecipes(enrichedRecipes);
      } else {
        setRecipes([]);
      }
    } catch (error) {
      console.error('Error fetching recipes:', error);
      toast.error('Failed to load recipes');
    } finally {
      setLoading(false);
    }
  };

  const fetchIngredients = async () => {
    try {
      const { data, error } = await supabase
        .from('ingredients')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      console.log('Loaded ingredients for recipes:', data?.length || 0, 'items');
      setIngredients(data || []);
    } catch (error) {
      console.error('Error fetching ingredients:', error);
    }
  };

  const calculateIngredientCost = (ingredient) => {
    // Check both ingredient_id (recipes) and inventory_id (legacy/display)
    const ingredientId = ingredient.ingredient_id || ingredient.inventory_id;
    if (!ingredientId) return 0;
    
    const selectedIngredient = ingredients.find(ing => ing.id === ingredientId);
    if (!selectedIngredient) return 0;
    
    const baseCost = selectedIngredient.cost || 0;
    const quantity = parseFloat(ingredient.quantity) || 1;
    const multiplier = parseFloat(ingredient.multiplier) || 1;
    
    return baseCost * quantity * multiplier;
  };

  const calculateRecipeCost = (recipe) => {
    if (!recipe.pos_modifier_group_items) return 0;
    return recipe.pos_modifier_group_items.reduce((total, item) => {
      // Use enriched ingredient data (item.ingredient) or fallback to item.ingredients
      const ingredient = item.ingredient || item.ingredients;
      const ingredientCost = ingredient?.cost || 0;
      const quantity = parseFloat(item.quantity) || 1;
      const multiplier = parseFloat(item.multiplier) || 1;
      return total + (ingredientCost * quantity * multiplier);
    }, 0);
  };

  const calculateSuggestedPrice = (recipe) => {
    const cost = calculateRecipeCost(recipe);
    const margin = recipe.target_margin_percent || 60;
    return cost / (1 - margin / 100);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const recipeData = {
        name: formData.name,
        business_id: businessId,
        group_type: 'recipe_dish',
        serving_size: parseFloat(formData.serving_size) || 1,
        prep_time_minutes: formData.prep_time_minutes ? parseInt(formData.prep_time_minutes) : null,
        requires_heating: formData.requires_heating || false,
        requires_cooling: formData.requires_cooling || false,
        labor_intensive: formData.labor_intensive || false,
        target_margin_percent: parseFloat(formData.target_margin_percent) || 60
      };

      if (editingRecipe) {
        // Update the recipe data
        const { error } = await supabase
          .from('pos_modifier_groups')
          .update(recipeData)
          .eq('id', editingRecipe.id);

        if (error) {
          console.error('Error updating recipe:', error);
          throw error;
        }

        // Delete existing ingredients for this recipe
        const { error: deleteError } = await supabase
          .from('pos_modifier_group_items')
          .delete()
          .eq('modifier_group_id', editingRecipe.id);

        if (deleteError) {
          console.error('Error deleting existing ingredients:', deleteError);
          throw deleteError;
        }

        // Add updated ingredients to the recipe
        // Recipes use ingredient_id (references ingredients table), not inventory_id (references pos_inventory)
        if (recipeIngredients.length > 0) {
          const ingredientData = recipeIngredients.map(ingredient => {
            const ingredientId = ingredient.inventory_id || ingredient.ingredient_id;
            return {
              modifier_group_id: editingRecipe.id,
              ingredient_id: ingredientId, // Use ingredient_id for recipes
              inventory_id: null, // NULL for recipes (uses ingredients table)
              unit_of_measure: ingredient.unit_of_measure || '',
              prep_notes: ingredient.prep_notes || '',
              multiplier: parseFloat(ingredient.multiplier) || 1
            };
          });

          const { error: ingredientsError } = await supabase
            .from('pos_modifier_group_items')
            .insert(ingredientData);

          if (ingredientsError) {
            console.error('Error updating ingredients:', ingredientsError);
            throw ingredientsError;
          }
        }

        toast.success('Recipe updated successfully');
      } else {
        const { data, error } = await supabase
          .from('pos_modifier_groups')
          .insert(recipeData)
          .select()
          .single();

        if (error) {
          console.error('Error inserting recipe:', error);
          throw error;
        }
        
        // Add ingredients to the recipe
        // Recipes use ingredient_id (references ingredients table), not inventory_id (references pos_inventory)
        if (recipeIngredients.length > 0) {
          const ingredientData = recipeIngredients.map(ingredient => {
            const ingredientId = ingredient.inventory_id || ingredient.ingredient_id;
            return {
              modifier_group_id: data.id,
              ingredient_id: ingredientId, // Use ingredient_id for recipes
              inventory_id: null, // NULL for recipes (uses ingredients table)
              unit_of_measure: ingredient.unit_of_measure || '',
              prep_notes: ingredient.prep_notes || '',
              multiplier: parseFloat(ingredient.multiplier) || 1
            };
          });

          const { error: ingredientsError } = await supabase
            .from('pos_modifier_group_items')
            .insert(ingredientData);

          if (ingredientsError) {
            console.error('Error inserting ingredients:', ingredientsError);
            throw ingredientsError;
          }
        }

        toast.success('Recipe created successfully');
      }

      setShowModal(false);
      setEditingRecipe(null);
      resetForm();
      fetchRecipes();
    } catch (error) {
      console.error('Error saving recipe:', error);
      console.error('Form data being saved:', formData);
      console.error('Ingredient data being saved:', recipeIngredients);
      toast.error(`Failed to save recipe: ${error.message || 'Unknown error'}`);
    }
  };

  const handleEdit = (recipe) => {
    setEditingRecipe(recipe);
    setFormData({
      name: recipe.name || '',
      description: recipe.description || '',
      serving_size: recipe.serving_size || 1,
      prep_time_minutes: recipe.prep_time_minutes || null,
      requires_heating: recipe.requires_heating || false,
      requires_cooling: recipe.requires_cooling || false,
      labor_intensive: recipe.labor_intensive || false,
      target_margin_percent: recipe.target_margin_percent || 60
    });
    
    // Map recipe items to form format - use ingredient_id or inventory_id
    const mappedIngredients = (recipe.pos_modifier_group_items || []).map(item => ({
      inventory_id: item.ingredient_id || item.inventory_id, // Map ingredient_id to inventory_id for form
      ingredient_id: item.ingredient_id || item.inventory_id, // Keep both for reference
      quantity: item.quantity || 1,
      unit_of_measure: item.unit_of_measure || '',
      multiplier: item.multiplier || 1,
      prep_notes: item.prep_notes || ''
    }));
    
    setRecipeIngredients(mappedIngredients);
    setShowModal(true);
  };

  const handleDelete = async (recipe) => {
    if (!confirm('Are you sure you want to delete this recipe?')) return;

    try {
      // First delete the ingredients
      const { error: ingredientsError } = await supabase
        .from('pos_modifier_group_items')
        .delete()
        .eq('modifier_group_id', recipe.id);

      if (ingredientsError) throw ingredientsError;

      // Then delete the recipe
      const { error } = await supabase
        .from('pos_modifier_groups')
        .delete()
        .eq('id', recipe.id);

      if (error) throw error;
      toast.success('Recipe deleted successfully');
      fetchRecipes();
    } catch (error) {
      console.error('Error deleting recipe:', error);
      toast.error('Failed to delete recipe');
    }
  };

  const handleViewIngredients = (recipe) => {
    setSelectedRecipe(recipe);
    setShowIngredientsModal(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      serving_size: 1,
      prep_time_minutes: null,
      requires_heating: false,
      requires_cooling: false,
      labor_intensive: false,
      target_margin_percent: 60
    });
    setRecipeIngredients([]);
  };

  const handleAddNew = () => {
    setEditingRecipe(null);
    resetForm();
    setShowModal(true);
  };

  const addIngredientToRecipe = () => {
    setRecipeIngredients([...recipeIngredients, {
      inventory_id: null,
      quantity: 1,
      unit_of_measure: '',
      multiplier: 1,
      prep_notes: ''
    }]);
  };

  const removeIngredientFromRecipe = (index) => {
    setRecipeIngredients(recipeIngredients.filter((_, i) => i !== index));
  };

  const editIngredientInRecipe = (index) => {
    // For now, this could open a small edit modal or inline edit
    // For simplicity, we'll just focus the first input field
    const ingredientRow = document.querySelector(`[data-ingredient-index="${index}"]`);
    if (ingredientRow) {
      const firstInput = ingredientRow.querySelector('select, input');
      if (firstInput) {
        firstInput.focus();
      }
    }
  };

  const updateRecipeIngredient = (index, field, value) => {
    const updated = [...recipeIngredients];
    updated[index] = { ...updated[index], [field]: value };
    setRecipeIngredients(updated);
  };

  const filteredRecipes = recipes.filter(recipe =>
    recipe.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    recipe.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return <div style={styles.loading}>Loading recipes...</div>;
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.title}>Recipe Management</h2>
        <p style={styles.subtitle}>Create and manage your recipes</p>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <div style={styles.searchContainer}>
          <Search size={20} style={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search recipes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
        </div>

        <button onClick={handleAddNew} style={styles.addButton}>
          <Plus size={20} />
          Add Recipe
        </button>
      </div>

      {/* Recipes Grid */}
      <div style={styles.gridContainer}>
        <div style={styles.gridHeader}>
          <span>Recipe</span>
          <span>Servings</span>
          <span>Prep Time</span>
          <span>Requirements</span>
          <span>Cost</span>
          <span>Suggested Price</span>
          <span>Margin</span>
          <span>Actions</span>
        </div>

        {filteredRecipes.map(recipe => {
          const cost = calculateRecipeCost(recipe);
          const suggestedPrice = calculateSuggestedPrice(recipe);
          const margin = recipe.target_margin_percent || 60;

          return (
            <div key={recipe.id} style={styles.gridRow}>
              <span style={styles.nameCell}>
                <strong>{recipe.name}</strong>
                {recipe.description && (
                  <div style={styles.description}>{recipe.description}</div>
                )}
              </span>
              
              <span style={styles.servingsCell}>
                {recipe.serving_size} serving{recipe.serving_size !== 1 ? 's' : ''}
              </span>
              
              <span style={styles.prepTimeCell}>
                {recipe.prep_time_minutes ? (
                  <div style={styles.prepTime}>
                    <Clock size={14} />
                    {recipe.prep_time_minutes} min
                  </div>
                ) : '-'}
              </span>
              
              <span style={styles.requirementsCell}>
                <div style={styles.requirementTags}>
                  {recipe.requires_heating && (
                    <span style={styles.requirementTag}>
                      <Thermometer size={12} />
                      Heat
                    </span>
                  )}
                  {recipe.requires_cooling && (
                    <span style={styles.requirementTag}>
                      <Snowflake size={12} />
                      Cool
                    </span>
                  )}
                  {recipe.labor_intensive && (
                    <span style={styles.requirementTag}>
                      <ChefHat size={12} />
                      Labor
                    </span>
                  )}
                </div>
              </span>
              
              <span style={styles.costCell}>
                ${cost.toFixed(2)}
              </span>
              
              <span style={styles.priceCell}>
                ${suggestedPrice.toFixed(2)}
              </span>
              
              <span style={styles.marginCell}>
                {margin}%
              </span>
              
              <span style={styles.actionsCell}>
                <button
                  onClick={() => handleViewIngredients(recipe)}
                  style={styles.viewButton}
                  title="View ingredients"
                >
                  View
                </button>
                <button
                  onClick={() => handleEdit(recipe)}
                  style={styles.editButtonSmall}
                  title="Edit recipe"
                >
                  <Edit size={16} />
                </button>
                <button
                  onClick={() => handleDelete(recipe)}
                  style={styles.deleteButton}
                  title="Delete recipe"
                >
                  <Trash2 size={16} />
                </button>
              </span>
            </div>
          );
        })}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>
              {editingRecipe ? 'Edit Recipe' : 'Add New Recipe'}
            </h3>
            
            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Recipe Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    style={styles.input}
                    required
                  />
                </div>
                
                <div style={styles.formGroup}>
                  <label style={styles.label}>Serving Size *</label>
                  <input
                    type="number"
                    min="1"
                    value={formData.serving_size}
                    onChange={(e) => setFormData({...formData, serving_size: e.target.value})}
                    style={styles.input}
                    required
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  style={styles.textarea}
                  rows={3}
                />
              </div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Prep Time (minutes)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.prep_time_minutes || ''}
                    onChange={(e) => setFormData({...formData, prep_time_minutes: e.target.value})}
                    style={styles.input}
                  />
                </div>
                
                <div style={styles.formGroup}>
                  <label style={styles.label}>Target Margin %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.target_margin_percent}
                    onChange={(e) => setFormData({...formData, target_margin_percent: e.target.value})}
                    style={styles.input}
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Requirements</label>
                <div style={styles.checkboxGroup}>
                  <TavariCheckbox
                    checked={formData.requires_heating}
                    onChange={(checked) => setFormData({...formData, requires_heating: checked})}
                    label="Requires Heating"
                    size="sm"
                  />
                  <TavariCheckbox
                    checked={formData.requires_cooling}
                    onChange={(checked) => setFormData({...formData, requires_cooling: checked})}
                    label="Requires Cooling"
                    size="sm"
                  />
                  <TavariCheckbox
                    checked={formData.labor_intensive}
                    onChange={(checked) => setFormData({...formData, labor_intensive: checked})}
                    label="Labor Intensive"
                    size="sm"
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Ingredients</label>
                {ingredients.length === 0 && (
                  <div style={styles.noIngredientsMessage}>
                    <p style={styles.noIngredientsText}>
                      No ingredients available. Please add ingredients in the Ingredients tab first.
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={addIngredientToRecipe}
                  style={{
                    ...styles.addIngredientButton,
                    opacity: ingredients.length === 0 ? 0.5 : 1,
                    cursor: ingredients.length === 0 ? 'not-allowed' : 'pointer'
                  }}
                  disabled={ingredients.length === 0}
                >
                  <Plus size={16} />
                  Add Ingredient
                </button>
                
                {recipeIngredients.length > 0 && (
                  <div style={styles.ingredientHeader}>
                    <div style={styles.headerCell}>Ingredient</div>
                    <div style={styles.headerCell}>Size</div>
                    <div style={styles.headerCell}>Unit</div>
                    <div style={styles.headerCell}>Multiplier</div>
                    <div style={styles.headerCell}>Prep Notes</div>
                    <div style={styles.headerCell}>Cost</div>
                    <div style={styles.headerCell}>Action</div>
                  </div>
                )}
                
                {recipeIngredients.map((ingredient, index) => (
                  <div key={index} style={styles.ingredientRow} data-ingredient-index={index}>
                    <select
                      value={ingredient.inventory_id || ''}
                      onChange={(e) => updateRecipeIngredient(index, 'inventory_id', e.target.value)}
                      style={styles.ingredientSelect}
                    >
                      <option value="">Select Ingredient</option>
                      {ingredients.length > 0 ? (
                        ingredients.map(ing => (
                          <option key={ing.id} value={ing.id}>
                            {ing.name} (${ing.cost?.toFixed(2)}/{ing.unit_of_measure || 'unit'})
                          </option>
                        ))
                      ) : (
                        <option value="" disabled>No ingredients available - Add ingredients first</option>
                      )}
                    </select>
                    
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={ingredient.quantity || ''}
                      onChange={(e) => updateRecipeIngredient(index, 'quantity', e.target.value)}
                      style={styles.quantityInput}
                      placeholder="Size"
                    />
                    
                    <input
                      type="text"
                      value={ingredient.unit_of_measure || ''}
                      onChange={(e) => updateRecipeIngredient(index, 'unit_of_measure', e.target.value)}
                      style={styles.unitInput}
                      placeholder="Unit"
                    />
                    
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={ingredient.multiplier || 1}
                      onChange={(e) => updateRecipeIngredient(index, 'multiplier', e.target.value)}
                      style={styles.multiplierInput}
                      placeholder="×"
                    />
                    
                    <input
                      type="text"
                      value={ingredient.prep_notes || ''}
                      onChange={(e) => updateRecipeIngredient(index, 'prep_notes', e.target.value)}
                      style={styles.notesInput}
                      placeholder="Prep notes"
                    />
                    
                    <div style={styles.costDisplay}>
                      ${calculateIngredientCost(ingredient).toFixed(2)}
                    </div>
                    
                    <div style={styles.actionButtons}>
                      <button
                        type="button"
                        onClick={() => editIngredientInRecipe(index)}
                        style={styles.editButtonSmall}
                        title="Edit ingredient"
                      >
                        <Edit size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeIngredientFromRecipe(index)}
                        style={styles.removeButton}
                        title="Remove ingredient"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                
                {recipeIngredients.length > 0 && (
                  <div style={styles.totalCostSection}>
                    <div style={styles.totalCostLabel}>Total Recipe Cost:</div>
                    <div style={styles.totalCostValue}>
                      ${recipeIngredients.reduce((total, ingredient) => 
                        total + calculateIngredientCost(ingredient), 0
                      ).toFixed(2)}
                    </div>
                  </div>
                )}
              </div>

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={styles.cancelButton}
                >
                  Cancel
                </button>
                <button type="submit" style={styles.saveButton}>
                  {editingRecipe ? 'Update' : 'Create'} Recipe
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ingredients View Modal */}
      {showIngredientsModal && selectedRecipe && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>
              {selectedRecipe.name} - Ingredients
            </h3>
            
            <div style={styles.ingredientsList}>
              {selectedRecipe.pos_modifier_group_items?.map((item, index) => {
                // Use enriched ingredient data (item.ingredient) or fallback to item.inventory
                const ingredient = item.ingredient || item.inventory;
                const quantity = parseFloat(item.quantity) || 1;
                const multiplier = parseFloat(item.multiplier) || 1;
                const cost = ingredient?.cost || 0;
                const totalCost = cost * quantity * multiplier;
                
                return (
                  <div key={index} style={styles.ingredientItem}>
                    <span style={styles.ingredientName}>
                      {ingredient?.name || 'Unknown Ingredient'}
                    </span>
                    <span style={styles.ingredientQuantity}>
                      {quantity} {item.unit_of_measure} {multiplier !== 1 ? `× ${multiplier}` : ''}
                    </span>
                    <span style={styles.ingredientCost}>
                      ${totalCost.toFixed(2)}
                    </span>
                    {item.prep_notes && (
                      <span style={styles.ingredientNotes}>
                        {item.prep_notes}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={styles.modalActions}>
              <button
                onClick={() => setShowIngredientsModal(false)}
                style={styles.cancelButton}
              >
                Close
              </button>
            </div>
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
  header: {
    marginBottom: '30px'
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
  controls: {
    display: 'flex',
    gap: '16px',
    marginBottom: '24px',
    alignItems: 'center'
  },
  searchContainer: {
    position: 'relative',
    flex: 1
  },
  searchIcon: {
    position: 'absolute',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: TavariStyles.colors.gray400
  },
  searchInput: {
    padding: '12px 12px 12px 44px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '8px',
    fontSize: '14px'
  },
  addButton: {
    ...TavariStyles.components.button?.base,
    ...TavariStyles.components.button?.variants?.primary,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 20px'
  },
  gridContainer: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: TavariStyles.shadows?.base || '0 2px 4px rgba(0,0,0,0.1)',
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  gridHeader: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr 1.5fr 1fr 1fr auto auto',
    backgroundColor: TavariStyles.colors.gray100,
    padding: '16px',
    fontWeight: 'bold',
    fontSize: '14px',
    color: TavariStyles.colors.gray700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    gap: '12px'
  },
  gridRow: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr 1.5fr 1fr 1fr auto auto',
    padding: '16px',
    borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
    alignItems: 'center',
    fontSize: '14px',
    gap: '12px'
  },
  nameCell: {
    fontWeight: '500',
    minWidth: 0,
    overflow: 'hidden'
  },
  description: {
    fontSize: '13px',
    color: TavariStyles.colors.gray500,
    marginTop: '4px'
  },
  servingsCell: {
    color: TavariStyles.colors.gray600,
    minWidth: 0,
    overflow: 'hidden'
  },
  prepTimeCell: {
    color: TavariStyles.colors.gray600,
    minWidth: 0,
    overflow: 'hidden'
  },
  prepTime: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  requirementsCell: {
    fontSize: '13px',
    minWidth: 0,
    overflow: 'hidden'
  },
  requirementTags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px'
  },
  requirementTag: {
    backgroundColor: TavariStyles.colors.infoBg,
    color: TavariStyles.colors.infoText,
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '11px',
    display: 'flex',
    alignItems: 'center',
    gap: '2px'
  },
  costCell: {
    fontWeight: '600',
    color: TavariStyles.colors.primary,
    minWidth: 0,
    overflow: 'hidden'
  },
  priceCell: {
    fontWeight: '600',
    color: TavariStyles.colors.success,
    minWidth: 0,
    overflow: 'hidden'
  },
  marginCell: {
    color: TavariStyles.colors.gray600,
    minWidth: 0,
    overflow: 'hidden'
  },
  actionsCell: {
    display: 'flex',
    gap: '8px'
  },
  viewButton: {
    backgroundColor: TavariStyles.colors.infoBg,
    color: TavariStyles.colors.infoText,
    border: 'none',
    padding: '6px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  editButton: {
    backgroundColor: TavariStyles.colors.warningBg,
    color: TavariStyles.colors.warningText,
    border: 'none',
    padding: '8px',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  deleteButton: {
    backgroundColor: TavariStyles.colors.errorBg,
    color: TavariStyles.colors.errorText,
    border: 'none',
    padding: '8px',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
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
    maxWidth: '1200px',
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
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '20px',
    alignItems: 'start'
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
  checkboxGroup: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap'
  },
  addIngredientButton: {
    backgroundColor: TavariStyles.colors.infoBg,
    color: TavariStyles.colors.infoText,
    border: 'none',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
    opacity: 1
  },
  noIngredientsMessage: {
    backgroundColor: TavariStyles.colors.warningBg,
    color: TavariStyles.colors.warningText,
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '12px',
    border: `1px solid ${TavariStyles.colors.warningText}20`
  },
  noIngredientsText: {
    margin: 0,
    fontSize: '14px',
    fontWeight: '500'
  },
  ingredientHeader: {
    display: 'grid',
    gridTemplateColumns: '2fr 80px 100px 80px 1fr 100px 50px',
    gap: '12px',
    alignItems: 'center',
    marginBottom: '8px',
    padding: '8px 8px 4px 8px',
    backgroundColor: TavariStyles.colors.gray100,
    borderRadius: '8px 8px 0 0',
    borderBottom: `1px solid ${TavariStyles.colors.gray300}`
  },
  headerCell: {
    fontSize: '13px',
    fontWeight: '600',
    color: TavariStyles.colors.gray600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    textAlign: 'center'
  },
  ingredientRow: {
    display: 'grid',
    gridTemplateColumns: '2fr 80px 100px 80px 1fr 100px 50px',
    gap: '12px',
    alignItems: 'center',
    marginBottom: '12px',
    padding: '8px',
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: '8px'
  },
  ingredientSelect: {
    padding: '8px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '6px',
    fontSize: '14px'
  },
  quantityInput: {
    padding: '8px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '6px',
    fontSize: '14px'
  },
  unitInput: {
    padding: '8px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '6px',
    fontSize: '14px'
  },
  multiplierInput: {
    padding: '8px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '6px',
    fontSize: '14px',
    textAlign: 'center'
  },
  costDisplay: {
    padding: '8px',
    backgroundColor: TavariStyles.colors.successBg,
    color: TavariStyles.colors.successText,
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    textAlign: 'center',
    border: `1px solid ${TavariStyles.colors.successText}20`
  },
  notesInput: {
    padding: '8px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '6px',
    fontSize: '14px'
  },
  actionButtons: {
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    justifyContent: 'center'
  },
  editButtonSmall: {
    backgroundColor: TavariStyles.colors.warningBg,
    color: TavariStyles.colors.warningText,
    border: 'none',
    padding: '6px',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease'
  },
  removeButton: {
    backgroundColor: TavariStyles.colors.errorBg,
    color: TavariStyles.colors.errorText,
    border: 'none',
    padding: '6px',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease'
  },
  totalCostSection: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    backgroundColor: TavariStyles.colors.primaryBg,
    borderRadius: '8px',
    border: `1px solid ${TavariStyles.colors.primary}20`,
    marginTop: '12px'
  },
  totalCostLabel: {
    fontSize: '16px',
    fontWeight: '600',
    color: TavariStyles.colors.gray700
  },
  totalCostValue: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: TavariStyles.colors.primary
  },
  ingredientsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '20px'
  },
  ingredientItem: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr 1fr',
    gap: '12px',
    padding: '12px',
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: '8px',
    alignItems: 'center'
  },
  ingredientName: {
    fontWeight: '500'
  },
  ingredientQuantity: {
    color: TavariStyles.colors.gray600
  },
  ingredientCost: {
    fontWeight: '600',
    color: TavariStyles.colors.primary
  },
  ingredientNotes: {
    fontSize: '13px',
    color: TavariStyles.colors.gray500,
    fontStyle: 'italic'
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

export default RecipesTab;
