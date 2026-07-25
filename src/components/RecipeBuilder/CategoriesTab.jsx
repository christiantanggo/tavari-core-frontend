// src/components/RecipeBuilder/CategoriesTab.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { Plus, Edit, Trash2, Search, Palette } from 'lucide-react';

const CategoriesTab = ({ businessId }) => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    color: '#3b82f6',
    emoji: '📦',
    category_type: 'recipe_only'
  });

  useEffect(() => {
    if (businessId) {
      fetchCategories();
    }
  }, [businessId]);

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('pos_categories')
        .select('*')
        .eq('business_id', businessId)
        .in('category_type', ['recipe_only', 'both'])
        .order('name');

      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
      toast.error('Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const categoryData = {
        ...formData,
        business_id: businessId
      };

      if (editingCategory) {
        const { error } = await supabase
          .from('pos_categories')
          .update(categoryData)
          .eq('id', editingCategory.id);

        if (error) throw error;
        toast.success('Category updated successfully');
      } else {
        const { error } = await supabase
          .from('pos_categories')
          .insert(categoryData);

        if (error) throw error;
        toast.success('Category created successfully');
      }

      setShowModal(false);
      setEditingCategory(null);
      resetForm();
      fetchCategories();
    } catch (error) {
      console.error('Error saving category:', error);
      toast.error('Failed to save category');
    }
  };

  const handleEdit = (category) => {
    setEditingCategory(category);
    setFormData({
      name: category.name || '',
      color: category.color || '#3b82f6',
      emoji: category.emoji || '📦',
      category_type: category.category_type || 'recipe_only'
    });
    setShowModal(true);
  };

  const handleDelete = async (category) => {
    if (!confirm('Are you sure you want to delete this category?')) return;

    try {
      const { error: inventoryError } = await supabase
        .from('pos_inventory')
        .update({ category_id: null })
        .eq('business_id', businessId)
        .eq('category_id', category.id);

      if (inventoryError) throw inventoryError;

      const { error: ingredientError } = await supabase
        .from('ingredients')
        .update({ category_id: null })
        .eq('business_id', businessId)
        .eq('category_id', category.id);

      if (ingredientError && !['42P01', 'PGRST205'].includes(ingredientError.code)) {
        throw ingredientError;
      }

      const { error } = await supabase
        .from('pos_categories')
        .delete()
        .eq('id', category.id);

      if (error) throw error;
      toast.success('Category deleted successfully');
      fetchCategories();
    } catch (error) {
      console.error('Error deleting category:', error);
      const errorMessage = error?.code === '23503'
        ? 'Failed to delete category because related records still reference it.'
        : 'Failed to delete category';
      toast.error(errorMessage, { duration: 6000 });
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      color: '#3b82f6',
      emoji: '📦',
      category_type: 'recipe_only'
    });
  };

  const handleAddNew = () => {
    setEditingCategory(null);
    resetForm();
    setShowModal(true);
  };

  const filteredCategories = categories.filter(category =>
    category.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const commonEmojis = ['🥩', '🥕', '🥛', '🌿', '🌾', '🍞', '🧀', '🥚', '🐟', '🍗', '🥔', '🧅', '🍅', '🥒', '🥬', '🍄', '🌶️', '🧄', '🥜', '🍯', '🧂', '🫒', '🌽', '🍠', '🥦', '🥑', '🍋', '🍊', '🍎', '🍌', '🍇', '🍓', '🫐', '🍑', '🥭', '🍍', '🥥', '🍈', '🍉', '🍒', '🍅'];

  if (loading) {
    return <div style={styles.loading}>Loading categories...</div>;
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.title}>Ingredient Categories</h2>
        <p style={styles.subtitle}>Organize your ingredients into categories</p>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <div style={styles.searchContainer}>
          <Search size={20} style={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search categories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
        </div>

        <button onClick={handleAddNew} style={styles.addButton}>
          <Plus size={20} />
          Add Category
        </button>
      </div>

      {/* Categories Grid */}
      <div style={styles.gridContainer}>
        <div style={styles.gridHeader}>
          <span>Category</span>
          <span>Type</span>
          <span>Color</span>
          <span>Actions</span>
        </div>

        {filteredCategories.map(category => (
          <div key={category.id} style={styles.gridRow}>
            <span style={styles.nameCell}>
              <div style={styles.categoryInfo}>
                <span style={styles.emoji}>{category.emoji}</span>
                <span style={styles.categoryName}>{category.name}</span>
              </div>
            </span>
            
            <span style={styles.typeCell}>
              <span style={{
                ...styles.typeBadge,
                backgroundColor: category.category_type === 'both' ? TavariStyles.colors.infoBg : TavariStyles.colors.successBg,
                color: category.category_type === 'both' ? TavariStyles.colors.infoText : TavariStyles.colors.successText
              }}>
                {category.category_type === 'both' ? 'POS & Recipe' : 'Recipe Only'}
              </span>
            </span>
            
            <span style={styles.colorCell}>
              <div style={styles.colorPreview}>
                <div style={{
                  ...styles.colorSwatch,
                  backgroundColor: category.color
                }}></div>
                <span style={styles.colorCode}>{category.color}</span>
              </div>
            </span>
            
            <span style={styles.actionsCell}>
              <button
                onClick={() => handleEdit(category)}
                style={styles.editButton}
                title="Edit category"
              >
                <Edit size={16} />
              </button>
              <button
                onClick={() => handleDelete(category)}
                style={styles.deleteButton}
                title="Delete category"
              >
                <Trash2 size={16} />
              </button>
            </span>
          </div>
        ))}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>
              {editingCategory ? 'Edit Category' : 'Add New Category'}
            </h3>
            
            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Category Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  style={styles.input}
                  required
                />
              </div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Emoji</label>
                  <div style={styles.emojiSelector}>
                    <input
                      type="text"
                      value={formData.emoji}
                      onChange={(e) => setFormData({...formData, emoji: e.target.value})}
                      style={styles.emojiInput}
                      maxLength="2"
                    />
                    <div style={styles.emojiGrid}>
                      {commonEmojis.map(emoji => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setFormData({...formData, emoji})}
                          style={{
                            ...styles.emojiButton,
                            backgroundColor: formData.emoji === emoji ? TavariStyles.colors.primary : 'transparent'
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div style={styles.formGroup}>
                  <label style={styles.label}>Color</label>
                  <div style={styles.colorSelector}>
                    <input
                      type="color"
                      value={formData.color}
                      onChange={(e) => setFormData({...formData, color: e.target.value})}
                      style={styles.colorInput}
                    />
                    <input
                      type="text"
                      value={formData.color}
                      onChange={(e) => setFormData({...formData, color: e.target.value})}
                      style={styles.colorTextInput}
                    />
                  </div>
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Category Type</label>
                <select
                  value={formData.category_type}
                  onChange={(e) => setFormData({...formData, category_type: e.target.value})}
                  style={styles.input}
                >
                  <option value="recipe_only">Recipe Only</option>
                  <option value="both">POS & Recipe</option>
                </select>
              </div>

              <div style={styles.preview}>
                <label style={styles.label}>Preview</label>
                <div style={styles.categoryPreview}>
                  <span style={styles.previewEmoji}>{formData.emoji}</span>
                  <span style={{
                    ...styles.previewName,
                    color: formData.color
                  }}>{formData.name || 'Category Name'}</span>
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
                  {editingCategory ? 'Update' : 'Create'} Category
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
    gridTemplateColumns: '2fr 1fr 1.5fr auto',
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
    gridTemplateColumns: '2fr 1fr 1.5fr auto',
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
  typeCell: {
    fontSize: '13px',
    minWidth: 0,
    overflow: 'hidden'
  },
  colorCell: {
    fontSize: '13px',
    minWidth: 0,
    overflow: 'hidden'
  },
  categoryInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  emoji: {
    fontSize: '20px'
  },
  categoryName: {
    fontWeight: '500',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  typeBadge: {
    padding: '4px 8px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '500'
  },
  colorPreview: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  colorSwatch: {
    width: '20px',
    height: '20px',
    borderRadius: '4px',
    border: `1px solid ${TavariStyles.colors.gray300}`
  },
  colorCode: {
    fontFamily: 'monospace',
    fontSize: '13px',
    color: TavariStyles.colors.gray600
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
    maxWidth: '800px',
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
  emojiSelector: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  emojiInput: {
    padding: '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '8px',
    fontSize: '16px',
    textAlign: 'center',
    width: '60px'
  },
  emojiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, 1fr)',
    gap: '4px',
    maxHeight: '120px',
    overflowY: 'auto',
    padding: '8px',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '8px'
  },
  emojiButton: {
    border: 'none',
    padding: '8px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  colorSelector: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center'
  },
  colorInput: {
    width: '50px',
    height: '40px',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  colorTextInput: {
    flex: 1,
    padding: '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'monospace'
  },
  preview: {
    padding: '16px',
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: '8px',
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  categoryPreview: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '16px'
  },
  previewEmoji: {
    fontSize: '20px'
  },
  previewName: {
    fontWeight: '500'
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

export default CategoriesTab;
