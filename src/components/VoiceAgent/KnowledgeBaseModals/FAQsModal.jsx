// components/VoiceAgent/KnowledgeBaseModals/FAQsModal.jsx
// Modal for managing FAQs with categories
import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, ArrowUp, ArrowDown, Save, X } from 'lucide-react';
import { TavariStyles } from '../../../utils/TavariStyles';
import toast from 'react-hot-toast';
import BaseKnowledgeModal from './BaseKnowledgeModal';

const FAQsModal = ({ isOpen, onClose, businessId, voiceAgentService, onSave }) => {
  const [faqs, setFaqs] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingFaq, setEditingFaq] = useState(null);
  const [newFaq, setNewFaq] = useState({ 
    question: '', 
    answer: '', 
    category: '' 
  });
  const [newCategory, setNewCategory] = useState('');

  useEffect(() => {
    if (isOpen && businessId) {
      loadFAQs();
    }
  }, [isOpen, businessId]);

  const loadFAQs = async () => {
    setLoading(true);
    try {
      if (voiceAgentService?.getBusinessFAQs) {
        const loadedFaqs = await voiceAgentService.getBusinessFAQs(businessId);
        setFaqs(loadedFaqs || []);
        
        // Extract unique categories
        const uniqueCategories = [...new Set(
          (loadedFaqs || [])
            .map(faq => faq.category)
            .filter(cat => cat && cat.trim())
        )];
        setCategories(uniqueCategories);
      }
    } catch (error) {
      console.error('Error loading FAQs:', error);
      toast.error('Failed to load FAQs');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCategory = () => {
    if (!newCategory.trim()) {
      toast.error('Please enter a category name');
      return;
    }
    
    if (categories.includes(newCategory.trim())) {
      toast.error('Category already exists');
      return;
    }
    
    setCategories([...categories, newCategory.trim()]);
    setNewFaq({ ...newFaq, category: newCategory.trim() });
    setNewCategory('');
    toast.success('Category added');
  };

  const handleAddFaq = async () => {
    if (!newFaq.question.trim() || !newFaq.answer.trim()) {
      toast.error('Please enter both question and answer');
      return;
    }

    setSaving(true);
    try {
      const createdFaq = await voiceAgentService.createBusinessFAQ(businessId, {
        question: newFaq.question.trim(),
        answer: newFaq.answer.trim(),
        category: newFaq.category?.trim() || null,
        is_active: true,
      });
      
      setFaqs([...faqs, createdFaq]);
      
      // Add category if new
      if (newFaq.category && !categories.includes(newFaq.category)) {
        setCategories([...categories, newFaq.category]);
      }
      
      setNewFaq({ question: '', answer: '', category: '' });
      toast.success('FAQ added successfully');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error adding FAQ:', error);
      toast.error('Failed to add FAQ: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateFaq = async (faqId, updates) => {
    setSaving(true);
    try {
      const updatedFaq = await voiceAgentService.updateBusinessFAQ(faqId, updates);
      setFaqs(faqs.map(faq => faq.id === faqId ? updatedFaq : faq));
      
      // Update categories if needed
      if (updates.category && !categories.includes(updates.category)) {
        setCategories([...categories, updates.category]);
      }
      
      setEditingFaq(null);
      toast.success('FAQ updated successfully');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error updating FAQ:', error);
      toast.error('Failed to update FAQ: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFaq = async (faqId) => {
    if (!confirm('Are you sure you want to delete this FAQ?')) return;
    
    setSaving(true);
    try {
      await voiceAgentService.deleteBusinessFAQ(faqId);
      setFaqs(faqs.filter(faq => faq.id !== faqId));
      toast.success('FAQ deleted successfully');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error deleting FAQ:', error);
      toast.error('Failed to delete FAQ: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleMoveFaq = async (faqId, direction) => {
    const index = faqs.findIndex(f => f.id === faqId);
    if (index === -1) return;
    
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= faqs.length) return;
    
    setSaving(true);
    try {
      const currentOrder = faqs[index].display_order || index;
      const targetOrder = faqs[newIndex].display_order || newIndex;
      
      await voiceAgentService.updateBusinessFAQ(faqs[index].id, { display_order: targetOrder });
      await voiceAgentService.updateBusinessFAQ(faqs[newIndex].id, { display_order: currentOrder });
      
      const reloadedFaqs = await voiceAgentService.getBusinessFAQs(businessId);
      setFaqs(reloadedFaqs || []);
      toast.success('FAQ order updated');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error moving FAQ:', error);
      toast.error('Failed to move FAQ');
    } finally {
      setSaving(false);
    }
  };

  // Group FAQs by category
  const faqsByCategory = faqs.reduce((acc, faq) => {
    const category = faq.category || 'Uncategorized';
    if (!acc[category]) acc[category] = [];
    acc[category].push(faq);
    return acc;
  }, {});

  const styles = {
    section: {
      marginBottom: TavariStyles.spacing.xl,
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.md,
    },
    formGroup: {
      marginBottom: TavariStyles.spacing.md,
    },
    label: {
      display: 'block',
      marginBottom: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
    },
    input: {
      width: '100%',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      boxSizing: 'border-box',
    },
    textarea: {
      width: '100%',
      minHeight: '100px',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      fontFamily: 'inherit',
      resize: 'vertical',
    },
    select: {
      width: '100%',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      backgroundColor: TavariStyles.colors.white,
      boxSizing: 'border-box',
    },
    categoryInputGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.xs,
      marginTop: TavariStyles.spacing.xs,
    },
    faqItem: {
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      marginBottom: TavariStyles.spacing.sm,
    },
    faqActions: {
      display: 'flex',
      gap: TavariStyles.spacing.xs,
      marginTop: TavariStyles.spacing.sm,
    },
    buttonSmall: {
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography.fontSize.xs,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    },
    newFaqSection: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `2px dashed ${TavariStyles.colors.gray300}`,
      marginBottom: TavariStyles.spacing.lg,
    },
    categoryBadge: {
      display: 'inline-block',
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      backgroundColor: TavariStyles.colors.primary || '#008080',
      color: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      marginBottom: TavariStyles.spacing.sm,
    },
  };

  if (loading) {
    return (
      <BaseKnowledgeModal isOpen={isOpen} onClose={onClose} title="Frequently Asked Questions">
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <div>Loading FAQs...</div>
        </div>
      </BaseKnowledgeModal>
    );
  }

  return (
    <BaseKnowledgeModal isOpen={isOpen} onClose={onClose} title="Frequently Asked Questions" width="1000px">
      {/* Add New FAQ Section - At Top */}
      <div style={styles.newFaqSection}>
        <h3 style={styles.sectionTitle}>Add New FAQ</h3>
        <div style={styles.formGroup}>
          <label style={styles.label}>Category</label>
          <div style={styles.categoryInputGroup}>
            <select
              value={newFaq.category}
              onChange={(e) => setNewFaq({ ...newFaq, category: e.target.value })}
              style={styles.select}
            >
              <option value="">Select or add category</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
              <option value="__NEW__">+ Add New Category</option>
            </select>
            {newFaq.category === '__NEW__' && (
              <div style={{ display: 'flex', gap: TavariStyles.spacing.xs, flex: 1 }}>
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="New category name"
                  style={styles.input}
                />
                <button
                  onClick={handleAddCategory}
                  style={{
                    ...styles.buttonSmall,
                    backgroundColor: '#10b981',
                    color: 'white',
                    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  }}
                >
                  Add
                </button>
              </div>
            )}
          </div>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Question *</label>
          <input
            type="text"
            value={newFaq.question}
            onChange={(e) => setNewFaq({ ...newFaq, question: e.target.value })}
            placeholder="Enter question..."
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Answer *</label>
          <textarea
            value={newFaq.answer}
            onChange={(e) => setNewFaq({ ...newFaq, answer: e.target.value })}
            placeholder="Enter answer..."
            style={styles.textarea}
          />
        </div>
        <button
          onClick={handleAddFaq}
          disabled={saving}
          style={{
            ...styles.buttonSmall,
            backgroundColor: '#10b981',
            color: 'white',
            padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
          }}
        >
          <Plus size={16} />
          Add FAQ
        </button>
      </div>

      {/* Existing FAQs Grouped by Category */}
      {Object.keys(faqsByCategory).length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Existing FAQs ({faqs.length})</h3>
          {Object.entries(faqsByCategory).map(([category, categoryFaqs]) => (
            <div key={category} style={{ marginBottom: TavariStyles.spacing.xl }}>
              <div style={styles.categoryBadge}>{category}</div>
              {categoryFaqs.map((faq, index) => {
                const globalIndex = faqs.findIndex(f => f.id === faq.id);
                return (
                  <div key={faq.id} style={styles.faqItem}>
                    {editingFaq?.id === faq.id ? (
                      <div>
                        <div style={styles.formGroup}>
                          <label style={styles.label}>Category</label>
                          <select
                            value={editingFaq.category || ''}
                            onChange={(e) => setEditingFaq({ ...editingFaq, category: e.target.value })}
                            style={styles.select}
                          >
                            <option value="">Uncategorized</option>
                            {categories.map(cat => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                        </div>
                        <div style={styles.formGroup}>
                          <label style={styles.label}>Question</label>
                          <input
                            type="text"
                            value={editingFaq.question}
                            onChange={(e) => setEditingFaq({ ...editingFaq, question: e.target.value })}
                            style={styles.input}
                          />
                        </div>
                        <div style={styles.formGroup}>
                          <label style={styles.label}>Answer</label>
                          <textarea
                            value={editingFaq.answer}
                            onChange={(e) => setEditingFaq({ ...editingFaq, answer: e.target.value })}
                            style={styles.textarea}
                          />
                        </div>
                        <div style={styles.faqActions}>
                          <button
                            onClick={() => handleUpdateFaq(faq.id, editingFaq)}
                            style={{ ...styles.buttonSmall, backgroundColor: '#10b981', color: 'white' }}
                          >
                            <Save size={14} />
                            Save
                          </button>
                          <button
                            onClick={() => setEditingFaq(null)}
                            style={{ ...styles.buttonSmall, backgroundColor: '#6b7280', color: 'white' }}
                          >
                            <X size={14} />
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Q: {faq.question}</div>
                        <div style={{ color: TavariStyles.colors.gray600 }}>A: {faq.answer}</div>
                        <div style={styles.faqActions}>
                          <button
                            onClick={() => setEditingFaq({ ...faq })}
                            style={{ ...styles.buttonSmall, backgroundColor: '#3b82f6', color: 'white' }}
                          >
                            <Edit2 size={14} />
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteFaq(faq.id)}
                            style={{ ...styles.buttonSmall, backgroundColor: '#ef4444', color: 'white' }}
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                          {globalIndex > 0 && (
                            <button
                              onClick={() => handleMoveFaq(faq.id, 'up')}
                              style={{ ...styles.buttonSmall, backgroundColor: '#6b7280', color: 'white' }}
                              title="Move up"
                            >
                              <ArrowUp size={14} />
                            </button>
                          )}
                          {globalIndex < faqs.length - 1 && (
                            <button
                              onClick={() => handleMoveFaq(faq.id, 'down')}
                              style={{ ...styles.buttonSmall, backgroundColor: '#6b7280', color: 'white' }}
                              title="Move down"
                            >
                              <ArrowDown size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {faqs.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '48px', color: TavariStyles.colors.gray500 }}>
          No FAQs added yet. Add your first FAQ above.
        </div>
      )}
    </BaseKnowledgeModal>
  );
};

export default FAQsModal;

