// src/components/RecipeBuilder/BatchesTab.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { Plus, Edit, Trash2, Search, Calculator, Scale } from 'lucide-react';
import TavariCheckbox from '../UI/TavariCheckbox';

const BatchesTab = ({ businessId }) => {
  const [batches, setBatches] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    base_recipe_id: null,
    batch_multiplier: 1,
    target_servings: 1,
    prep_time_minutes: null,
    requires_heating: false,
    requires_cooling: false,
    labor_intensive: false,
    target_margin_percent: 60
  });

  useEffect(() => {
    if (businessId) {
      fetchBatches();
      fetchRecipes();
      fetchIngredients();
    }
  }, [businessId]);

  const fetchBatches = async () => {
    try {
      const { data, error } = await supabase
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
        .eq('group_type', 'recipe_batch')
        .order('name');

      if (error) throw error;

      // Enrich batches with ingredient data
      if (data && data.length > 0) {
        const { data: ingredientsData } = await supabase
          .from('ingredients')
          .select('id, name, cost, unit_of_measure')
          .eq('business_id', businessId)
          .eq('is_active', true);

        const enrichedBatches = data.map(batch => ({
          ...batch,
          pos_modifier_group_items: batch.pos_modifier_group_items?.map(item => {
            const ingredientId = item.ingredient_id || item.inventory_id;
            const ingredient = ingredientId 
              ? ingredientsData?.find(ing => ing.id === ingredientId)
              : null;
            
            return {
              ...item,
              inventory_id: ingredientId,
              ingredient: ingredient || null
            };
          }) || []
        }));

        setBatches(enrichedBatches);
      } else {
        setBatches([]);
      }
    } catch (error) {
      console.error('Error fetching batches:', error);
      toast.error('Failed to load batch recipes');
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
      setIngredients(data || []);
    } catch (error) {
      console.error('Error fetching ingredients:', error);
    }
  };

  const fetchRecipes = async () => {
    try {
      const { data, error } = await supabase
        .from('pos_modifier_groups')
        .select('*')
        .eq('business_id', businessId)
        .eq('group_type', 'recipe_dish')
        .order('name');

      if (error) throw error;
      setRecipes(data || []);
    } catch (error) {
      console.error('Error fetching recipes:', error);
    }
  };

  const calculateBatchCost = (batch) => {
    if (!batch.pos_modifier_group_items) return 0;
    return batch.pos_modifier_group_items.reduce((total, item) => {
      const ingredient = item.ingredient || item.inventory;
      const ingredientCost = ingredient?.cost || 0;
      const multiplier = parseFloat(item.multiplier) || 1;
      return total + (ingredientCost * multiplier);
    }, 0);
  };

  const calculateBatchPrice = (batch) => {
    const cost = calculateBatchCost(batch);
    const margin = batch.target_margin_percent || 60;
    return cost / (1 - margin / 100);
  };

  const calculateCostPerServing = (batch) => {
    const cost = calculateBatchCost(batch);
    const servings = batch.target_servings || batch.serving_size || 1;
    return cost / servings;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const batchData = {
        ...formData,
        business_id: businessId,
        group_type: 'recipe_batch',
        serving_size: parseFloat(formData.target_servings) || 1,
        prep_time_minutes: formData.prep_time_minutes ? parseInt(formData.prep_time_minutes) : null,
        target_margin_percent: parseFloat(formData.target_margin_percent) || 60
      };

      if (editingBatch) {
        const { error } = await supabase
          .from('pos_modifier_groups')
          .update(batchData)
          .eq('id', editingBatch.id);

        if (error) throw error;
        toast.success('Batch recipe updated successfully');
      } else {
        const { data, error } = await supabase
          .from('pos_modifier_groups')
          .insert(batchData)
          .select()
          .single();

        if (error) throw error;

        // If scaling from a base recipe, copy and scale ingredients
        if (formData.base_recipe_id && formData.batch_multiplier > 0) {
          await scaleRecipeIngredients(data.id, formData.base_recipe_id, formData.batch_multiplier);
        }

        toast.success('Batch recipe created successfully');
      }

      setShowModal(false);
      setEditingBatch(null);
      resetForm();
      fetchBatches();
    } catch (error) {
      console.error('Error saving batch:', error);
      toast.error('Failed to save batch recipe');
    }
  };

  const scaleRecipeIngredients = async (batchId, baseRecipeId, multiplier) => {
    try {
      // Get the base recipe ingredients
      const { data: baseIngredients, error } = await supabase
        .from('pos_modifier_group_items')
        .select(`
          id,
          modifier_group_id,
          inventory_id,
          ingredient_id,
          unit_of_measure,
          prep_notes,
          multiplier,
          created_at,
          updated_at
        `)
        .eq('modifier_group_id', baseRecipeId);

      if (error) throw error;

      // Scale the ingredients
      const scaledIngredients = baseIngredients.map(ingredient => ({
        modifier_group_id: batchId,
        ingredient_id: ingredient.ingredient_id || null,
        inventory_id: ingredient.inventory_id || null,
        unit_of_measure: ingredient.unit_of_measure || '',
        prep_notes: ingredient.prep_notes || '',
        multiplier: parseFloat(ingredient.multiplier || 1) * multiplier
      }));

      // Insert scaled ingredients
      const { error: insertError } = await supabase
        .from('pos_modifier_group_items')
        .insert(scaledIngredients);

      if (insertError) throw insertError;
    } catch (error) {
      console.error('Error scaling ingredients:', error);
      throw error;
    }
  };

  const handleEdit = (batch) => {
    setEditingBatch(batch);
    setFormData({
      name: batch.name || '',
      description: batch.description || '',
      base_recipe_id: null, // Would need to track this separately
      batch_multiplier: 1,
      target_servings: batch.serving_size || 1,
      prep_time_minutes: batch.prep_time_minutes || null,
      requires_heating: batch.requires_heating || false,
      requires_cooling: batch.requires_cooling || false,
      labor_intensive: batch.labor_intensive || false,
      target_margin_percent: batch.target_margin_percent || 60
    });
    setShowModal(true);
  };

  const handleDelete = async (batch) => {
    if (!confirm('Are you sure you want to delete this batch recipe?')) return;

    try {
      // First delete the ingredients
      const { error: ingredientsError } = await supabase
        .from('pos_modifier_group_items')
        .delete()
        .eq('modifier_group_id', batch.id);

      if (ingredientsError) throw ingredientsError;

      // Then delete the batch
      const { error } = await supabase
        .from('pos_modifier_groups')
        .delete()
        .eq('id', batch.id);

      if (error) throw error;
      toast.success('Batch recipe deleted successfully');
      fetchBatches();
    } catch (error) {
      console.error('Error deleting batch:', error);
      toast.error('Failed to delete batch recipe');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      base_recipe_id: null,
      batch_multiplier: 1,
      target_servings: 1,
      prep_time_minutes: null,
      requires_heating: false,
      requires_cooling: false,
      labor_intensive: false,
      target_margin_percent: 60
    });
  };

  const handleAddNew = () => {
    setEditingBatch(null);
    resetForm();
    setShowModal(true);
  };

  const filteredBatches = batches.filter(batch =>
    batch.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    batch.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return <div style={styles.loading}>Loading batch recipes...</div>;
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.title}>Batch Recipe Management</h2>
        <p style={styles.subtitle}>Create scaled versions of your recipes for larger quantities</p>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <div style={styles.searchContainer}>
          <Search size={20} style={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search batch recipes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
        </div>

        <button onClick={handleAddNew} style={styles.addButton}>
          <Plus size={20} />
          Add Batch Recipe
        </button>
      </div>

      {/* Batches Grid */}
      <div style={styles.gridContainer}>
        <div style={styles.gridHeader}>
          <span>Batch Recipe</span>
          <span>Servings</span>
          <span>Prep Time</span>
          <span>Requirements</span>
          <span>Total Cost</span>
          <span>Cost/Serving</span>
          <span>Suggested Price</span>
          <span>Actions</span>
        </div>

        {filteredBatches.map(batch => {
          const cost = calculateBatchCost(batch);
          const suggestedPrice = calculateBatchPrice(batch);
          const costPerServing = calculateCostPerServing(batch);
          const servings = batch.serving_size || batch.target_servings || 1;

          return (
            <div key={batch.id} style={styles.gridRow}>
              <span style={styles.nameCell}>
                <strong>{batch.name}</strong>
                {batch.description && (
                  <div style={styles.description}>{batch.description}</div>
                )}
              </span>
              
              <span style={styles.servingsCell}>
                {servings} serving{servings !== 1 ? 's' : ''}
              </span>
              
              <span style={styles.prepTimeCell}>
                {batch.prep_time_minutes ? (
                  <div style={styles.prepTime}>
                    <Scale size={14} />
                    {batch.prep_time_minutes} min
                  </div>
                ) : '-'}
              </span>
              
              <span style={styles.requirementsCell}>
                <div style={styles.requirementTags}>
                  {batch.requires_heating && (
                    <span style={styles.requirementTag}>Heat</span>
                  )}
                  {batch.requires_cooling && (
                    <span style={styles.requirementTag}>Cool</span>
                  )}
                  {batch.labor_intensive && (
                    <span style={styles.requirementTag}>Labor</span>
                  )}
                </div>
              </span>
              
              <span style={styles.costCell}>
                ${cost.toFixed(2)}
              </span>
              
              <span style={styles.costPerServingCell}>
                ${costPerServing.toFixed(2)}
              </span>
              
              <span style={styles.priceCell}>
                ${suggestedPrice.toFixed(2)}
              </span>
              
              <span style={styles.actionsCell}>
                <button
                  onClick={() => handleEdit(batch)}
                  style={styles.editButton}
                  title="Edit batch recipe"
                >
                  <Edit size={16} />
                </button>
                <button
                  onClick={() => handleDelete(batch)}
                  style={styles.deleteButton}
                  title="Delete batch recipe"
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
              {editingBatch ? 'Edit Batch Recipe' : 'Add New Batch Recipe'}
            </h3>
            
            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Batch Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    style={styles.input}
                    required
                  />
                </div>
                
                <div style={styles.formGroup}>
                  <label style={styles.label}>Target Servings *</label>
                  <input
                    type="number"
                    min="1"
                    value={formData.target_servings}
                    onChange={(e) => setFormData({...formData, target_servings: e.target.value})}
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
                  <label style={styles.label}>Scale from Recipe</label>
                  <select
                    value={formData.base_recipe_id || ''}
                    onChange={(e) => setFormData({...formData, base_recipe_id: e.target.value || null})}
                    style={styles.input}
                  >
                    <option value="">Select Base Recipe (Optional)</option>
                    {recipes.map(recipe => (
                      <option key={recipe.id} value={recipe.id}>
                        {recipe.name} ({recipe.serving_size} servings)
                      </option>
                    ))}
                  </select>
                </div>
                
                {formData.base_recipe_id && (
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Batch Multiplier</label>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={formData.batch_multiplier}
                      onChange={(e) => setFormData({...formData, batch_multiplier: e.target.value})}
                      style={styles.input}
                    />
                  </div>
                )}
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

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={styles.cancelButton}
                >
                  Cancel
                </button>
                <button type="submit" style={styles.saveButton}>
                  {editingBatch ? 'Update' : 'Create'} Batch Recipe
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
    gridTemplateColumns: '2fr 1fr 1fr 1.5fr 1fr 1fr 1fr auto',
    backgroundColor: TavariStyles.colors.gray100,
    padding: '16px',
    fontWeight: 'bold',
    fontSize: '14px',
    color: TavariStyles.colors.gray700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  gridRow: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr 1.5fr 1fr 1fr 1fr auto',
    padding: '16px',
    borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
    alignItems: 'center',
    fontSize: '14px'
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
    fontSize: '11px'
  },
  costCell: {
    fontWeight: '600',
    color: TavariStyles.colors.primary,
    minWidth: 0,
    overflow: 'hidden'
  },
  costPerServingCell: {
    fontWeight: '600',
    color: TavariStyles.colors.warning,
    minWidth: 0,
    overflow: 'hidden'
  },
  priceCell: {
    fontWeight: '600',
    color: TavariStyles.colors.success,
    minWidth: 0,
    overflow: 'hidden'
  },
  actionsCell: {
    display: 'flex',
    gap: '8px'
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
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
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
  checkboxGroup: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap'
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

export default BatchesTab;
