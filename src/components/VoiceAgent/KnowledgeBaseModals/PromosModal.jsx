// components/VoiceAgent/KnowledgeBaseModals/PromosModal.jsx
// Modal for managing Promos with mention timing options
import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, ArrowUp, ArrowDown, Save, X } from 'lucide-react';
import { TavariStyles } from '../../../utils/TavariStyles';
import toast from 'react-hot-toast';
import TavariCheckbox from '../../UI/TavariCheckbox';
import BaseKnowledgeModal from './BaseKnowledgeModal';

const PromosModal = ({ isOpen, onClose, businessId, voiceAgentService, onSave }) => {
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingPromo, setEditingPromo] = useState(null);
  const [newPromo, setNewPromo] = useState({ 
    promo_name: '', 
    promo_details: '',
    mention_at_start: false,
    mention_before_end: false,
    mention_casually: false,
  });

  useEffect(() => {
    if (isOpen && businessId) {
      loadPromos();
    }
  }, [isOpen, businessId]);

  const loadPromos = async () => {
    setLoading(true);
    try {
      if (voiceAgentService?.getPromos) {
        const loadedPromos = await voiceAgentService.getPromos(businessId);
        setPromos(loadedPromos || []);
      }
    } catch (error) {
      console.error('Error loading promos:', error);
      toast.error('Failed to load promos');
    } finally {
      setLoading(false);
    }
  };

  const handleAddPromo = async () => {
    if (!newPromo.promo_name.trim() || !newPromo.promo_details.trim()) {
      toast.error('Please enter both promo name and details');
      return;
    }

    setSaving(true);
    try {
      const createdPromo = await voiceAgentService.createPromo(businessId, {
        promo_name: newPromo.promo_name.trim(),
        promo_details: newPromo.promo_details.trim(),
        mention_at_start: newPromo.mention_at_start || false,
        mention_before_end: newPromo.mention_before_end || false,
        mention_casually: newPromo.mention_casually || false,
        is_active: true,
      });
      
      setPromos([...promos, createdPromo]);
      setNewPromo({ 
        promo_name: '', 
        promo_details: '',
        mention_at_start: false,
        mention_before_end: false,
        mention_casually: false,
      });
      toast.success('Promo added successfully');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error adding promo:', error);
      toast.error('Failed to add promo: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePromo = async (promoId, updates) => {
    setSaving(true);
    try {
      const updatedPromo = await voiceAgentService.updatePromo(promoId, updates);
      setPromos(promos.map(promo => promo.id === promoId ? updatedPromo : promo));
      setEditingPromo(null);
      toast.success('Promo updated successfully');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error updating promo:', error);
      toast.error('Failed to update promo: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePromo = async (promoId) => {
    if (!confirm('Are you sure you want to delete this promo?')) return;
    
    setSaving(true);
    try {
      await voiceAgentService.deletePromo(promoId);
      setPromos(promos.filter(promo => promo.id !== promoId));
      toast.success('Promo deleted successfully');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error deleting promo:', error);
      toast.error('Failed to delete promo: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleMovePromo = async (promoId, direction) => {
    const index = promos.findIndex(p => p.id === promoId);
    if (index === -1) return;
    
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= promos.length) return;
    
    setSaving(true);
    try {
      const currentOrder = promos[index].display_order || index;
      const targetOrder = promos[newIndex].display_order || newIndex;
      
      await voiceAgentService.updatePromo(promos[index].id, { display_order: targetOrder });
      await voiceAgentService.updatePromo(promos[newIndex].id, { display_order: currentOrder });
      
      const reloadedPromos = await voiceAgentService.getPromos(businessId);
      setPromos(reloadedPromos || []);
      toast.success('Promo order updated');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error moving promo:', error);
      toast.error('Failed to move promo');
    } finally {
      setSaving(false);
    }
  };

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
    checkboxGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.sm,
    },
    promoItem: {
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      marginBottom: TavariStyles.spacing.sm,
    },
    promoActions: {
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
    newPromoSection: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `2px dashed ${TavariStyles.colors.gray300}`,
      marginBottom: TavariStyles.spacing.lg,
    },
    mentionTags: {
      display: 'flex',
      gap: TavariStyles.spacing.xs,
      marginTop: TavariStyles.spacing.xs,
      flexWrap: 'wrap',
    },
    mentionTag: {
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      backgroundColor: TavariStyles.colors.primary || '#008080',
      color: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography.fontSize.xs,
    },
  };

  if (loading) {
    return (
      <BaseKnowledgeModal isOpen={isOpen} onClose={onClose} title="Promos">
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <div>Loading promos...</div>
        </div>
      </BaseKnowledgeModal>
    );
  }

  return (
    <BaseKnowledgeModal isOpen={isOpen} onClose={onClose} title="Promos" width="900px">
      {/* Add New Promo Section - At Top */}
      <div style={styles.newPromoSection}>
        <h3 style={styles.sectionTitle}>Add New Promo</h3>
        <div style={styles.formGroup}>
          <label style={styles.label}>Promo Name *</label>
          <input
            type="text"
            value={newPromo.promo_name}
            onChange={(e) => setNewPromo({ ...newPromo, promo_name: e.target.value })}
            placeholder="e.g., Summer Special, Birthday Discount"
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Promo Details *</label>
          <textarea
            value={newPromo.promo_details}
            onChange={(e) => setNewPromo({ ...newPromo, promo_details: e.target.value })}
            placeholder="Detailed description of the promotional offer..."
            style={styles.textarea}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>When to Mention Promo</label>
          <div style={styles.checkboxGroup}>
            <TavariCheckbox
              checked={newPromo.mention_at_start}
              onChange={(checked) => setNewPromo({ ...newPromo, mention_at_start: checked })}
              label="Mention immediately at the beginning of the call"
            />
            <TavariCheckbox
              checked={newPromo.mention_before_end}
              onChange={(checked) => setNewPromo({ ...newPromo, mention_before_end: checked })}
              label="Ensure to talk about the promo before the end of the call"
            />
            <TavariCheckbox
              checked={newPromo.mention_casually}
              onChange={(checked) => setNewPromo({ ...newPromo, mention_casually: checked })}
              label="Casually throughout the conversation, choose a time to talk about the promo"
            />
          </div>
        </div>
        <button
          onClick={handleAddPromo}
          disabled={saving}
          style={{
            ...styles.buttonSmall,
            backgroundColor: '#10b981',
            color: 'white',
            padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
          }}
        >
          <Plus size={16} />
          Add Promo
        </button>
      </div>

      {/* Existing Promos */}
      {promos.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Existing Promos ({promos.length})</h3>
          {promos.map((promo, index) => (
            <div key={promo.id} style={styles.promoItem}>
              {editingPromo?.id === promo.id ? (
                <div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Promo Name</label>
                    <input
                      type="text"
                      value={editingPromo.promo_name}
                      onChange={(e) => setEditingPromo({ ...editingPromo, promo_name: e.target.value })}
                      style={styles.input}
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Promo Details</label>
                    <textarea
                      value={editingPromo.promo_details}
                      onChange={(e) => setEditingPromo({ ...editingPromo, promo_details: e.target.value })}
                      style={styles.textarea}
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>When to Mention Promo</label>
                    <div style={styles.checkboxGroup}>
                      <TavariCheckbox
                        checked={editingPromo.mention_at_start || false}
                        onChange={(checked) => setEditingPromo({ ...editingPromo, mention_at_start: checked })}
                        label="Mention immediately at the beginning of the call"
                      />
                      <TavariCheckbox
                        checked={editingPromo.mention_before_end || false}
                        onChange={(checked) => setEditingPromo({ ...editingPromo, mention_before_end: checked })}
                        label="Ensure to talk about the promo before the end of the call"
                      />
                      <TavariCheckbox
                        checked={editingPromo.mention_casually || false}
                        onChange={(checked) => setEditingPromo({ ...editingPromo, mention_casually: checked })}
                        label="Casually throughout the conversation, choose a time to talk about the promo"
                      />
                    </div>
                  </div>
                  <div style={styles.promoActions}>
                    <button
                      onClick={() => handleUpdatePromo(promo.id, editingPromo)}
                      style={{ ...styles.buttonSmall, backgroundColor: '#10b981', color: 'white' }}
                    >
                      <Save size={14} />
                      Save
                    </button>
                    <button
                      onClick={() => setEditingPromo(null)}
                      style={{ ...styles.buttonSmall, backgroundColor: '#6b7280', color: 'white' }}
                    >
                      <X size={14} />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{promo.promo_name}</div>
                  <div style={{ color: TavariStyles.colors.gray600, whiteSpace: 'pre-wrap', marginBottom: '8px' }}>
                    {promo.promo_details}
                  </div>
                  {(promo.mention_at_start || promo.mention_before_end || promo.mention_casually) && (
                    <div style={styles.mentionTags}>
                      {promo.mention_at_start && <span style={styles.mentionTag}>At Start</span>}
                      {promo.mention_before_end && <span style={styles.mentionTag}>Before End</span>}
                      {promo.mention_casually && <span style={styles.mentionTag}>Casually</span>}
                    </div>
                  )}
                  <div style={styles.promoActions}>
                    <button
                      onClick={() => setEditingPromo({ ...promo })}
                      style={{ ...styles.buttonSmall, backgroundColor: '#3b82f6', color: 'white' }}
                    >
                      <Edit2 size={14} />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeletePromo(promo.id)}
                      style={{ ...styles.buttonSmall, backgroundColor: '#ef4444', color: 'white' }}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                    {index > 0 && (
                      <button
                        onClick={() => handleMovePromo(promo.id, 'up')}
                        style={{ ...styles.buttonSmall, backgroundColor: '#6b7280', color: 'white' }}
                        title="Move up"
                      >
                        <ArrowUp size={14} />
                      </button>
                    )}
                    {index < promos.length - 1 && (
                      <button
                        onClick={() => handleMovePromo(promo.id, 'down')}
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
          ))}
        </div>
      )}

      {promos.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '48px', color: TavariStyles.colors.gray500 }}>
          No promos added yet. Add your first promo above.
        </div>
      )}
    </BaseKnowledgeModal>
  );
};

export default PromosModal;

