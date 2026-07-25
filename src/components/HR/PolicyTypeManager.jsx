// components/HR/PolicyTypeManager.jsx
import React, { useState, useEffect } from 'react';
import { X, Plus, Edit2, Trash2, Save } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';

const PolicyTypeManager = ({ isOpen, onClose, businessId, onTypesUpdated }) => {
  const [policyTypes, setPolicyTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [formData, setFormData] = useState({
    type_name: '',
    display_order: 0
  });

  useEffect(() => {
    if (isOpen && businessId) {
      loadPolicyTypes();
    }
  }, [isOpen, businessId]);

  const loadPolicyTypes = async () => {
    setLoading(true);
    try {
      // First, ensure default types exist
      const { error: initError } = await supabase.rpc('initialize_default_policy_types', {
        business_uuid: businessId
      });

      if (initError) {
        console.error('Error initializing default types:', initError);
      }

      // Load all policy types
      const { data, error } = await supabase
        .from('hr_policy_types')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .order('type_number', { ascending: true });

      if (error) throw error;
      setPolicyTypes(data || []);
    } catch (error) {
      console.error('Error loading policy types:', error);
      toast.error('Failed to load policy types');
    } finally {
      setLoading(false);
    }
  };

  const handleAddType = async () => {
    if (!formData.type_name.trim()) {
      toast.error('Policy type name is required');
      return;
    }

    try {
      // Get next available type number
      const { data: nextNumber, error: numberError } = await supabase.rpc('get_next_policy_type_number', {
        business_uuid: businessId
      });

      if (numberError) throw numberError;

      const displayName = `${nextNumber}-${formData.type_name.trim()}`;

      const { data, error } = await supabase
        .from('hr_policy_types')
        .insert({
          business_id: businessId,
          type_number: nextNumber,
          type_name: formData.type_name.trim(),
          display_name: displayName,
          is_default: false,
          is_active: true,
          display_order: formData.display_order || policyTypes.length + 1,
          created_by: (await supabase.auth.getUser()).data.user?.id
        })
        .select()
        .single();

      if (error) throw error;

      toast.success('Policy type added successfully');
      setShowAddModal(false);
      setFormData({ type_name: '', display_order: 0 });
      await loadPolicyTypes();
      if (onTypesUpdated) onTypesUpdated();
    } catch (error) {
      console.error('Error adding policy type:', error);
      toast.error('Failed to add policy type: ' + (error.message || 'Unknown error'));
    }
  };

  const handleEditType = async () => {
    if (!formData.type_name.trim()) {
      toast.error('Policy type name is required');
      return;
    }

    try {
      const displayName = `${editingType.type_number}-${formData.type_name.trim()}`;

      const { error } = await supabase
        .from('hr_policy_types')
        .update({
          type_name: formData.type_name.trim(),
          display_name: displayName,
          display_order: formData.display_order || editingType.display_order,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingType.id);

      if (error) throw error;

      toast.success('Policy type updated successfully');
      setEditingType(null);
      setFormData({ type_name: '', display_order: 0 });
      await loadPolicyTypes();
      if (onTypesUpdated) onTypesUpdated();
    } catch (error) {
      console.error('Error updating policy type:', error);
      toast.error('Failed to update policy type: ' + (error.message || 'Unknown error'));
    }
  };

  const handleDeleteType = async (type) => {
    if (type.is_default) {
      toast.error('Cannot delete default policy types');
      return;
    }

    if (!confirm(`Are you sure you want to delete "${type.display_name}"? This cannot be undone.`)) {
      return;
    }

    try {
      // Check if any policies use this type
      const { data: policies, error: checkError } = await supabase
        .from('hr_policies')
        .select('id')
        .eq('business_id', businessId)
        .eq('policy_type', type.display_name)
        .limit(1);

      if (checkError) throw checkError;

      if (policies && policies.length > 0) {
        toast.error('Cannot delete policy type that is in use. Please reassign or delete policies first.');
        return;
      }

      const { error } = await supabase
        .from('hr_policy_types')
        .delete()
        .eq('id', type.id);

      if (error) throw error;

      toast.success('Policy type deleted successfully');
      await loadPolicyTypes();
      if (onTypesUpdated) onTypesUpdated();
    } catch (error) {
      console.error('Error deleting policy type:', error);
      toast.error('Failed to delete policy type: ' + (error.message || 'Unknown error'));
    }
  };

  const openEditModal = (type) => {
    setEditingType(type);
    setFormData({
      type_name: type.type_name,
      display_order: type.display_order || 0
    });
    setShowAddModal(true);
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingType(null);
    setFormData({ type_name: '', display_order: 0 });
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
    typeItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '16px',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      marginBottom: '12px',
      backgroundColor: '#f9fafb'
    },
    typeInfo: {
      flex: 1
    },
    typeName: {
      fontSize: '16px',
      fontWeight: '600',
      color: '#111827',
      marginBottom: '4px'
    },
    typeNumber: {
      fontSize: '14px',
      color: '#6b7280'
    },
    typeActions: {
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
    }
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Manage Policy Types</h2>
          <button onClick={onClose} style={styles.closeButton}>
            <X size={24} />
          </button>
        </div>

        <div style={styles.content}>
          <button onClick={() => setShowAddModal(true)} style={styles.addButton}>
            <Plus size={18} />
            Add Custom Policy Type
          </button>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <div style={{ fontSize: '16px', color: '#6b7280' }}>Loading policy types...</div>
            </div>
          ) : policyTypes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <div style={{ fontSize: '16px', color: '#6b7280' }}>No policy types found</div>
            </div>
          ) : (
            policyTypes.map((type) => (
              <div key={type.id} style={styles.typeItem}>
                <div style={styles.typeInfo}>
                  <div style={styles.typeName}>{type.display_name}</div>
                  <div style={styles.typeNumber}>
                    Type Number: {type.type_number} {type.is_default && '(Default)'}
                  </div>
                </div>
                <div style={styles.typeActions}>
                  {!type.is_default && (
                    <>
                      <button
                        onClick={() => openEditModal(type)}
                        style={{ ...styles.actionButton, ...styles.editButton }}
                      >
                        <Edit2 size={16} />
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteType(type)}
                        style={{ ...styles.actionButton, ...styles.deleteButton }}
                      >
                        <Trash2 size={16} />
                        Delete
                      </button>
                    </>
                  )}
                  {type.is_default && (
                    <span style={{ fontSize: '13px', color: '#6b7280', fontStyle: 'italic' }}>
                      Default (cannot edit)
                    </span>
                  )}
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
                {editingType ? 'Edit Policy Type' : 'Add New Policy Type'}
              </h3>

              <div style={styles.formGroup}>
                <label style={styles.label}>Policy Type Name *</label>
                <input
                  type="text"
                  value={formData.type_name}
                  onChange={(e) => setFormData({ ...formData, type_name: e.target.value })}
                  style={styles.input}
                  placeholder="e.g., Safety Policy, Training Policy"
                />
                <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                  {editingType 
                    ? `This will be displayed as: ${editingType.type_number}-${formData.type_name || '[name]'}`
                    : 'The system will automatically assign the next available number'}
                </div>
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
                  onClick={editingType ? handleEditType : handleAddType}
                  style={styles.saveButton}
                >
                  <Save size={18} />
                  {editingType ? 'Update' : 'Add'} Policy Type
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PolicyTypeManager;



