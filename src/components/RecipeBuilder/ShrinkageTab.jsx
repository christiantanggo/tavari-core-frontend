// src/components/RecipeBuilder/ShrinkageTab.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { Plus, Edit, Trash2, AlertTriangle, TrendingDown, Calendar, Package, DollarSign } from 'lucide-react';

const ShrinkageTab = ({ businessId }) => {
  const [shrinkageLogs, setShrinkageLogs] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingLog, setEditingLog] = useState(null);
  const [formData, setFormData] = useState({
    inventory_id: '',
    quantity_lost: 0,
    unit_of_measure: '',
    reason: '',
    category: 'spoilage',
    cost_impact: 0,
    logged_at: new Date().toISOString().split('T')[0],
    notes: ''
  });

  useEffect(() => {
    if (businessId) {
      fetchData();
    }
  }, [businessId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch shrinkage logs
      // Note: rb_shrinkage_logs doesn't have business_id, filter through inventory relationship
      const { data: logsData, error: logsError } = await supabase
        .from('rb_shrinkage_logs')
        .select(`
          *,
          inventory(
            id,
            name,
            unit_of_measure,
            cost,
            business_id
          )
        `)
        .order('logged_at', { ascending: false });

      // Filter logs by business_id through inventory relationship
      const filteredLogs = logsData?.filter(log => 
        log.inventory?.business_id === businessId
      ) || [];

      if (logsError) throw logsError;

      // Fetch ingredients
      const { data: ingredientsData, error: ingredientsError } = await supabase
        .from('inventory')
        .select('id, name, unit_of_measure, cost')
        .eq('business_id', businessId)
        .in('ingredient_type', ['ingredient', 'both'])
        .order('name');

      if (ingredientsError) throw ingredientsError;

      setShrinkageLogs(filteredLogs);
      setIngredients(ingredientsData || []);
    } catch (error) {
      console.error('Error fetching shrinkage logs:', error);
      toast.error('Failed to load shrinkage logs');
    } finally {
      setLoading(false);
    }
  };

  const handleAddLog = () => {
    setEditingLog(null);
    setFormData({
      inventory_id: '',
      quantity_lost: 0,
      unit_of_measure: '',
      reason: '',
      category: 'spoilage',
      cost_impact: 0,
      logged_at: new Date().toISOString().split('T')[0],
      notes: ''
    });
    setShowModal(true);
  };

  const handleEditLog = (log) => {
    setEditingLog(log);
    setFormData({
      inventory_id: log.inventory_id,
      quantity_lost: log.quantity_lost || 0,
      unit_of_measure: log.unit_of_measure || log.inventory?.unit_of_measure || '',
      reason: log.reason || '',
      category: log.category || 'spoilage',
      cost_impact: log.cost_impact || 0,
      logged_at: log.logged_at ? log.logged_at.split('T')[0] : new Date().toISOString().split('T')[0],
      notes: log.notes || ''
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingLog) {
        // Update existing log
        const { error } = await supabase
          .from('rb_shrinkage_logs')
          .update({
            ...formData,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingLog.id);

        if (error) throw error;
        toast.success('Shrinkage log updated successfully');
      } else {
        // Create new log
        // Note: rb_shrinkage_logs doesn't have business_id column
        const { error } = await supabase
          .from('rb_shrinkage_logs')
          .insert({
            ...formData
          });

        if (error) throw error;
        toast.success('Shrinkage log created successfully');
      }

      setShowModal(false);
      setEditingLog(null);
      fetchData();
    } catch (error) {
      console.error('Error saving shrinkage log:', error);
      toast.error('Failed to save shrinkage log');
    }
  };

  const handleDeleteLog = async (log) => {
    if (!window.confirm(`Are you sure you want to delete this shrinkage log for ${log.inventory?.name}?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('rb_shrinkage_logs')
        .delete()
        .eq('id', log.id);

      if (error) throw error;
      toast.success('Shrinkage log deleted successfully');
      fetchData();
    } catch (error) {
      console.error('Error deleting shrinkage log:', error);
      toast.error('Failed to delete shrinkage log');
    }
  };

  const getCategoryColor = (category) => {
    switch (category) {
      case 'spoilage': return TavariStyles.colors.error;
      case 'waste': return TavariStyles.colors.warning;
      case 'theft': return TavariStyles.colors.error;
      case 'damage': return TavariStyles.colors.warning;
      default: return TavariStyles.colors.gray600;
    }
  };

  const getCategoryBgColor = (category) => {
    switch (category) {
      case 'spoilage': return TavariStyles.colors.errorBg;
      case 'waste': return TavariStyles.colors.warningBg;
      case 'theft': return TavariStyles.colors.errorBg;
      case 'damage': return TavariStyles.colors.warningBg;
      default: return TavariStyles.colors.gray200;
    }
  };

  const getTotalShrinkageCost = () => {
    return shrinkageLogs.reduce((total, log) => total + (log.cost_impact || 0), 0);
  };

  const getShrinkageByCategory = () => {
    const categories = {};
    shrinkageLogs.forEach(log => {
      const category = log.category || 'other';
      if (!categories[category]) {
        categories[category] = { count: 0, cost: 0 };
      }
      categories[category].count += 1;
      categories[category].cost += log.cost_impact || 0;
    });
    return categories;
  };

  const getRecentShrinkage = () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return shrinkageLogs.filter(log => new Date(log.logged_at) >= thirtyDaysAgo);
  };

  if (loading) {
    return <div style={styles.loading}>Loading shrinkage logs...</div>;
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Shrink / Inventory Adjustment</h2>
          <p style={styles.subtitle}>Log expired, spoiled, or wasted inventory to adjust stock levels</p>
        </div>
        <button onClick={handleAddLog} style={styles.addButton}>
          <Plus size={16} />
          Log Shrinkage
        </button>
      </div>

      {/* Summary Cards */}
      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <AlertTriangle size={24} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryValue}>{shrinkageLogs.length}</div>
            <div style={styles.summaryLabel}>Total Logs</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <DollarSign size={24} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryValue}>
              ${getTotalShrinkageCost().toFixed(2)}
            </div>
            <div style={styles.summaryLabel}>Total Cost Impact</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <TrendingDown size={24} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryValue}>
              {getRecentShrinkage().length}
            </div>
            <div style={styles.summaryLabel}>Last 30 Days</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <Package size={24} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryValue}>
              {Object.keys(getShrinkageByCategory()).length}
            </div>
            <div style={styles.summaryLabel}>Categories</div>
          </div>
        </div>
      </div>

      {/* Shrinkage Logs Table */}
      <div style={styles.tableContainer}>
        {shrinkageLogs.length === 0 ? (
          <div style={styles.emptyState}>
            <h3>No shrinkage logs found</h3>
            <p>Start logging ingredient waste and losses to track your shrinkage costs.</p>
            <button onClick={handleAddLog} style={styles.addButton}>
              <Plus size={16} />
              Log Your First Shrinkage
            </button>
          </div>
        ) : (
          <div style={styles.table}>
            <div style={styles.tableHeader}>
              <div style={styles.headerCell}>Date</div>
              <div style={styles.headerCell}>Ingredient</div>
              <div style={styles.headerCell}>Quantity Lost</div>
              <div style={styles.headerCell}>Category</div>
              <div style={styles.headerCell}>Reason</div>
              <div style={styles.headerCell}>Cost Impact</div>
              <div style={styles.headerCell}>Actions</div>
            </div>
            
            {shrinkageLogs.map((log) => (
              <div key={log.id} style={styles.tableRow}>
                <div style={styles.cell}>
                  <div style={styles.dateText}>
                    {new Date(log.logged_at).toLocaleDateString()}
                  </div>
                </div>
                
                <div style={styles.cell}>
                  <div style={styles.ingredientName}>{log.inventory?.name}</div>
                  <div style={styles.ingredientDetails}>
                    {log.unit_of_measure || log.inventory?.unit_of_measure}
                  </div>
                </div>
                
                <div style={styles.cell}>
                  <div style={styles.quantityText}>
                    {log.quantity_lost} {log.unit_of_measure || log.inventory?.unit_of_measure}
                  </div>
                </div>
                
                <div style={styles.cell}>
                  <div style={{
                    ...styles.categoryBadge,
                    backgroundColor: getCategoryBgColor(log.category),
                    color: getCategoryColor(log.category)
                  }}>
                    {log.category || 'other'}
                  </div>
                </div>
                
                <div style={styles.cell}>
                  <div style={styles.reasonText}>
                    {log.reason || 'No reason provided'}
                  </div>
                </div>
                
                <div style={styles.cell}>
                  <div style={styles.costText}>
                    ${log.cost_impact?.toFixed(2) || '0.00'}
                  </div>
                </div>
                
                <div style={styles.cell}>
                  <div style={styles.actionButtons}>
                    <button
                      onClick={() => handleEditLog(log)}
                      style={styles.actionButton}
                      title="Edit log"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => handleDeleteLog(log)}
                      style={{...styles.actionButton, color: TavariStyles.colors.error}}
                      title="Delete log"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Log Modal */}
      {showModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>
              {editingLog ? 'Edit Shrinkage Log' : 'Add New Shrinkage Log'}
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
                      unit_of_measure: selectedIngredient?.unit_of_measure || '',
                      cost_impact: selectedIngredient?.cost ? 
                        (formData.quantity_lost * selectedIngredient.cost) : 0
                    });
                  }}
                  style={styles.input}
                  required
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
                  <label style={styles.label}>Quantity Lost *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.quantity_lost}
                    onChange={(e) => {
                      const quantity = parseFloat(e.target.value) || 0;
                      const selectedIngredient = ingredients.find(ing => ing.id === formData.inventory_id);
                      setFormData({
                        ...formData,
                        quantity_lost: quantity,
                        cost_impact: selectedIngredient?.cost ? (quantity * selectedIngredient.cost) : 0
                      });
                    }}
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
                  <label style={styles.label}>Category</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                    style={styles.input}
                  >
                    <option value="spoilage">Spoilage</option>
                    <option value="waste">Waste</option>
                    <option value="damage">Damage</option>
                    <option value="theft">Theft</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Logged Date</label>
                  <input
                    type="date"
                    value={formData.logged_at}
                    onChange={(e) => setFormData({...formData, logged_at: e.target.value})}
                    style={styles.input}
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Reason *</label>
                <input
                  type="text"
                  value={formData.reason}
                  onChange={(e) => setFormData({...formData, reason: e.target.value})}
                  style={styles.input}
                  placeholder="e.g., Expired, Damaged during delivery, etc."
                  required
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Cost Impact ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.cost_impact}
                  onChange={(e) => setFormData({...formData, cost_impact: parseFloat(e.target.value) || 0})}
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
                  placeholder="Additional details about this shrinkage event..."
                />
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
                  {editingLog ? 'Update Log' : 'Add Log'}
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
    gridTemplateColumns: '1fr 2fr 1fr 1fr 2fr 1fr auto',
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
    gridTemplateColumns: '1fr 2fr 1fr 1fr 2fr 1fr auto',
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
  dateText: {
    fontSize: '14px',
    color: TavariStyles.colors.gray600
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
  quantityText: {
    fontSize: '14px',
    color: TavariStyles.colors.gray700
  },
  categoryBadge: {
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: '500',
    textAlign: 'center'
  },
  reasonText: {
    fontSize: '14px',
    color: TavariStyles.colors.gray700
  },
  costText: {
    fontSize: '14px',
    fontWeight: '600',
    color: TavariStyles.colors.error
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

export default ShrinkageTab;
