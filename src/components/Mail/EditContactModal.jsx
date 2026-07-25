// components/Mail/EditContactModal.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { FiX, FiUser, FiMail, FiPhone, FiTag, FiSave, FiUserCheck, FiUserX, FiTrash2 } from 'react-icons/fi';
import { logConsentAction, syncResubscribeState } from '../../helpers/Mail/subscriptionSync';

const EditContactModal = ({ isOpen, onClose, onContactUpdated, onContactDeleted, contactId, businessId }) => {
  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    tags: '',
    subscribed: true
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (isOpen && contactId) {
      loadContact();
    }
  }, [isOpen, contactId]);

  const loadContact = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('mail_contacts')
        .select('*')
        .eq('id', contactId)
        .single();

      if (error) throw error;

      setContact(data);
      setFormData({
        first_name: data.first_name || '',
        last_name: data.last_name || '',
        email: data.email || '',
        phone: data.phone || '',
        tags: (data.tags || []).join(', '),
        subscribed: data.subscribed
      });
      setErrors({});
    } catch (error) {
      console.error('Error loading contact:', error);
      setErrors({ load: 'Failed to load contact details.' });
    } finally {
      setLoading(false);
    }
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    if (!formData.first_name) {
      newErrors.first_name = 'First name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setSaving(true);
    try {
      // Clean phone number
      const cleanPhone = formData.phone ? formData.phone.replace(/\D/g, '') : '';
      const formattedPhone = cleanPhone.length >= 10 ? 
        (cleanPhone.length === 10 ? 
          `(${cleanPhone.slice(0,3)}) ${cleanPhone.slice(3,6)}-${cleanPhone.slice(6)}` :
          `+1 (${cleanPhone.slice(1,4)}) ${cleanPhone.slice(4,7)}-${cleanPhone.slice(7,11)}`
        ) : formData.phone;

      // Parse tags
      const tags = formData.tags ? 
        formData.tags.split(',').map(tag => tag.trim()).filter(tag => tag) : 
        [];

      const updates = {
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        email: formData.email.toLowerCase().trim(),
        phone: formattedPhone,
        tags,
        subscribed: formData.subscribed,
        updated_at: new Date().toISOString()
      };

      // Handle subscription status change
      if (formData.subscribed !== contact.subscribed) {
        if (formData.subscribed) {
          updates.unsubscribed_at = null;
        } else {
          updates.unsubscribed_at = new Date().toISOString();
        }
      }

      const { error } = await supabase
        .from('mail_contacts')
        .update(updates)
        .eq('id', contactId);

      if (error) {
        // Handle duplicate email error
        if (error.code === '23505' && error.message.includes('mail_contacts_business_id_email_key')) {
          setErrors({ email: 'This email address already exists in your contacts.' });
          return;
        }
        throw error;
      }

      if (formData.subscribed !== contact.subscribed) {
        if (formData.subscribed) {
          await syncResubscribeState({
            businessId,
            contactId,
            emailAddress: updates.email,
            source: 'edit_contact_modal'
          });
        } else {
          await logConsentAction({
            businessId,
            contactId,
            emailAddress: updates.email,
            action: 'unsubscribe',
            source: 'edit_contact_modal'
          });
        }
      }

      // Log audit event
      try {
        await supabase.from('audit_logs').insert({
          business_id: businessId,
          action: 'update_contact',
          details: { 
            contact_id: contactId,
            changes: Object.keys(updates)
          },
          created_at: new Date().toISOString()
        });
      } catch (auditError) {
        console.warn('Audit log failed (non-critical):', auditError);
      }

      if (onContactUpdated) {
        onContactUpdated();
      }

      onClose();
    } catch (error) {
      console.error('Error updating contact:', error);
      setErrors({ submit: 'Failed to update contact. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const confirmMessage = `Delete contact "${contact?.first_name} ${contact?.last_name}" permanently?`;
    if (!window.confirm(confirmMessage)) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('mail_contacts')
        .delete()
        .eq('id', contactId);

      if (error) throw error;

      // Log audit event
      try {
        await supabase.from('audit_logs').insert({
          business_id: businessId,
          action: 'delete_contact',
          details: { 
            contact_id: contactId,
            email: contact.email,
            name: `${contact.first_name} ${contact.last_name}`
          },
          created_at: new Date().toISOString()
        });
      } catch (auditError) {
        console.warn('Audit log failed (non-critical):', auditError);
      }

      if (onContactDeleted) {
        onContactDeleted();
      }

      onClose();
    } catch (error) {
      console.error('Error deleting contact:', error);
      setErrors({ submit: 'Failed to delete contact. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const handleSubscriptionToggle = () => {
    setFormData(prev => ({ ...prev, subscribed: !prev.subscribed }));
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            {loading ? 'Loading...' : `Edit Contact`}
          </h2>
          <button style={styles.closeButton} onClick={onClose}>
            <FiX />
          </button>
        </div>

        {loading ? (
          <div style={styles.loading}>
            <div style={styles.spinner}></div>
            <p>Loading contact details...</p>
          </div>
        ) : (
          <div style={styles.content}>
            {errors.load && (
              <div style={styles.errorMessage}>
                {errors.load}
              </div>
            )}

            {contact && (
              <>
                {/* Contact Info Header */}
                <div style={styles.contactHeader}>
                  <div style={styles.contactInfo}>
                    <h3 style={styles.contactName}>
                      {contact.first_name} {contact.last_name}
                    </h3>
                    <div style={styles.contactMeta}>
                      <span style={styles.metaItem}>
                        Added: {formatDate(contact.created_at)}
                      </span>
                      <span style={styles.metaItem}>
                        Source: {contact.source}
                      </span>
                    </div>
                  </div>
                  <button 
                    style={{
                      ...styles.statusButton,
                      ...(formData.subscribed ? styles.subscribedButton : styles.unsubscribedButton)
                    }}
                    onClick={handleSubscriptionToggle}
                  >
                    {formData.subscribed ? <FiUserCheck /> : <FiUserX />}
                    {formData.subscribed ? 'Subscribed' : 'Unsubscribed'}
                  </button>
                </div>

                {/* Edit Form */}
                <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} style={styles.form}>
                  <div style={styles.formRow}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>
                        <FiUser style={styles.labelIcon} />
                        First Name *
                      </label>
                      <input
                        type="text"
                        style={{
                          ...styles.input,
                          ...(errors.first_name ? styles.inputError : {})
                        }}
                        value={formData.first_name}
                        onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                      />
                      {errors.first_name && <span style={styles.errorText}>{errors.first_name}</span>}
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>
                        <FiUser style={styles.labelIcon} />
                        Last Name
                      </label>
                      <input
                        type="text"
                        style={styles.input}
                        value={formData.last_name}
                        onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>
                      <FiMail style={styles.labelIcon} />
                      Email Address *
                    </label>
                    <input
                      type="email"
                      style={{
                        ...styles.input,
                        ...(errors.email ? styles.inputError : {})
                      }}
                      value={formData.email}
                      onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    />
                    {errors.email && <span style={styles.errorText}>{errors.email}</span>}
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>
                      <FiPhone style={styles.labelIcon} />
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      style={styles.input}
                      value={formData.phone}
                      onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                    />
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>
                      <FiTag style={styles.labelIcon} />
                      Tags (comma-separated)
                    </label>
                    <input
                      type="text"
                      style={styles.input}
                      value={formData.tags}
                      onChange={(e) => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                      placeholder="customer, birthday-party, vip"
                    />
                    <span style={styles.helpText}>
                      Use tags to organize contacts
                    </span>
                  </div>

                  {errors.submit && (
                    <div style={styles.errorMessage}>
                      {errors.submit}
                    </div>
                  )}

                  <div style={styles.formActions}>
                    <div style={styles.leftActions}>
                      <button 
                        type="button"
                        style={styles.deleteButton}
                        onClick={handleDelete}
                        disabled={saving}
                      >
                        <FiTrash2 style={styles.buttonIcon} />
                        Delete Contact
                      </button>
                    </div>
                    <div style={styles.rightActions}>
                      <button 
                        type="button" 
                        style={styles.cancelButton}
                        onClick={onClose}
                        disabled={saving}
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit" 
                        style={styles.submitButton}
                        disabled={saving}
                      >
                        <FiSave style={styles.buttonIcon} />
                        {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                </form>
              </>
            )}
          </div>
        )}
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
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '8px',
    width: '90%',
    maxWidth: '700px',
    maxHeight: '90vh',
    overflow: 'auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 20px 0 20px',
    borderBottom: '1px solid #f0f0f0',
    marginBottom: '20px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0,
  },
  closeButton: {
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    color: '#666',
    padding: '5px',
  },
  loading: {
    textAlign: 'center',
    padding: '40px 20px',
  },
  spinner: {
    width: '30px',
    height: '30px',
    border: '3px solid #f0f0f0',
    borderTop: '3px solid teal',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 15px auto',
  },
  content: {
    padding: '0 20px 20px 20px',
  },
  contactHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '25px',
    padding: '15px',
    backgroundColor: '#f8f8f8',
    borderRadius: '8px',
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
  },
  contactMeta: {
    display: 'flex',
    gap: '15px',
    flexWrap: 'wrap',
  },
  metaItem: {
    fontSize: '14px',
    color: '#666',
  },
  statusButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    borderRadius: '20px',
    fontSize: '14px',
    fontWeight: 'bold',
    border: 'none',
    cursor: 'pointer',
  },
  subscribedButton: {
    backgroundColor: '#e8f5e8',
    color: '#2e7d32',
  },
  unsubscribedButton: {
    backgroundColor: '#ffebee',
    color: '#c62828',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '15px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
  },
  labelIcon: {
    fontSize: '16px',
    color: 'teal',
  },
  input: {
    padding: '12px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '8px',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s ease',
  },
  inputError: {
    borderColor: '#f44336',
  },
  helpText: {
    fontSize: '12px',
    color: '#666',
    marginTop: '5px',
  },
  errorText: {
    fontSize: '12px',
    color: '#f44336',
    marginTop: '5px',
  },
  errorMessage: {
    backgroundColor: '#ffebee',
    color: '#c62828',
    padding: '12px',
    borderRadius: '6px',
    fontSize: '14px',
  },
  formActions: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: '20px',
    borderTop: '1px solid #f0f0f0',
  },
  leftActions: {
    display: 'flex',
  },
  rightActions: {
    display: 'flex',
    gap: '12px',
  },
  deleteButton: {
    backgroundColor: '#f44336',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  cancelButton: {
    backgroundColor: 'white',
    color: '#666',
    border: '2px solid #ddd',
    borderRadius: '8px',
    padding: '10px 18px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  submitButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  buttonIcon: {
    fontSize: '14px',
  },
};

// Add spinner animation if not already present
if (!document.querySelector('#edit-contact-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'edit-contact-styles';
  styleSheet.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleSheet);
}

export default EditContactModal;