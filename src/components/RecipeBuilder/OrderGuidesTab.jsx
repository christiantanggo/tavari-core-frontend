// src/components/RecipeBuilder/OrderGuidesTab.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { Plus, Edit, Trash2, ShoppingCart, FileText, Download, RefreshCw } from 'lucide-react';

const OrderGuidesTab = ({ businessId }) => {
  const [orderGuides, setOrderGuides] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingGuide, setEditingGuide] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    supplier_id: '',
    location_id: null,
    status: 'draft'
  });
  const [guideItems, setGuideItems] = useState([]);

  useEffect(() => {
    if (businessId) {
      fetchData();
    }
  }, [businessId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // First fetch suppliers for this business to filter order guides
      const { data: suppliersData, error: suppliersError } = await supabase
        .from('rb_suppliers')
        .select('id')
        .eq('business_id', businessId);

      if (suppliersError) throw suppliersError;

      const supplierIds = suppliersData?.map(s => s.id) || [];

      // Fetch order guides filtered by supplier_ids (which are linked to business)
      const { data: guidesData, error: guidesError } = supplierIds.length > 0
        ? await supabase
            .from('rb_order_guides')
            .select(`
              *,
              rb_order_guide_items(
                id,
                inventory_id,
                suggested_quantity,
                actual_quantity,
                unit_of_measure,
                inventory(name, unit_of_measure)
              ),
              rb_suppliers(name)
            `)
            .in('supplier_id', supplierIds)
            .order('name')
        : { data: [], error: null };

      if (guidesError) throw guidesError;

      // Fetch ingredients
      const { data: ingredientsData, error: ingredientsError } = await supabase
        .from('inventory')
        .select('id, name, unit_of_measure')
        .eq('business_id', businessId)
        .in('ingredient_type', ['ingredient', 'both'])
        .order('name');

      if (ingredientsError) throw ingredientsError;

      setOrderGuides(guidesData || []);
      setIngredients(ingredientsData || []);
    } catch (error) {
      console.error('Error fetching order guides:', error);
      toast.error('Failed to load order guides');
    } finally {
      setLoading(false);
    }
  };

  const handleAddGuide = () => {
    setEditingGuide(null);
    setFormData({
      name: '',
      supplier_id: '',
      location_id: null,
      status: 'draft'
    });
    setGuideItems([]);
    setShowModal(true);
  };

  const handleEditGuide = (guide) => {
    setEditingGuide(guide);
    setFormData({
      name: guide.name || '',
      supplier_id: guide.supplier_id || null,
      location_id: guide.location_id || null,
      status: guide.status || 'draft'
    });
    setGuideItems(guide.rb_order_guide_items || []);
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingGuide) {
        // Update existing guide
        // Convert empty strings to null for UUID fields
        const cleanFormData = {
          ...formData,
          supplier_id: formData.supplier_id || null,
          location_id: formData.location_id || null,
          updated_at: new Date().toISOString()
        };
        const { error } = await supabase
          .from('rb_order_guides')
          .update(cleanFormData)
          .eq('id', editingGuide.id);

        if (error) throw error;

        // Delete existing items
        const { error: deleteError } = await supabase
          .from('rb_order_guide_items')
          .delete()
          .eq('order_guide_id', editingGuide.id);

        if (deleteError) throw deleteError;

        // Insert updated items
        if (guideItems.length > 0) {
          const itemsToInsert = guideItems.map(item => ({
            order_guide_id: editingGuide.id,
            inventory_id: item.inventory_id,
            suggested_quantity: item.suggested_quantity || 0,
            unit_of_measure: item.unit_of_measure
          }));
          
          const { error: itemsError } = await supabase
            .from('rb_order_guide_items')
            .insert(itemsToInsert);

          if (itemsError) throw itemsError;
        }

        toast.success('Order guide updated successfully');
      } else {
        // Create new guide
        // Note: rb_order_guides doesn't have business_id, only supplier_id and location_id
        // Convert empty strings to null for UUID fields
        const cleanFormData = {
          ...formData,
          supplier_id: formData.supplier_id || null,
          location_id: formData.location_id || null
        };
        const { data, error } = await supabase
          .from('rb_order_guides')
          .insert(cleanFormData)
          .select()
          .single();

        if (error) throw error;
        
        // Add guide items
        if (guideItems.length > 0) {
          const itemsToInsert = guideItems.map(item => ({
            order_guide_id: data.id,
            inventory_id: item.inventory_id,
            suggested_quantity: item.suggested_quantity || 0,
            unit_of_measure: item.unit_of_measure
          }));
          
          const { error: itemsError } = await supabase
            .from('rb_order_guide_items')
            .insert(itemsToInsert);

          if (itemsError) throw itemsError;
        }
        
        toast.success('Order guide created successfully');
      }

      setShowModal(false);
      setEditingGuide(null);
      fetchData();
    } catch (error) {
      console.error('Error saving order guide:', error);
      toast.error('Failed to save order guide');
    }
  };

  const handleDeleteGuide = async (guide) => {
    if (!window.confirm(`Are you sure you want to delete ${guide.name}?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('rb_order_guides')
        .delete()
        .eq('id', guide.id);

      if (error) throw error;
      toast.success('Order guide deleted successfully');
      fetchData();
    } catch (error) {
      console.error('Error deleting order guide:', error);
      toast.error('Failed to delete order guide');
    }
  };

  const addGuideItem = () => {
    setGuideItems([...guideItems, {
      inventory_id: '',
      suggested_quantity: 0,
      unit_of_measure: ''
    }]);
  };

  const removeGuideItem = (index) => {
    setGuideItems(guideItems.filter((_, i) => i !== index));
  };

  const updateGuideItem = (index, field, value) => {
    const updatedItems = [...guideItems];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    setGuideItems(updatedItems);
  };

  const generateOrderList = (guide) => {
    const items = guide.rb_order_guide_items || [];
    let orderText = `Order Guide: ${guide.name}\n`;
    orderText += `Supplier: ${guide.rb_suppliers?.name || 'N/A'}\n`;
    orderText += `Status: ${guide.status || 'draft'}\n\n`;
    orderText += `Items:\n`;
    
    items.forEach((item, index) => {
      const quantity = item.suggested_quantity || item.actual_quantity || 0;
      orderText += `${index + 1}. ${item.inventory?.name || 'Unknown'} - ${quantity} ${item.unit_of_measure || ''}\n`;
    });
    
    return orderText;
  };

  const downloadOrderList = (guide) => {
    const orderText = generateOrderList(guide);
    const blob = new Blob([orderText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${guide.name.replace(/\s+/g, '_')}_order_guide.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div style={styles.loading}>Loading order guides...</div>;
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Order Guides</h2>
          <p style={styles.subtitle}>Create and manage ingredient order guides for suppliers</p>
        </div>
        <div style={styles.headerActions}>
          <button onClick={fetchData} style={styles.refreshButton}>
            <RefreshCw size={16} />
            Refresh
          </button>
          <button onClick={handleAddGuide} style={styles.addButton}>
            <Plus size={16} />
            Add Guide
          </button>
        </div>
      </div>

      {/* Order Guides Grid */}
      <div style={styles.guidesGrid}>
        {orderGuides.length === 0 ? (
          <div style={styles.emptyState}>
            <h3>No order guides found</h3>
            <p>Create your first order guide to streamline ingredient purchasing.</p>
            <button onClick={handleAddGuide} style={styles.addButton}>
              <Plus size={16} />
              Create Your First Order Guide
            </button>
          </div>
        ) : (
          orderGuides.map((guide) => (
            <div key={guide.id} style={styles.guideCard}>
              <div style={styles.guideHeader}>
                <div style={styles.guideInfo}>
                  <h3 style={styles.guideName}>{guide.name}</h3>
                  <div style={styles.guideStatus}>
                    <div style={{
                      ...styles.statusBadge,
                      backgroundColor: guide.status === 'active' ? TavariStyles.colors.successBg : TavariStyles.colors.gray200,
                      color: guide.status === 'active' ? TavariStyles.colors.success : TavariStyles.colors.gray600
                    }}>
                      {guide.status || 'draft'}
                    </div>
                  </div>
                </div>
                <div style={styles.guideActions}>
                  <button
                    onClick={() => downloadOrderList(guide)}
                    style={styles.actionButton}
                    title="Download order list"
                  >
                    <Download size={16} />
                  </button>
                  <button
                    onClick={() => handleEditGuide(guide)}
                    style={styles.actionButton}
                    title="Edit guide"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    onClick={() => handleDeleteGuide(guide)}
                    style={{...styles.actionButton, color: TavariStyles.colors.error}}
                    title="Delete guide"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div style={styles.guideDetails}>
                <div style={styles.detailItem}>
                  <strong>Supplier:</strong> {guide.rb_suppliers?.name || 'Not assigned'}
                </div>
                <div style={styles.detailItem}>
                  <strong>Status:</strong> {guide.status || 'draft'}
                </div>
                <div style={styles.detailItem}>
                  <strong>Items:</strong> {guide.rb_order_guide_items?.length || 0} ingredients
                </div>
              </div>

              {guide.rb_order_guide_items && guide.rb_order_guide_items.length > 0 && (
                <div style={styles.itemsList}>
                  <h4 style={styles.itemsTitle}>Order Items:</h4>
                  {guide.rb_order_guide_items.map((item, index) => {
                    const quantity = item.suggested_quantity || item.actual_quantity || 0;
                    return (
                      <div key={index} style={styles.itemRow}>
                        <span style={styles.itemName}>{item.inventory?.name || 'Unknown'}</span>
                        <span style={styles.itemQuantity}>{quantity} {item.unit_of_measure || ''}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Guide Modal */}
      {showModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>
              {editingGuide ? 'Edit Order Guide' : 'Add New Order Guide'}
            </h3>
            
            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.formGrid}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Guide Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    style={styles.input}
                    required
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({...formData, status: e.target.value})}
                    style={styles.input}
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              {/* Guide Items */}
              <div style={styles.itemsSection}>
                <div style={styles.itemsHeader}>
                  <h4 style={styles.itemsTitle}>Order Items</h4>
                  <button
                    type="button"
                    onClick={addGuideItem}
                    style={styles.addItemButton}
                  >
                    <Plus size={16} />
                    Add Item
                  </button>
                </div>

                {guideItems.map((item, index) => (
                  <div key={index} style={styles.itemForm}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Ingredient</label>
                      <select
                        value={item.inventory_id}
                        onChange={(e) => {
                          const selectedIngredient = ingredients.find(ing => ing.id === e.target.value);
                          updateGuideItem(index, 'inventory_id', e.target.value);
                          updateGuideItem(index, 'unit_of_measure', selectedIngredient?.unit_of_measure || '');
                        }}
                        style={styles.input}
                      >
                        <option value="">Select ingredient</option>
                        {ingredients.map(ingredient => (
                          <option key={ingredient.id} value={ingredient.id}>
                            {ingredient.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Suggested Quantity</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.suggested_quantity || 0}
                        onChange={(e) => updateGuideItem(index, 'suggested_quantity', parseFloat(e.target.value) || 0)}
                        style={styles.input}
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Unit</label>
                      <input
                        type="text"
                        value={item.unit_of_measure}
                        onChange={(e) => updateGuideItem(index, 'unit_of_measure', e.target.value)}
                        style={styles.input}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => removeGuideItem(index)}
                      style={styles.removeItemButton}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
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
                  {editingGuide ? 'Update Guide' : 'Create Guide'}
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
  guidesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
    gap: '20px'
  },
  guideCard: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: '12px',
    padding: '20px',
    boxShadow: TavariStyles.shadows?.base || '0 2px 4px rgba(0,0,0,0.1)',
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  guideHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '16px'
  },
  guideInfo: {
    flex: 1
  },
  guideName: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: TavariStyles.colors.gray800,
    marginBottom: '8px'
  },
  guideStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  statusBadge: {
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: '500'
  },
  guideActions: {
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
  guideDetails: {
    marginBottom: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  detailItem: {
    fontSize: '14px',
    color: TavariStyles.colors.gray700
  },
  itemsList: {
    padding: '12px',
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: '8px',
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  itemsTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: TavariStyles.colors.gray800,
    marginBottom: '8px'
  },
  itemRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
    fontSize: '14px'
  },
  itemName: {
    color: TavariStyles.colors.gray800
  },
  itemQuantity: {
    color: TavariStyles.colors.gray600,
    fontWeight: '500'
  },
  emptyState: {
    gridColumn: '1 / -1',
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
  itemsSection: {
    padding: '16px',
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: '8px',
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  itemsHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px'
  },
  addItemButton: {
    ...TavariStyles.components.button?.base,
    backgroundColor: TavariStyles.colors.successBg,
    color: TavariStyles.colors.success,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    fontSize: '13px'
  },
  itemForm: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr auto',
    gap: '12px',
    alignItems: 'end',
    marginBottom: '12px',
    padding: '12px',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: '8px',
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  removeItemButton: {
    backgroundColor: TavariStyles.colors.errorBg,
    color: TavariStyles.colors.error,
    border: 'none',
    padding: '8px',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
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

export default OrderGuidesTab;
