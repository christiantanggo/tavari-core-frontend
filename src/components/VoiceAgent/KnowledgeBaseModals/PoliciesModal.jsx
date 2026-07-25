// components/VoiceAgent/KnowledgeBaseModals/PoliciesModal.jsx
// Modal for managing Policies (policy name + details)
import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, ArrowUp, ArrowDown, Save, X } from 'lucide-react';
import { TavariStyles } from '../../../utils/TavariStyles';
import toast from 'react-hot-toast';
import BaseKnowledgeModal from './BaseKnowledgeModal';

const PoliciesModal = ({ isOpen, onClose, businessId, voiceAgentService, onSave }) => {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [newPolicy, setNewPolicy] = useState({ policy_name: '', policy_details: '' });

  useEffect(() => {
    if (isOpen && businessId) {
      loadPolicies();
    }
  }, [isOpen, businessId]);

  const loadPolicies = async () => {
    setLoading(true);
    try {
      if (voiceAgentService?.getPolicies) {
        const loadedPolicies = await voiceAgentService.getPolicies(businessId);
        setPolicies(loadedPolicies || []);
      }
    } catch (error) {
      console.error('Error loading policies:', error);
      toast.error('Failed to load policies');
    } finally {
      setLoading(false);
    }
  };

  const handleAddPolicy = async () => {
    if (!newPolicy.policy_name.trim() || !newPolicy.policy_details.trim()) {
      toast.error('Please enter both policy name and details');
      return;
    }

    setSaving(true);
    try {
      const createdPolicy = await voiceAgentService.createPolicy(businessId, {
        policy_name: newPolicy.policy_name.trim(),
        policy_details: newPolicy.policy_details.trim(),
        is_active: true,
      });
      
      setPolicies([...policies, createdPolicy]);
      setNewPolicy({ policy_name: '', policy_details: '' });
      toast.success('Policy added successfully');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error adding policy:', error);
      toast.error('Failed to add policy: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePolicy = async (policyId, updates) => {
    setSaving(true);
    try {
      const updatedPolicy = await voiceAgentService.updatePolicy(policyId, updates);
      setPolicies(policies.map(policy => policy.id === policyId ? updatedPolicy : policy));
      setEditingPolicy(null);
      toast.success('Policy updated successfully');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error updating policy:', error);
      toast.error('Failed to update policy: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePolicy = async (policyId) => {
    if (!confirm('Are you sure you want to delete this policy?')) return;
    
    setSaving(true);
    try {
      await voiceAgentService.deletePolicy(policyId);
      setPolicies(policies.filter(policy => policy.id !== policyId));
      toast.success('Policy deleted successfully');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error deleting policy:', error);
      toast.error('Failed to delete policy: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleMovePolicy = async (policyId, direction) => {
    const index = policies.findIndex(p => p.id === policyId);
    if (index === -1) return;
    
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= policies.length) return;
    
    setSaving(true);
    try {
      const currentOrder = policies[index].display_order || index;
      const targetOrder = policies[newIndex].display_order || newIndex;
      
      await voiceAgentService.updatePolicy(policies[index].id, { display_order: targetOrder });
      await voiceAgentService.updatePolicy(policies[newIndex].id, { display_order: currentOrder });
      
      const reloadedPolicies = await voiceAgentService.getPolicies(businessId);
      setPolicies(reloadedPolicies || []);
      toast.success('Policy order updated');
      
      if (onSave) onSave();
    } catch (error) {
      console.error('Error moving policy:', error);
      toast.error('Failed to move policy');
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
    policyItem: {
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      marginBottom: TavariStyles.spacing.sm,
    },
    policyActions: {
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
    newPolicySection: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `2px dashed ${TavariStyles.colors.gray300}`,
      marginBottom: TavariStyles.spacing.lg,
    },
  };

  if (loading) {
    return (
      <BaseKnowledgeModal isOpen={isOpen} onClose={onClose} title="Policies">
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <div>Loading policies...</div>
        </div>
      </BaseKnowledgeModal>
    );
  }

  return (
    <BaseKnowledgeModal isOpen={isOpen} onClose={onClose} title="Policies" width="900px">
      {/* Add New Policy Section - At Top */}
      <div style={styles.newPolicySection}>
        <h3 style={styles.sectionTitle}>Add New Policy</h3>
        <div style={styles.formGroup}>
          <label style={styles.label}>Policy Name *</label>
          <input
            type="text"
            value={newPolicy.policy_name}
            onChange={(e) => setNewPolicy({ ...newPolicy, policy_name: e.target.value })}
            placeholder="e.g., Refund Policy, Max Booking Policy"
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Policy Details *</label>
          <textarea
            value={newPolicy.policy_details}
            onChange={(e) => setNewPolicy({ ...newPolicy, policy_details: e.target.value })}
            placeholder="Detailed description of the policy..."
            style={styles.textarea}
          />
        </div>
        <button
          onClick={handleAddPolicy}
          disabled={saving}
          style={{
            ...styles.buttonSmall,
            backgroundColor: '#10b981',
            color: 'white',
            padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
          }}
        >
          <Plus size={16} />
          Add Policy
        </button>
      </div>

      {/* Existing Policies */}
      {policies.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Existing Policies ({policies.length})</h3>
          {policies.map((policy, index) => (
            <div key={policy.id} style={styles.policyItem}>
              {editingPolicy?.id === policy.id ? (
                <div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Policy Name</label>
                    <input
                      type="text"
                      value={editingPolicy.policy_name}
                      onChange={(e) => setEditingPolicy({ ...editingPolicy, policy_name: e.target.value })}
                      style={styles.input}
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Policy Details</label>
                    <textarea
                      value={editingPolicy.policy_details}
                      onChange={(e) => setEditingPolicy({ ...editingPolicy, policy_details: e.target.value })}
                      style={styles.textarea}
                    />
                  </div>
                  <div style={styles.policyActions}>
                    <button
                      onClick={() => handleUpdatePolicy(policy.id, editingPolicy)}
                      style={{ ...styles.buttonSmall, backgroundColor: '#10b981', color: 'white' }}
                    >
                      <Save size={14} />
                      Save
                    </button>
                    <button
                      onClick={() => setEditingPolicy(null)}
                      style={{ ...styles.buttonSmall, backgroundColor: '#6b7280', color: 'white' }}
                    >
                      <X size={14} />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{policy.policy_name}</div>
                  <div style={{ color: TavariStyles.colors.gray600, whiteSpace: 'pre-wrap' }}>
                    {policy.policy_details}
                  </div>
                  <div style={styles.policyActions}>
                    <button
                      onClick={() => setEditingPolicy({ ...policy })}
                      style={{ ...styles.buttonSmall, backgroundColor: '#3b82f6', color: 'white' }}
                    >
                      <Edit2 size={14} />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeletePolicy(policy.id)}
                      style={{ ...styles.buttonSmall, backgroundColor: '#ef4444', color: 'white' }}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                    {index > 0 && (
                      <button
                        onClick={() => handleMovePolicy(policy.id, 'up')}
                        style={{ ...styles.buttonSmall, backgroundColor: '#6b7280', color: 'white' }}
                        title="Move up"
                      >
                        <ArrowUp size={14} />
                      </button>
                    )}
                    {index < policies.length - 1 && (
                      <button
                        onClick={() => handleMovePolicy(policy.id, 'down')}
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

      {policies.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '48px', color: TavariStyles.colors.gray500 }}>
          No policies added yet. Add your first policy above.
        </div>
      )}
    </BaseKnowledgeModal>
  );
};

export default PoliciesModal;

