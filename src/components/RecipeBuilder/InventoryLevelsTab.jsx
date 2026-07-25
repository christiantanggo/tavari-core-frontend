// src/components/RecipeBuilder/InventoryLevelsTab.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { Plus, Edit, Trash2, Package, AlertTriangle, TrendingUp, TrendingDown, RefreshCw, Filter } from 'lucide-react';

const InventoryLevelsTab = ({ businessId }) => {
  const [inventoryLevels, setInventoryLevels] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingLevel, setEditingLevel] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [formData, setFormData] = useState({
    inventory_id: '',
    current_stock: 0,
    minimum_stock: 0,
    maximum_stock: 0,
    reorder_point: 0,
    reorder_quantity: 0,
    unit_of_measure: '',
    last_counted_date: '',
    notes: '',
    is_active: true
  });

  useEffect(() => {
    if (businessId) {
      fetchData();
    }
  }, [businessId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch inventory levels
      // Note: rb_inventory_levels doesn't have business_id, filter through inventory relationship
      const { data: levelsData, error: levelsError } = await supabase
        .from('rb_inventory_levels')
        .select(`
          *,
          inventory(
            id,
            name,
            unit_of_measure,
            cost,
            ingredient_type,
            business_id
          )
        `)
        .order('created_at', { ascending: false });

      if (levelsError) throw levelsError;

      // Filter levels by business_id through inventory relationship
      const filteredLevels = levelsData?.filter(level => 
        level.inventory?.business_id === businessId
      ) || [];

      // Fetch ingredients for dropdown
      const { data: ingredientsData, error: ingredientsError } = await supabase
        .from('inventory')
        .select('id, name, unit_of_measure, ingredient_type')
        .eq('business_id', businessId)
        .in('ingredient_type', ['ingredient', 'both'])
        .order('name');

      if (ingredientsError) throw ingredientsError;

      setInventoryLevels(filteredLevels);
      setIngredients(ingredientsData || []);
    } catch (error) {
      console.error('Error fetching inventory levels:', error);
      toast.error('Failed to load inventory levels');
    } finally {
      setLoading(false);
    }
  };

  const getStockStatus = (level) => {
    if (level.current_stock <= level.minimum_stock) return 'low';
    if (level.current_stock >= level.maximum_stock) return 'high';
    return 'normal';
  };

  const getFilteredLevels = () => {
    if (filterStatus === 'all') return inventoryLevels;
    return inventoryLevels.filter(level => getStockStatus(level) === filterStatus);
  };

  const handleAddLevel = () => {
    setEditingLevel(null);
    setFormData({
      inventory_id: '',
      current_stock: 0,
      minimum_stock: 0,
      maximum_stock: 0,
      reorder_point: 0,
      reorder_quantity: 0,
      unit_of_measure: '',
      last_counted_date: '',
      notes: '',
      is_active: true
    });
    setShowModal(true);
  };

  const handleEditLevel = (level) => {
    setEditingLevel(level);
    setFormData({
      inventory_id: level.inventory_id,
      current_stock: level.current_stock || 0,
      minimum_stock: level.minimum_stock || 0,
      maximum_stock: level.maximum_stock || 0,
      reorder_point: level.reorder_point || 0,
      reorder_quantity: level.reorder_quantity || 0,
      unit_of_measure: level.unit_of_measure || level.inventory?.unit_of_measure || '',
      last_counted_date: level.last_counted_date ? level.last_counted_date.split('T')[0] : '',
      notes: level.notes || '',
      is_active: level.is_active
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingLevel) {
        // Update existing level
        const { error } = await supabase
          .from('rb_inventory_levels')
          .update({
            ...formData,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingLevel.id);

        if (error) throw error;
        toast.success('Inventory level updated successfully');
      } else {
        // Create new level
        // Note: rb_inventory_levels doesn't have business_id column
        const { error } = await supabase
          .from('rb_inventory_levels')
          .insert({
            ...formData
          });

        if (error) throw error;
        toast.success('Inventory level created successfully');
      }

      setShowModal(false);
      setEditingLevel(null);
      fetchData();
    } catch (error) {
      console.error('Error saving inventory level:', error);
      toast.error('Failed to save inventory level');
    }
  };

  const handleDeleteLevel = async (level) => {
    if (!window.confirm(`Are you sure you want to delete the inventory level for ${level.inventory?.name}?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('rb_inventory_levels')
        .delete()
        .eq('id', level.id);

      if (error) throw error;
      toast.success('Inventory level deleted successfully');
      fetchData();
    } catch (error) {
      console.error('Error deleting inventory level:', error);
      toast.error('Failed to delete inventory level');
    }
  };

  const handleStockAdjustment = async (level, adjustment) => {
    try {
      const newStock = level.current_stock + adjustment;
      const { error } = await supabase
        .from('rb_inventory_levels')
        .update({
          current_stock: newStock,
          last_counted_date: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', level.id);

      if (error) throw error;
      toast.success(`Stock adjusted by ${adjustment > 0 ? '+' : ''}${adjustment}`);
      fetchData();
    } catch (error) {
      console.error('Error adjusting stock:', error);
      toast.error('Failed to adjust stock');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'low': return TavariStyles.colors.error;
      case 'high': return TavariStyles.colors.warning;
      default: return TavariStyles.colors.success;
    }
  };

  const getStatusBgColor = (status) => {
    switch (status) {
      case 'low': return TavariStyles.colors.errorBg;
      case 'high': return TavariStyles.colors.warningBg;
      default: return TavariStyles.colors.successBg;
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'low': return 'Low Stock';
      case 'high': return 'Overstocked';
      default: return 'Normal';
    }
  };

  if (loading) {
    return <div style={styles.loading}>Loading inventory levels...</div>;
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Inventory</h2>
          <p style={styles.subtitle}>Record cases received, track stock levels, and set reorder reminders</p>
        </div>
        <div style={styles.headerActions}>
          <div style={styles.filterGroup}>
            <Filter size={16} />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All Items</option>
              <option value="low">Low Stock</option>
              <option value="normal">Normal Stock</option>
              <option value="high">Overstocked</option>
            </select>
          </div>
          <button onClick={fetchData} style={styles.refreshButton}>
            <RefreshCw size={16} />
            Refresh
          </button>
          <button onClick={handleAddLevel} style={styles.addButton}>
            <Plus size={16} />
            Add Level
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <Package size={24} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryValue}>{inventoryLevels.length}</div>
            <div style={styles.summaryLabel}>Total Items Tracked</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <AlertTriangle size={24} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryValue}>
              {inventoryLevels.filter(level => getStockStatus(level) === 'low').length}
            </div>
            <div style={styles.summaryLabel}>Low Stock Items</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <TrendingUp size={24} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryValue}>
              {inventoryLevels.filter(level => getStockStatus(level) === 'high').length}
            </div>
            <div style={styles.summaryLabel}>Overstocked Items</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <TrendingDown size={24} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryValue}>
              {inventoryLevels.filter(level => level.current_stock <= level.reorder_point).length}
            </div>
            <div style={styles.summaryLabel}>Need Reorder</div>
          </div>
        </div>
      </div>

      {/* Inventory Levels Table */}
      <div style={styles.tableContainer}>
        {getFilteredLevels().length === 0 ? (
          <div style={styles.emptyState}>
            <h3>No inventory levels found</h3>
            <p>Add inventory levels to start tracking your ingredient stock.</p>
            <button onClick={handleAddLevel} style={styles.addButton}>
              <Plus size={16} />
              Add Your First Inventory Level
            </button>
          </div>
        ) : (
          <div style={styles.table}>
            <div style={styles.tableHeader}>
              <div style={styles.headerCell}>Ingredient</div>
              <div style={styles.headerCell}>Current Stock</div>
              <div style={styles.headerCell}>Min/Max</div>
              <div style={styles.headerCell}>Reorder Point</div>
              <div style={styles.headerCell}>Status</div>
              <div style={styles.headerCell}>Last Counted</div>
              <div style={styles.headerCell}>Actions</div>
            </div>
            
            {getFilteredLevels().map((level) => {
              const status = getStockStatus(level);
              return (
                <div key={level.id} style={styles.tableRow}>
                  <div style={styles.cell}>
                    <div style={styles.ingredientName}>{level.inventory?.name}</div>
                    <div style={styles.ingredientDetails}>
                      {level.unit_of_measure || level.inventory?.unit_of_measure}
                    </div>
                  </div>
                  
                  <div style={styles.cell}>
                    <div style={styles.stockValue}>{level.current_stock}</div>
                    <div style={styles.stockActions}>
                      <button
                        onClick={() => handleStockAdjustment(level, -1)}
                        style={styles.adjustButton}
                        title="Decrease by 1"
                      >
                        -
                      </button>
                      <button
                        onClick={() => handleStockAdjustment(level, 1)}
                        style={styles.adjustButton}
                        title="Increase by 1"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  
                  <div style={styles.cell}>
                    <div style={styles.rangeText}>
                      {level.minimum_stock} / {level.maximum_stock}
                    </div>
                  </div>
                  
                  <div style={styles.cell}>
                    <div style={styles.reorderText}>
                      {level.reorder_point} ({level.reorder_quantity})
                    </div>
                  </div>
                  
                  <div style={styles.cell}>
                    <div style={{
                      ...styles.statusBadge,
                      backgroundColor: getStatusBgColor(status),
                      color: getStatusColor(status)
                    }}>
                      {getStatusText(status)}
                    </div>
                  </div>
                  
                  <div style={styles.cell}>
                    <div style={styles.dateText}>
                      {level.last_counted_date 
                        ? new Date(level.last_counted_date).toLocaleDateString()
                        : 'Never'
                      }
                    </div>
                  </div>
                  
                  <div style={styles.cell}>
                    <div style={styles.actionButtons}>
                      <button
                        onClick={() => handleEditLevel(level)}
                        style={styles.actionButton}
                        title="Edit level"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteLevel(level)}
                        style={{...styles.actionButton, color: TavariStyles.colors.error}}
                        title="Delete level"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Level Modal */}
      {showModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>
              {editingLevel ? 'Edit Inventory Level' : 'Add New Inventory Level'}
            </h3>
            
            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Ingredient *</label>
                <select
                  value={formData.inventory_id}
                  onChange={(e) => {
                    const selectedIngredient = ingredients.find(ing => ing.id === e.target.value);
                    setFormData({
                      ...formData,
                      inventory_id: e.target.value,
                      unit_of_measure: selectedIngredient?.unit_of_measure || ''
                    });
                  }}
                  style={styles.input}
                  required
                  disabled={!!editingLevel}
                >
                  <option value="">Select an ingredient</option>
                  {ingredients.map(ingredient => (
                    <option key={ingredient.id} value={ingredient.id}>
                      {ingredient.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={styles.formGrid}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Current Stock *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.current_stock}
                    onChange={(e) => setFormData({...formData, current_stock: parseFloat(e.target.value) || 0})}
                    style={styles.input}
                    required
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Unit of Measure</label>
                  <input
                    type="text"
                    value={formData.unit_of_measure}
                    onChange={(e) => setFormData({...formData, unit_of_measure: e.target.value})}
                    style={styles.input}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Minimum Stock</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.minimum_stock}
                    onChange={(e) => setFormData({...formData, minimum_stock: parseFloat(e.target.value) || 0})}
                    style={styles.input}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Maximum Stock</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.maximum_stock}
                    onChange={(e) => setFormData({...formData, maximum_stock: parseFloat(e.target.value) || 0})}
                    style={styles.input}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Reorder Point</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.reorder_point}
                    onChange={(e) => setFormData({...formData, reorder_point: parseFloat(e.target.value) || 0})}
                    style={styles.input}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Reorder Quantity</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.reorder_quantity}
                    onChange={(e) => setFormData({...formData, reorder_quantity: parseFloat(e.target.value) || 0})}
                    style={styles.input}
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Last Counted Date</label>
                <input
                  type="date"
                  value={formData.last_counted_date}
                  onChange={(e) => setFormData({...formData, last_counted_date: e.target.value})}
                  style={styles.input}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  style={styles.textarea}
                  rows={3}
                  placeholder="Additional notes about this inventory level..."
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                    style={styles.checkbox}
                  />
                  Active Tracking
                </label>
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
                  {editingLevel ? 'Update Level' : 'Add Level'}
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
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: '8px',
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  filterSelect: {
    border: 'none',
    backgroundColor: 'transparent',
    fontSize: '14px',
    color: TavariStyles.colors.gray700,
    cursor: 'pointer'
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
  addButton: {
    ...TavariStyles.components.button?.base,
    ...TavariStyles.components.button?.variants?.primary,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 20px',
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
  tableContainer: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: '12px',
    boxShadow: TavariStyles.shadows?.base || '0 2px 4px rgba(0,0,0,0.1)',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    overflow: 'hidden'
  },
  table: {
    display: 'flex',
    flexDirection: 'column'
  },
  tableHeader: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr auto',
    gap: '16px',
    padding: '16px 20px',
    backgroundColor: TavariStyles.colors.gray50,
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    fontWeight: '600',
    fontSize: '14px',
    color: TavariStyles.colors.gray700
  },
  tableRow: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr auto',
    gap: '16px',
    padding: '16px 20px',
    borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
    alignItems: 'center',
    transition: 'background-color 0.2s ease'
  },
  cell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  headerCell: {
    fontSize: '14px',
    fontWeight: '600',
    color: TavariStyles.colors.gray700
  },
  ingredientName: {
    fontSize: '14px',
    fontWeight: '500',
    color: TavariStyles.colors.gray800
  },
  ingredientDetails: {
    fontSize: '13px',
    color: TavariStyles.colors.gray500
  },
  stockValue: {
    fontSize: '16px',
    fontWeight: '600',
    color: TavariStyles.colors.gray800
  },
  stockActions: {
    display: 'flex',
    gap: '4px'
  },
  adjustButton: {
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.gray700,
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  rangeText: {
    fontSize: '14px',
    color: TavariStyles.colors.gray700
  },
  reorderText: {
    fontSize: '14px',
    color: TavariStyles.colors.gray700
  },
  statusBadge: {
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: '500',
    textAlign: 'center'
  },
  dateText: {
    fontSize: '14px',
    color: TavariStyles.colors.gray600
  },
  actionButtons: {
    display: 'flex',
    gap: '8px'
  },
  actionButton: {
    backgroundColor: 'transparent',
    border: 'none',
    padding: '8px',
    borderRadius: '6px',
    cursor: 'pointer',
    color: TavariStyles.colors.gray600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 0.2s ease'
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: '12px',
    border: `2px dashed ${TavariStyles.colors.gray300}`
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
    gap: '20px'
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
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
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: TavariStyles.colors.gray700,
    cursor: 'pointer'
  },
  checkbox: {
    width: '16px',
    height: '16px'
  },
  modalActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
    marginTop: '20px',
    paddingTop: '20px',
    borderTop: `1px solid ${TavariStyles.colors.gray200}`
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

export default InventoryLevelsTab;
