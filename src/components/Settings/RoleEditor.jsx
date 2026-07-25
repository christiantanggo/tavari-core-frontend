// src/components/Settings/RoleEditor.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import { X, Save } from 'lucide-react';

const RoleEditor = ({ businessId, role, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    role_name: '',
    role_key: '',
    description: '',
    color: '#008080',
    icon: '👤',
    is_system_role: false
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (role) {
      // Editing existing role
      setFormData({
        role_name: role.role_name || '',
        role_key: role.role_key || '',
        description: role.description || '',
        color: role.color || '#008080',
        icon: role.icon || '👤',
        is_system_role: role.is_system_role || false
      });
    }
  }, [role]);

  const validateForm = () => {
    const newErrors = {};

    if (!formData.role_name.trim()) {
      newErrors.role_name = 'Role name is required';
    }

    if (!formData.role_key.trim()) {
      newErrors.role_key = 'Role key is required';
    } else if (!/^[a-z0-9_-]+$/.test(formData.role_key)) {
      newErrors.role_key = 'Role key can only contain lowercase letters, numbers, hyphens, and underscores';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const generateRoleKey = (name) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  };

  const handleNameChange = (e) => {
    const name = e.target.value;
    setFormData({
      ...formData,
      role_name: name,
      // Auto-generate role_key if creating new role
      role_key: role ? formData.role_key : generateRoleKey(name)
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setSaving(true);

    try {
      if (role) {
        // Update existing role
        const { error } = await supabase
          .from('role_templates')
          .update({
            role_name: formData.role_name.trim(),
            description: formData.description.trim(),
            color: formData.color,
            icon: formData.icon,
            updated_at: new Date().toISOString()
          })
          .eq('id', role.id);

        if (error) throw error;

        toast.success('Role updated successfully!');
      } else {
        // Create new role
        // First check if role_key already exists
        const { data: existing } = await supabase
          .from('role_templates')
          .select('id')
          .eq('business_id', businessId)
          .eq('role_key', formData.role_key)
          .single();

        if (existing) {
          setErrors({ role_key: 'A role with this key already exists' });
          setSaving(false);
          return;
        }

        const { error } = await supabase
          .from('role_templates')
          .insert({
            business_id: businessId,
            role_name: formData.role_name.trim(),
            role_key: formData.role_key.trim(),
            description: formData.description.trim(),
            color: formData.color,
            icon: formData.icon,
            is_system_role: false,
            created_at: new Date().toISOString()
          });

        if (error) throw error;

        toast.success('Role created successfully!');
      }

      onSave();
    } catch (err) {
      console.error('Error saving role:', err);
      toast.error('Failed to save role');
    } finally {
      setSaving(false);
    }
  };

  const popularIcons = ['👤', '👔', '👨‍💼', '👩‍💼', '🛡️', '⚙️', '📊', '💼', '🔧', '👨‍🍳', '👨‍💻', '📱'];
  const popularColors = [
    '#008080', '#2563eb', '#7c3aed', '#dc2626', '#ea580c', 
    '#d97706', '#65a30d', '#059669', '#0891b2', '#6366f1'
  ];

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>
            {role ? 'Edit Role' : 'Create New Role'}
          </h3>
          <button onClick={onClose} style={styles.closeButton}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={styles.content}>
            {/* Role Name */}
            <div style={styles.formGroup}>
              <label style={styles.label}>
                Role Name *
              </label>
              <input
                type="text"
                value={formData.role_name}
                onChange={handleNameChange}
                style={{
                  ...styles.input,
                  ...(errors.role_name ? styles.inputError : {})
                }}
                placeholder="e.g., Kitchen Manager"
                disabled={formData.is_system_role}
              />
              {errors.role_name && (
                <div style={styles.errorText}>{errors.role_name}</div>
              )}
            </div>

            {/* Role Key */}
            <div style={styles.formGroup}>
              <label style={styles.label}>
                Role Key *
                <span style={styles.helpText}>
                  (Used internally - lowercase letters, numbers, hyphens, underscores only)
                </span>
              </label>
              <input
                type="text"
                value={formData.role_key}
                onChange={(e) => setFormData({ ...formData, role_key: e.target.value })}
                style={{
                  ...styles.input,
                  ...(errors.role_key ? styles.inputError : {})
                }}
                placeholder="e.g., kitchen_manager"
                disabled={role || formData.is_system_role}
              />
              {errors.role_key && (
                <div style={styles.errorText}>{errors.role_key}</div>
              )}
            </div>

            {/* Description */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                style={styles.textarea}
                placeholder="Brief description of this role's purpose and responsibilities"
                rows={3}
              />
            </div>

            {/* Icon Selection */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Icon</label>
              <div style={styles.iconGrid}>
                {popularIcons.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => setFormData({ ...formData, icon })}
                    style={{
                      ...styles.iconButton,
                      ...(formData.icon === icon ? styles.iconButtonActive : {})
                    }}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            {/* Color Selection */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Color</label>
              <div style={styles.colorGrid}>
                {popularColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setFormData({ ...formData, color })}
                    style={{
                      ...styles.colorButton,
                      backgroundColor: color,
                      ...(formData.color === color ? styles.colorButtonActive : {})
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Preview */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Preview</label>
              <div style={styles.preview}>
                <div 
                  style={{
                    ...styles.previewIcon,
                    backgroundColor: formData.color
                  }}
                >
                  {formData.icon}
                </div>
                <div>
                  <div style={styles.previewName}>
                    {formData.role_name || 'Role Name'}
                  </div>
                  <div style={styles.previewDescription}>
                    {formData.description || 'Role description will appear here'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={styles.footer}>
            <button
              type="button"
              onClick={onClose}
              style={styles.cancelButton}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={styles.saveButton}
            >
              <Save size={16} style={{ marginRight: '6px' }} />
              {saving ? 'Saving...' : role ? 'Update Role' : 'Create Role'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

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
    backgroundColor: 'white',
    borderRadius: '12px',
    maxWidth: '600px',
    width: '100%',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px',
    borderBottom: '1px solid #e5e7eb'
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  closeButton: {
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#6b7280',
    padding: '4px'
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px'
  },
  formGroup: {
    marginBottom: '20px'
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '8px'
  },
  helpText: {
    fontSize: '13px',
    fontWeight: 'normal',
    color: '#6b7280',
    marginLeft: '8px'
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box'
  },
  inputError: {
    borderColor: '#dc2626'
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'vertical',
    boxSizing: 'border-box'
  },
  errorText: {
    fontSize: '13px',
    color: '#dc2626',
    marginTop: '4px'
  },
  iconGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(50px, 1fr))',
    gap: '8px'
  },
  iconButton: {
    width: '50px',
    height: '50px',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    backgroundColor: '#f9fafb',
    fontSize: '24px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconButtonActive: {
    borderColor: '#008080',
    backgroundColor: '#e0f2f1',
    transform: 'scale(1.05)'
  },
  colorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))',
    gap: '8px'
  },
  colorButton: {
    width: '40px',
    height: '40px',
    border: '2px solid transparent',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  colorButtonActive: {
    border: '3px solid #1f2937',
    transform: 'scale(1.1)',
    boxShadow: '0 0 0 3px rgba(0, 0, 0, 0.1)'
  },
  preview: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '16px',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    border: '2px solid #e5e7eb'
  },
  previewIcon: {
    width: '48px',
    height: '48px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    flexShrink: 0
  },
  previewName: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '4px'
  },
  previewDescription: {
    fontSize: '13px',
    color: '#6b7280',
    lineHeight: '1.4'
  },
  footer: {
    display: 'flex',
    gap: '12px',
    padding: '20px 24px',
    borderTop: '1px solid #e5e7eb'
  },
  cancelButton: {
    flex: 1,
    padding: '12px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  saveButton: {
    flex: 1,
    padding: '12px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
};

export default RoleEditor;