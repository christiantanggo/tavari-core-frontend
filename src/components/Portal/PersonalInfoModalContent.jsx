// PersonalInfoModalContent.jsx - Personal info form for modal
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { getPublicUserId } from '../../utils/getPublicUserId';

const PersonalInfoModalContent = ({ userData, onComplete }) => {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    sin: '',
    birthDate: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    province: '',
    postalCode: '',
    phone: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sinError, setSinError] = useState('');
  const sinFieldGroupRef = useRef(null);

  useEffect(() => {
    if (userData) {
      setFormData({
        firstName: userData.first_name || '',
        lastName: userData.last_name || '',
        email: userData.email || '',
        sin: '', // SIN is not pre-filled for security (encrypted in separate table)
        birthDate: userData.birth_date || '',
        addressLine1: userData.address_line1 || userData.address || '',
        addressLine2: userData.address_line2 || '',
        city: userData.address_city || '',
        province: userData.address_state || userData.province || '',
        postalCode: userData.address_postal_code || userData.postal_code || '',
        phone: userData.phone || '',
        emergencyContactName: userData.emergency_contact_name || '',
        emergencyContactPhone: userData.emergency_contact_phone || '',
        emergencyContactRelationship: userData.emergency_contact_relationship || ''
      });
    }
  }, [userData]);

  useEffect(() => {
    if (!sinError || !sinFieldGroupRef.current) return;
    sinFieldGroupRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [sinError]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (name === 'sin') setSinError('');
    setError('');
  };

  const validateForm = () => {
    if (!formData.firstName.trim()) {
      setError('First name is required');
      return false;
    }
    if (!formData.lastName.trim()) {
      setError('Last name is required');
      return false;
    }
    if (!formData.birthDate) {
      setError('Birth date is required');
      return false;
    }
    if (!formData.addressLine1.trim()) {
      setError('Address is required');
      return false;
    }
    if (!formData.emergencyContactName.trim()) {
      setError('Emergency contact name is required');
      return false;
    }
    if (!formData.emergencyContactPhone.trim()) {
      setError('Emergency contact phone is required');
      return false;
    }
    return true;
  };

  // Validate SIN using Luhn algorithm
  const validateSIN = (sinValue) => {
    if (!sinValue || !sinValue.trim()) {
      return { isValid: true, message: '' }; // SIN is optional
    }
    
    const numbers = sinValue.replace(/\D/g, '');
    if (numbers.length !== 9) {
      return { isValid: false, message: 'SIN must be exactly 9 digits' };
    }
    
    // Luhn algorithm validation
    const digits = numbers.split('').map(d => parseInt(d));
    let sum = 0;
    
    for (let i = 0; i < 8; i++) {
      let digit = digits[i];
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) {
          digit = Math.floor(digit / 10) + (digit % 10);
        }
      }
      sum += digit;
    }
    
    const checkDigit = (10 - (sum % 10)) % 10;
    if (checkDigit !== digits[8]) {
      return { isValid: false, message: 'Invalid SIN number (failed check digit validation)' };
    }
    
    return { isValid: true, message: '' };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSinError('');

    if (!validateForm()) {
      return;
    }

    // Validate SIN if provided
    if (formData.sin && formData.sin.trim()) {
      const sinValidation = validateSIN(formData.sin);
      if (!sinValidation.isValid) {
        setSinError(sinValidation.message);
        return;
      }
    }

    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Session expired');
      }

      // Get public.users.id (business_users references public.users.id, not auth.users.id)
      const publicUserId = await getPublicUserId(session.user.email);
      if (!publicUserId) {
        throw new Error('User profile not found');
      }

      // Get business_id for SIN encryption
      const { data: businessUsers } = await supabase
        .from('business_users')
        .select('business_id')
        .eq('user_id', publicUserId)
        .limit(1);

      if (!businessUsers || businessUsers.length === 0) {
        throw new Error('Unable to retrieve business information');
      }

      const businessId = businessUsers[0].business_id;

      // Update user profile (without SIN)
      const { error: updateError } = await supabase
        .from('users')
        .update({
          first_name: formData.firstName.trim(),
          last_name: formData.lastName.trim(),
          birth_date: formData.birthDate,
          address_line1: formData.addressLine1.trim(),
          address_line2: formData.addressLine2.trim() || null,
          address_city: formData.city.trim(),
          address_state: formData.province.trim(),
          address_postal_code: formData.postalCode.trim(),
          phone: formData.phone.trim() || null,
          emergency_contact_name: formData.emergencyContactName.trim(),
          emergency_contact_phone: formData.emergencyContactPhone.trim(),
          emergency_contact_relationship: formData.emergencyContactRelationship.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', publicUserId);

      if (updateError) throw updateError;

      // Handle SIN separately - encrypt and save to employee_sin_numbers table
      if (formData.sin && formData.sin.trim()) {
        const cleanSIN = formData.sin.replace(/\D/g, '');
        
        // Encrypt SIN using RPC function
        const { data: encryptedData, error: encryptError } = await supabase.rpc('encrypt_sin', {
          sin_text: cleanSIN,
          business_id: businessId
        });

        if (encryptError) {
          setSinError(encryptError.message || 'Could not save SIN. Please check the number and try again.');
          setSubmitting(false);
          return;
        }
        if (!encryptedData) {
          setSinError('SIN encryption failed. Please try again.');
          setSubmitting(false);
          return;
        }

        // Check if SIN record already exists
        const { data: existingSinRecord } = await supabase
          .from('employee_sin_numbers')
          .select('id')
          .eq('employee_id', publicUserId)
          .maybeSingle();

        if (existingSinRecord) {
          // Update existing record
          const { error: sinUpdateError } = await supabase
            .from('employee_sin_numbers')
            .update({
              sin_number_encrypted: encryptedData,
              updated_by: publicUserId,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingSinRecord.id);

          if (sinUpdateError) {
            setSinError(sinUpdateError.message || 'Could not update SIN. Please try again.');
            setSubmitting(false);
            return;
          }
        } else {
          // Create new record
          const { error: sinInsertError } = await supabase
            .from('employee_sin_numbers')
            .insert({
              employee_id: publicUserId,
              sin_number_encrypted: encryptedData,
              created_by: publicUserId,
              updated_by: publicUserId
            });

          if (sinInsertError) {
            setSinError(sinInsertError.message || 'Could not save SIN. Please try again.');
            setSubmitting(false);
            return;
          }
        }
      }

      toast.success('Personal information saved!');
      onComplete();
    } catch (err) {
      console.error('Error saving personal information:', err);
      const msg = err.message || 'Failed to save information';
      const lower = msg.toLowerCase();
      const sinScoped =
        lower.includes('sin') ||
        lower.includes('encrypt') ||
        lower.includes('employee_sin') ||
        lower.includes('pgsodium') ||
        lower.includes('crypto');
      if (sinScoped) {
        setSinError(msg);
        setError('');
      } else {
        setError(msg);
        setSinError('');
      }
      setSubmitting(false);
    }
  };

  const styles = {
    header: {
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    title: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      margin: 0
    },
    message: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray700,
      backgroundColor: TavariStyles.colors.primary + '15',
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `1px solid ${TavariStyles.colors.primary}40`,
      marginTop: TavariStyles.spacing.sm
    },
    closeButton: {
      position: 'absolute',
      top: TavariStyles.spacing.md,
      right: TavariStyles.spacing.md,
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: TavariStyles.colors.gray600,
      padding: TavariStyles.spacing.xs,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    body: {
      padding: TavariStyles.spacing.xl
    },
    section: {
      marginBottom: TavariStyles.spacing.xl
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.md
    },
    twoColumns: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: TavariStyles.spacing.md
    },
    inputGroup: {
      marginBottom: TavariStyles.spacing.md
    },
    label: {
      display: 'block',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs
    },
    input: {
      width: '90%',
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base
    },
    error: {
      color: TavariStyles.colors.danger,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginBottom: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.sm,
      backgroundColor: '#fee2e2',
      borderRadius: TavariStyles.borderRadius?.md || '8px'
    },
    fieldError: {
      color: TavariStyles.colors.danger,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginTop: TavariStyles.spacing.xs,
      padding: TavariStyles.spacing.sm,
      backgroundColor: '#fee2e2',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      lineHeight: 1.4
    },
    footer: {
      padding: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'flex-end'
    },
    button: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    }
  };

  return (
    <>
      <div style={{ ...styles.header, position: 'relative' }}>
        <h2 style={styles.title}>Complete Your Personal Information</h2>
        <div style={styles.message}>
          <strong>Action Required:</strong> Please fill out your personal information below. This information is required to complete your employee profile. All fields marked with * are required.
        </div>
        {/* Note: Close button removed - information must be completed before proceeding */}
      </div>
      <form onSubmit={handleSubmit}>
        <div style={styles.body}>
          {error && <div style={styles.error}>{error}</div>}

          {/* Personal Information */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Personal Information</h3>
            <div style={styles.twoColumns}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>First Name *</label>
                <input
                  name="firstName"
                  type="text"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  required
                  disabled={submitting}
                  style={styles.input}
                />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Last Name *</label>
                <input
                  name="lastName"
                  type="text"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  required
                  disabled={submitting}
                  style={styles.input}
                />
              </div>
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Email</label>
              <input
                name="email"
                type="email"
                value={formData.email}
                disabled
                style={{ ...styles.input, backgroundColor: TavariStyles.colors.gray100 }}
              />
            </div>
            <div style={styles.twoColumns}>
              <div ref={sinFieldGroupRef} style={styles.inputGroup}>
                <label style={styles.label}>SIN Number</label>
                <input
                  name="sin"
                  type="text"
                  value={formData.sin}
                  onChange={handleInputChange}
                  placeholder="123 456 789"
                  disabled={submitting}
                  style={styles.input}
                />
                <span style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginTop: '4px' }}>
                  Will be encrypted and stored securely
                </span>
                {sinError ? (
                  <div role="alert" style={styles.fieldError}>
                    {sinError}
                  </div>
                ) : null}
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Birth Date *</label>
                <input
                  name="birthDate"
                  type="date"
                  value={formData.birthDate}
                  onChange={handleInputChange}
                  required
                  disabled={submitting}
                  style={styles.input}
                />
              </div>
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Phone Number</label>
              <input
                name="phone"
                type="tel"
                value={formData.phone}
                onChange={handleInputChange}
                disabled={submitting}
                style={styles.input}
              />
            </div>
          </div>

          {/* Address */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Address</h3>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Address Line 1 *</label>
              <input
                name="addressLine1"
                type="text"
                value={formData.addressLine1}
                onChange={handleInputChange}
                required
                disabled={submitting}
                style={styles.input}
              />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Address Line 2</label>
              <input
                name="addressLine2"
                type="text"
                value={formData.addressLine2}
                onChange={handleInputChange}
                disabled={submitting}
                style={styles.input}
              />
            </div>
            <div style={styles.twoColumns}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>City</label>
                <input
                  name="city"
                  type="text"
                  value={formData.city}
                  onChange={handleInputChange}
                  disabled={submitting}
                  style={styles.input}
                />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Province/State</label>
                <input
                  name="province"
                  type="text"
                  value={formData.province}
                  onChange={handleInputChange}
                  disabled={submitting}
                  style={styles.input}
                />
              </div>
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Postal Code</label>
              <input
                name="postalCode"
                type="text"
                value={formData.postalCode}
                onChange={handleInputChange}
                disabled={submitting}
                style={styles.input}
              />
            </div>
          </div>

          {/* Emergency Contact */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Emergency Contact</h3>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Contact Name *</label>
              <input
                name="emergencyContactName"
                type="text"
                value={formData.emergencyContactName}
                onChange={handleInputChange}
                required
                disabled={submitting}
                style={styles.input}
              />
            </div>
            <div style={styles.twoColumns}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Contact Phone *</label>
                <input
                  name="emergencyContactPhone"
                  type="tel"
                  value={formData.emergencyContactPhone}
                  onChange={handleInputChange}
                  required
                  disabled={submitting}
                  style={styles.input}
                />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Relationship</label>
                <input
                  name="emergencyContactRelationship"
                  type="text"
                  value={formData.emergencyContactRelationship}
                  onChange={handleInputChange}
                  disabled={submitting}
                  style={styles.input}
                />
              </div>
            </div>
          </div>
        </div>
        <div style={styles.footer}>
          <button
            type="submit"
            disabled={submitting}
            style={styles.button}
          >
            {submitting ? 'Saving...' : 'Save & Continue'}
          </button>
        </div>
      </form>
    </>
  );
};

export default PersonalInfoModalContent;

