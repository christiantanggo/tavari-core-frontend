// components/HR/PolicyCategoryManager.jsx
import React, { useState, useEffect } from 'react';
import { X, Plus, Edit2, Trash2, Save } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';

const PolicyCategoryManager = ({ isOpen, onClose, businessId, onCategoriesUpdated }) => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [formData, setFormData] = useState({
    category_name: '',
    description: '',
    display_order: 0
  });

  useEffect(() => {
    if (isOpen && businessId) {
      loadCategories();
    }
  }, [isOpen, businessId]);

  const loadCategories = async () => {
    setLoading(true);
    try {
      // Load all policy categories
      const { data, error } = await supabase
        .from('hr_policy_categories')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .order('category_name', { ascending: true });

      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error('Error loading policy categories:', error);
      toast.error('Failed to load policy categories');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCategory = async () => {
    if (!formData.category_name.trim()) {
      toast.error('Category name is required');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('hr_policy_categories')
        .insert({
          business_id: businessId,
          category_name: formData.category_name.trim(),
          description: formData.description.trim() || null,
          is_active: true,
          display_order: formData.display_order || categories.length + 1,
          created_by: (await supabase.auth.getUser()).data.user?.id
        })
        .select()
        .single();

      if (error) throw error;

      toast.success('Policy category added successfully');
      setShowAddModal(false);
      setFormData({ category_name: '', description: '', display_order: 0 });
      await loadCategories();
      if (onCategoriesUpdated) onCategoriesUpdated();
    } catch (error) {
      console.error('Error adding policy category:', error);
      if (error.code === '23505') {
        toast.error('A category with this name already exists');
      } else {
        toast.error('Failed to add policy category: ' + (error.message || 'Unknown error'));
      }
    }
  };

  const handleEditCategory = async () => {
    if (!formData.category_name.trim()) {
      toast.error('Category name is required');
      return;
    }

    try {
      const { error } = await supabase
        .from('hr_policy_categories')
        .update({
          category_name: formData.category_name.trim(),
          description: formData.description.trim() || null,
          display_order: formData.display_order || editingCategory.display_order,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingCategory.id);

      if (error) throw error;

      toast.success('Policy category updated successfully');
      setShowAddModal(false);
      setEditingCategory(null);
      setFormData({ category_name: '', description: '', display_order: 0 });
      await loadCategories();
      if (onCategoriesUpdated) onCategoriesUpdated();
    } catch (error) {
      console.error('Error updating policy category:', error);
      if (error.code === '23505') {
        toast.error('A category with this name already exists');
      } else {
        toast.error('Failed to update policy category: ' + (error.message || 'Unknown error'));
      }
    }
  };

  const handleDeleteCategory = async (category) => {
    if (!confirm(`Are you sure you want to delete "${category.category_name}"? This cannot be undone.`)) {
      return;
    }

    try {
      // Check if any policies use this category
      const { data: policies, error: checkError } = await supabase
        .from('hr_policies')
        .select('id, policy_categories')
        .eq('business_id', businessId)
        .limit(1000); // Check up to 1000 policies

      if (checkError) throw checkError;

      // Check if category ID is in any policy's categories array
      const categoryInUse = policies?.some(policy => {
        const categories = policy.policy_categories || [];
        return Array.isArray(categories) && categories.includes(category.id);
      });

      if (categoryInUse) {
        toast.error('Cannot delete category that is in use. Please remove it from policies first.');
        return;
      }

      // Soft delete by setting is_active to false
      const { error } = await supabase
        .from('hr_policy_categories')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', category.id);

      if (error) throw error;

      toast.success('Policy category deleted successfully');
      await loadCategories();
      if (onCategoriesUpdated) onCategoriesUpdated();
    } catch (error) {
      console.error('Error deleting policy category:', error);
      toast.error('Failed to delete policy category: ' + (error.message || 'Unknown error'));
    }
  };

  const openEditModal = (category) => {
    setEditingCategory(category);
    setFormData({
      category_name: category.category_name,
      description: category.description || '',
      display_order: category.display_order || 0
    });
    setShowAddModal(true);
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingCategory(null);
    setFormData({ category_name: '', description: '', display_order: 0 });
  };

  if (!isOpen) return null;

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    },
    modal: {
      backgroundColor: '#ffffff',
      borderRadius: '8px',
      width: '100%',
      maxWidth: '700px',
      maxHeight: '90vh',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '20px 24px',
      borderBottom: '1px solid #e5e7eb'
    },
    title: {
      fontSize: '20px',
      fontWeight: 'bold',
      margin: 0
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      display: 'flex',
      alignItems: 'center'
    },
    content: {
      padding: '24px',
      overflowY: 'auto',
      flex: 1
    },
    addButton: {
      padding: '10px 20px',
      backgroundColor: '#14B8A6',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '20px'
    },
    categoryItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '16px',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      marginBottom: '12px',
      backgroundColor: '#f9fafb'
    },
    categoryInfo: {
      flex: 1
    },
    categoryName: {
      fontSize: '16px',
      fontWeight: '600',
      color: '#111827',
      marginBottom: '4px'
    },
    categoryDescription: {
      fontSize: '14px',
      color: '#6b7280',
      marginTop: '4px'
    },
    categoryActions: {
      display: 'flex',
      gap: '8px'
    },
    actionButton: {
      padding: '8px 12px',
      fontSize: '14px',
      borderRadius: '6px',
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontWeight: '500'
    },
    editButton: {
      backgroundColor: '#3b82f6',
      color: 'white'
    },
    deleteButton: {
      backgroundColor: '#ef4444',
      color: 'white'
    },
    formGroup: {
      marginBottom: '16px'
    },
    label: {
      display: 'block',
      marginBottom: '6px',
      fontWeight: '500',
      fontSize: '14px',
      color: '#374151'
    },
    input: {
      width: '100%',
      padding: '10px 12px',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      fontSize: '14px',
      boxSizing: 'border-box'
    },
    textarea: {
      width: '100%',
      padding: '10px 12px',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      fontSize: '14px',
      minHeight: '80px',
      resize: 'vertical',
      fontFamily: 'inherit',
      boxSizing: 'border-box'
    },
    modalFooter: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '12px',
      padding: '20px 24px',
      borderTop: '1px solid #e5e7eb'
    },
    cancelButton: {
      padding: '10px 20px',
      backgroundColor: 'white',
      color: '#374151',
      border: '2px solid #d1d5db',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer'
    },
    saveButton: {
      padding: '10px 20px',
      backgroundColor: '#14B8A6',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    infoText: {
      fontSize: '13px',
      color: '#6b7280',
      marginTop: '8px',
      fontStyle: 'italic'
    }
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Manage Policy Categories</h2>
          <button onClick={onClose} style={styles.closeButton}>
            <X size={24} />
          </button>
        </div>

        <div style={styles.content}>
          <div style={styles.infoText}>
            Categories are used to organize policy content. They are numbered dynamically (1, 2, 3...) based on which categories are actually used in each policy, so skipped categories won't disrupt numbering.
          </div>

          <button onClick={() => setShowAddModal(true)} style={styles.addButton}>
            <Plus size={18} />
            Add Policy Category
          </button>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <div style={{ fontSize: '16px', color: '#6b7280' }}>Loading categories...</div>
            </div>
          ) : categories.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <div style={{ fontSize: '16px', color: '#6b7280' }}>No categories found. Add your first category to get started.</div>
            </div>
          ) : (
            categories.map((category) => (
              <div key={category.id} style={styles.categoryItem}>
                <div style={styles.categoryInfo}>
                  <div style={styles.categoryName}>{category.category_name}</div>
                  {category.description && (
                    <div style={styles.categoryDescription}>{category.description}</div>
                  )}
                </div>
                <div style={styles.categoryActions}>
                  <button
                    onClick={() => openEditModal(category)}
                    style={{ ...styles.actionButton, ...styles.editButton }}
                  >
                    <Edit2 size={16} />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteCategory(category)}
                    style={{ ...styles.actionButton, ...styles.deleteButton }}
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add/Edit Modal */}
        {showAddModal && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001
          }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              width: '90%',
              maxWidth: '500px'
            }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px' }}>
                {editingCategory ? 'Edit Policy Category' : 'Add New Policy Category'}
              </h3>

              <div style={styles.formGroup}>
                <label style={styles.label}>Category Name *</label>
                <input
                  type="text"
                  value={formData.category_name}
                  onChange={(e) => setFormData({ ...formData, category_name: e.target.value })}
                  style={styles.input}
                  placeholder="e.g., General Provisions, Employee Conduct"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Description (optional)</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  style={styles.textarea}
                  placeholder="Brief description of what this category covers"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Display Order (optional)</label>
                <input
                  type="number"
                  value={formData.display_order}
                  onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
                  style={styles.input}
                  min="0"
                />
                <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                  Lower numbers appear first in the list
                </div>
              </div>

              <div style={styles.modalFooter}>
                <button onClick={closeModal} style={styles.cancelButton}>
                  Cancel
                </button>
                <button
                  onClick={editingCategory ? handleEditCategory : handleAddCategory}
                  style={styles.saveButton}
                >
                  <Save size={18} />
                  {editingCategory ? 'Update' : 'Add'} Category
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PolicyCategoryManager;

