// components/VoiceAgent/KnowledgeBaseModals/ImportantRulesModal.jsx
// Modal for managing Important Rules (rule name + description)
import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, ArrowUp, ArrowDown, Save, X } from 'lucide-react';
import { TavariStyles } from '../../../utils/TavariStyles';
import toast from 'react-hot-toast';
import BaseKnowledgeModal from './BaseKnowledgeModal';

const ImportantRulesModal = ({ isOpen, onClose, businessId, voiceAgentService, onSave }) => {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [newRule, setNewRule] = useState({ rule_name: '', rule_description: '' });

  useEffect(() => {
    if (isOpen && businessId) {
      loadRules();
    }
  }, [isOpen, businessId]);

  const loadRules = async () => {
    setLoading(true);
    try {
      if (voiceAgentService?.getImportantRules) {
        const loadedRules = await voiceAgentService.getImportantRules(businessId);
        setRules(loadedRules || []);
      }
    } catch (error) {
      console.error('Error loading rules:', error);
      toast.error('Failed to load important rules');
    } finally {
      setLoading(false);
    }
  };

  const handleAddRule = async () => {
    if (!newRule.rule_name.trim() || !newRule.rule_description.trim()) {
      toast.error('Please enter both rule name and description');
      return;
    }

    setSaving(true);
    try {
      const createdRule = await voiceAgentService.createImportantRule(businessId, {
        rule_name: newRule.rule_name.trim(),
        rule_description: newRule.rule_description.trim(),
        is_active: true,
      });
      
      setRules([...rules, createdRule]);
      setNewRule({ rule_name: '', rule_description: '' });
      toast.success('Rule added successfully');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error adding rule:', error);
      toast.error('Failed to add rule: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateRule = async (ruleId, updates) => {
    setSaving(true);
    try {
      const updatedRule = await voiceAgentService.updateImportantRule(ruleId, updates);
      setRules(rules.map(rule => rule.id === ruleId ? updatedRule : rule));
      setEditingRule(null);
      toast.success('Rule updated successfully');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error updating rule:', error);
      toast.error('Failed to update rule: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    
    setSaving(true);
    try {
      await voiceAgentService.deleteImportantRule(ruleId);
      setRules(rules.filter(rule => rule.id !== ruleId));
      toast.success('Rule deleted successfully');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error deleting rule:', error);
      toast.error('Failed to delete rule: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleMoveRule = async (ruleId, direction) => {
    const index = rules.findIndex(r => r.id === ruleId);
    if (index === -1) return;
    
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= rules.length) return;
    
    setSaving(true);
    try {
      const currentOrder = rules[index].display_order || index;
      const targetOrder = rules[newIndex].display_order || newIndex;
      
      await voiceAgentService.updateImportantRule(rules[index].id, { display_order: targetOrder });
      await voiceAgentService.updateImportantRule(rules[newIndex].id, { display_order: currentOrder });
      
      const reloadedRules = await voiceAgentService.getImportantRules(businessId);
      setRules(reloadedRules || []);
      toast.success('Rule order updated');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error moving rule:', error);
      toast.error('Failed to move rule');
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
    ruleItem: {
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      marginBottom: TavariStyles.spacing.sm,
    },
    ruleActions: {
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
    newRuleSection: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `2px dashed ${TavariStyles.colors.gray300}`,
      marginBottom: TavariStyles.spacing.lg,
    },
  };

  if (loading) {
    return (
      <BaseKnowledgeModal isOpen={isOpen} onClose={onClose} title="Important Rules">
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <div>Loading rules...</div>
        </div>
      </BaseKnowledgeModal>
    );
  }

  return (
    <BaseKnowledgeModal isOpen={isOpen} onClose={onClose} title="Important Rules" width="900px">
      {/* Add New Rule Section - At Top */}
      <div style={styles.newRuleSection}>
        <h3 style={styles.sectionTitle}>Add New Rule</h3>
        <div style={styles.formGroup}>
          <label style={styles.label}>Rule Name *</label>
          <input
            type="text"
            value={newRule.rule_name}
            onChange={(e) => setNewRule({ ...newRule, rule_name: e.target.value })}
            placeholder="e.g., Never quote prices different than listed"
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Rule Description *</label>
          <textarea
            value={newRule.rule_description}
            onChange={(e) => setNewRule({ ...newRule, rule_description: e.target.value })}
            placeholder="Detailed description of the rule..."
            style={styles.textarea}
          />
        </div>
        <button
          onClick={handleAddRule}
          disabled={saving}
          style={{
            ...styles.buttonSmall,
            backgroundColor: '#10b981',
            color: 'white',
            padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
          }}
        >
          <Plus size={16} />
          Add Rule
        </button>
      </div>

      {/* Existing Rules */}
      {rules.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Existing Rules ({rules.length})</h3>
          {rules.map((rule, index) => (
            <div key={rule.id} style={styles.ruleItem}>
              {editingRule?.id === rule.id ? (
                <div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Rule Name</label>
                    <input
                      type="text"
                      value={editingRule.rule_name}
                      onChange={(e) => setEditingRule({ ...editingRule, rule_name: e.target.value })}
                      style={styles.input}
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Rule Description</label>
                    <textarea
                      value={editingRule.rule_description}
                      onChange={(e) => setEditingRule({ ...editingRule, rule_description: e.target.value })}
                      style={styles.textarea}
                    />
                  </div>
                  <div style={styles.ruleActions}>
                    <button
                      onClick={() => handleUpdateRule(rule.id, editingRule)}
                      style={{ ...styles.buttonSmall, backgroundColor: '#10b981', color: 'white' }}
                    >
                      <Save size={14} />
                      Save
                    </button>
                    <button
                      onClick={() => setEditingRule(null)}
                      style={{ ...styles.buttonSmall, backgroundColor: '#6b7280', color: 'white' }}
                    >
                      <X size={14} />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{rule.rule_name}</div>
                  <div style={{ color: TavariStyles.colors.gray600, whiteSpace: 'pre-wrap' }}>
                    {rule.rule_description}
                  </div>
                  <div style={styles.ruleActions}>
                    <button
                      onClick={() => setEditingRule({ ...rule })}
                      style={{ ...styles.buttonSmall, backgroundColor: '#3b82f6', color: 'white' }}
                    >
                      <Edit2 size={14} />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      style={{ ...styles.buttonSmall, backgroundColor: '#ef4444', color: 'white' }}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                    {index > 0 && (
                      <button
                        onClick={() => handleMoveRule(rule.id, 'up')}
                        style={{ ...styles.buttonSmall, backgroundColor: '#6b7280', color: 'white' }}
                        title="Move up"
                      >
                        <ArrowUp size={14} />
                      </button>
                    )}
                    {index < rules.length - 1 && (
                      <button
                        onClick={() => handleMoveRule(rule.id, 'down')}
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

      {rules.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '48px', color: TavariStyles.colors.gray500 }}>
          No rules added yet. Add your first rule above.
        </div>
      )}
    </BaseKnowledgeModal>
  );
};

export default ImportantRulesModal;

