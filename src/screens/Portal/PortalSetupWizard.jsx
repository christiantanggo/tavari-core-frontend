// PortalSetupWizard.jsx - Setup wizard for authenticated users to complete personal information
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { AlertCircle, Loader, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { hashValue } from '../../helpers/crypto';
import DateDropdownInput, { getDateYearsAgoLocal, getLocalIsoDate } from '../../components/UI/DateDropdownInput';
import { getPublicUserId } from '../../utils/getPublicUserId';

const PortalSetupWizard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [userData, setUserData] = useState(null);
  
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
    emergencyContactRelationship: '',
    password: '',
    confirmPassword: '',
    pin: ''
  });
  
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [changePassword, setChangePassword] = useState(false);

  useEffect(() => {
    checkSetupNeeded();
  }, []);

  const checkSetupNeeded = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate('/portal/login', { replace: true });
        return;
      }

      const publicUserId = await getPublicUserId(session.user.email);
      if (!publicUserId) {
        console.error('[PortalSetupWizard] No public.users row for email');
        setError('Your profile could not be loaded. Please sign out and sign in again, or contact HR.');
        setLoading(false);
        return;
      }

      // Load user data (public.users.id often differs from auth.users.id)
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', publicUserId)
        .single();

      if (userError) {
        console.error('Error loading user data:', userError);
        setError('Failed to load user data. Please try again.');
        setLoading(false);
        return;
      }

      if (!user) {
        setError('User not found. Please contact HR.');
        setLoading(false);
        return;
      }

      setUserData(user);

      // Check if personal info is complete
      const isComplete = 
        (user.sin_number || user.sin) &&
        user.birth_date &&
        (user.address_line1 || user.address) &&
        user.emergency_contact_name &&
        user.emergency_contact_phone;

      if (isComplete) {
        // Already complete - redirect to portal
        navigate('/portal', { replace: true });
        return;
      }

      // Pre-fill form with existing data
      setFormData({
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        email: user.email || '',
        sin: user.sin_number || user.sin || '',
        birthDate: user.birth_date || '',
        addressLine1: user.address_line1 || user.address || '',
        addressLine2: user.address_line2 || '',
        city: user.address_city || '',
        province: user.address_state || user.province || '',
        postalCode: user.address_postal_code || user.postal_code || '',
        phone: user.phone || '',
        emergencyContactName: user.emergency_contact_name || '',
        emergencyContactPhone: user.emergency_contact_phone || '',
        emergencyContactRelationship: user.emergency_contact_relationship || ''
      });

      setLoading(false);
    } catch (err) {
      console.error('Error checking setup status:', err);
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const validateSIN = (sin) => {
    const cleaned = sin.replace(/\D/g, '');
    if (cleaned.length !== 9) return false;
    
    // Luhn algorithm for Canadian SIN
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      let digit = parseInt(cleaned[i]);
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    return sum % 10 === 0;
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
    if (formData.sin && !validateSIN(formData.sin)) {
      setError('Invalid SIN number');
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
    
    // Validate password/PIN if user wants to change them
    if (changePassword) {
      if (formData.password && formData.password.length < 6) {
        setError('Password must be at least 6 characters');
        return false;
      }
      if (formData.password && formData.password !== formData.confirmPassword) {
        setError('Passwords do not match');
        return false;
      }
      if (formData.pin && formData.pin.length < 4) {
        setError('PIN must be at least 4 digits');
        return false;
      }
      if (formData.pin && !/^\d+$/.test(formData.pin)) {
        setError('PIN must contain only numbers');
        return false;
      }
    }
    
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!validateForm()) {
      return;
    }

    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Session expired. Please log in again.');
      }

      const publicUserId = await getPublicUserId(session.user.email);
      if (!publicUserId) {
        throw new Error('Could not find your profile. Please sign out and sign in again.');
      }

      // Prepare update object
      const updateData = {
        first_name: formData.firstName.trim(),
        last_name: formData.lastName.trim(),
        sin_number: formData.sin.replace(/\D/g, ''),
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
      };
      
      // Update password/PIN if provided
      if (changePassword && formData.password) {
        const hashedPassword = await hashValue(formData.password);
        updateData.hashed_password = hashedPassword;
        
        // Update Supabase Auth password
        const { error: authError } = await supabase.auth.updateUser({
          password: formData.password
        });
        
        if (authError) {
          console.error('Error updating auth password:', authError);
          // Don't fail - continue with other updates
        }
      }
      
      if (changePassword && formData.pin) {
        const hashedPin = await hashValue(formData.pin);
        updateData.pin = hashedPin;
      }

      // Update user record with personal information (must target public.users.id)
      const { data: updatedRows, error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', publicUserId)
        .select('id');

      if (updateError) {
        throw updateError;
      }
      if (!updatedRows?.length) {
        throw new Error(
          'Your profile could not be saved (no rows updated). Try signing out and back in, or contact HR.'
        );
      }

      toast.success('Profile completed successfully!');
      
      // Redirect to portal
      setTimeout(() => {
        navigate('/portal', { replace: true });
      }, 1000);

    } catch (err) {
      console.error('Error saving personal information:', err);
      setError(err.message || 'Failed to save information. Please try again.');
      toast.error('Failed to save: ' + (err.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };

  const styles = {
    container: {
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.xl
    },
    card: {
      width: '100%',
      maxWidth: '600px',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.xl || '16px',
      padding: TavariStyles.spacing['2xl'],
      boxShadow: TavariStyles.shadows?.lg || '0 10px 40px rgba(0,0,0,0.1)'
    },
    header: {
      textAlign: 'center',
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.md
    },
    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.lg
    },
    section: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '8px'
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.xs
    },
    inputGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700
    },
    input: {
      width: '100%',
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      backgroundColor: TavariStyles.colors.white,
      transition: 'border-color 0.2s',
      boxSizing: 'border-box'
    },
    inputFocus: {
      outline: 'none',
      borderColor: TavariStyles.colors.primary,
      boxShadow: `0 0 0 3px ${TavariStyles.colors.primary}20`
    },
    twoColumns: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: TavariStyles.spacing.md
    },
    errorBanner: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.danger + '15',
      color: TavariStyles.colors.danger,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.lg
    },
    button: {
      width: '100%',
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: submitting ? 'not-allowed' : 'pointer',
      opacity: submitting ? 0.7 : 1,
      transition: 'opacity 0.2s',
      marginTop: TavariStyles.spacing.md
    },
    loadingText: {
      textAlign: 'center',
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.md
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <Loader size={48} style={{ color: TavariStyles.colors.primary, margin: '0 auto' }} />
          <p style={styles.loadingText}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>Complete Your Profile</h1>
          <p style={styles.subtitle}>Please provide the following information to complete your employee profile</p>
        </div>

        {error && (
          <div style={styles.errorBanner}>
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Personal Information Section */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Personal Information</h3>
            
            <div style={styles.twoColumns}>
              <div style={styles.inputGroup}>
                <label htmlFor="firstName" style={styles.label}>First Name *</label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  required
                  disabled={submitting}
                  style={styles.input}
                  onFocus={(e) => {
                    e.target.style.outline = 'none';
                    e.target.style.borderColor = TavariStyles.colors.primary;
                    e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.gray300;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <div style={styles.inputGroup}>
                <label htmlFor="lastName" style={styles.label}>Last Name *</label>
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  required
                  disabled={submitting}
                  style={styles.input}
                  onFocus={(e) => {
                    e.target.style.outline = 'none';
                    e.target.style.borderColor = TavariStyles.colors.primary;
                    e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.gray300;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>

            <div style={styles.inputGroup}>
              <label htmlFor="email" style={styles.label}>Email</label>
              <input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                disabled
                style={{ ...styles.input, backgroundColor: TavariStyles.colors.gray100, cursor: 'not-allowed' }}
              />
            </div>

            <div style={styles.twoColumns}>
              <div style={styles.inputGroup}>
                <label htmlFor="sin" style={styles.label}>SIN Number *</label>
                <input
                  id="sin"
                  name="sin"
                  type="text"
                  value={formData.sin}
                  onChange={handleInputChange}
                  placeholder="123 456 789"
                  maxLength={11}
                  required
                  disabled={submitting}
                  style={styles.input}
                  onFocus={(e) => {
                    e.target.style.outline = 'none';
                    e.target.style.borderColor = TavariStyles.colors.primary;
                    e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.gray300;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <div style={styles.inputGroup}>
                <span style={styles.label}>Birth Date *</span>
                <DateDropdownInput
                  idPrefix="portal-setup-birth"
                  value={formData.birthDate}
                  onChange={(iso) => setFormData((prev) => ({ ...prev, birthDate: iso }))}
                  min={getDateYearsAgoLocal(120)}
                  max={getLocalIsoDate()}
                  required
                  disabled={submitting}
                  selectStyle={{
                    ...styles.input,
                    flex: 1,
                    minWidth: 0
                  }}
                />
              </div>
            </div>

            <div style={styles.inputGroup}>
              <label htmlFor="phone" style={styles.label}>Phone Number</label>
              <input
                id="phone"
                name="phone"
                type="tel"
                value={formData.phone}
                onChange={handleInputChange}
                placeholder="(123) 456-7890"
                disabled={submitting}
                style={styles.input}
                onFocus={(e) => {
                  e.target.style.outline = 'none';
                  e.target.style.borderColor = TavariStyles.colors.primary;
                  e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = TavariStyles.colors.gray300;
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>
          </div>

          {/* Address Section */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Address</h3>
            
            <div style={styles.inputGroup}>
              <label htmlFor="addressLine1" style={styles.label}>Address Line 1 *</label>
              <input
                id="addressLine1"
                name="addressLine1"
                type="text"
                value={formData.addressLine1}
                onChange={handleInputChange}
                required
                disabled={submitting}
                style={styles.input}
                onFocus={(e) => {
                  e.target.style.outline = 'none';
                  e.target.style.borderColor = TavariStyles.colors.primary;
                  e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = TavariStyles.colors.gray300;
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            <div style={styles.inputGroup}>
              <label htmlFor="addressLine2" style={styles.label}>Address Line 2</label>
              <input
                id="addressLine2"
                name="addressLine2"
                type="text"
                value={formData.addressLine2}
                onChange={handleInputChange}
                disabled={submitting}
                style={styles.input}
                onFocus={(e) => {
                  e.target.style.outline = 'none';
                  e.target.style.borderColor = TavariStyles.colors.primary;
                  e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = TavariStyles.colors.gray300;
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            <div style={styles.twoColumns}>
              <div style={styles.inputGroup}>
                <label htmlFor="city" style={styles.label}>City *</label>
                <input
                  id="city"
                  name="city"
                  type="text"
                  value={formData.city}
                  onChange={handleInputChange}
                  required
                  disabled={submitting}
                  style={styles.input}
                  onFocus={(e) => {
                    e.target.style.outline = 'none';
                    e.target.style.borderColor = TavariStyles.colors.primary;
                    e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.gray300;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <div style={styles.inputGroup}>
                <label htmlFor="province" style={styles.label}>Province *</label>
                <input
                  id="province"
                  name="province"
                  type="text"
                  value={formData.province}
                  onChange={handleInputChange}
                  required
                  disabled={submitting}
                  style={styles.input}
                  onFocus={(e) => {
                    e.target.style.outline = 'none';
                    e.target.style.borderColor = TavariStyles.colors.primary;
                    e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.gray300;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>

            <div style={styles.inputGroup}>
              <label htmlFor="postalCode" style={styles.label}>Postal Code *</label>
              <input
                id="postalCode"
                name="postalCode"
                type="text"
                value={formData.postalCode}
                onChange={handleInputChange}
                placeholder="A1A 1A1"
                maxLength={7}
                required
                disabled={submitting}
                style={styles.input}
                onFocus={(e) => {
                  e.target.style.outline = 'none';
                  e.target.style.borderColor = TavariStyles.colors.primary;
                  e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = TavariStyles.colors.gray300;
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>
          </div>

          {/* Emergency Contact Section */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Emergency Contact</h3>
            
            <div style={styles.inputGroup}>
              <label htmlFor="emergencyContactName" style={styles.label}>Emergency Contact Name *</label>
              <input
                id="emergencyContactName"
                name="emergencyContactName"
                type="text"
                value={formData.emergencyContactName}
                onChange={handleInputChange}
                required
                disabled={submitting}
                style={styles.input}
                onFocus={(e) => {
                  e.target.style.outline = 'none';
                  e.target.style.borderColor = TavariStyles.colors.primary;
                  e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = TavariStyles.colors.gray300;
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            <div style={styles.twoColumns}>
              <div style={styles.inputGroup}>
                <label htmlFor="emergencyContactPhone" style={styles.label}>Emergency Contact Phone *</label>
                <input
                  id="emergencyContactPhone"
                  name="emergencyContactPhone"
                  type="tel"
                  value={formData.emergencyContactPhone}
                  onChange={handleInputChange}
                  placeholder="(123) 456-7890"
                  required
                  disabled={submitting}
                  style={styles.input}
                  onFocus={(e) => {
                    e.target.style.outline = 'none';
                    e.target.style.borderColor = TavariStyles.colors.primary;
                    e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.gray300;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <div style={styles.inputGroup}>
                <label htmlFor="emergencyContactRelationship" style={styles.label}>Relationship *</label>
                <input
                  id="emergencyContactRelationship"
                  name="emergencyContactRelationship"
                  type="text"
                  value={formData.emergencyContactRelationship}
                  onChange={handleInputChange}
                  placeholder="e.g., Spouse, Parent, Friend"
                  required
                  disabled={submitting}
                  style={styles.input}
                  onFocus={(e) => {
                    e.target.style.outline = 'none';
                    e.target.style.borderColor = TavariStyles.colors.primary;
                    e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.gray300;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>
          </div>

          {/* Password & PIN Section */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Password & PIN</h3>
            <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '16px' }}>
              Optional: Change your password and PIN
            </p>
            
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={changePassword}
                  onChange={(e) => setChangePassword(e.target.checked)}
                  disabled={submitting}
                />
                <span style={styles.label}>I want to change my password and PIN</span>
              </label>
            </div>

            {changePassword && (
              <>
                <div style={styles.twoColumns}>
                  <div style={styles.inputGroup}>
                    <label htmlFor="password" style={styles.label}>New Password</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        value={formData.password}
                        onChange={handleInputChange}
                        placeholder="Minimum 6 characters"
                        disabled={submitting}
                        style={styles.input}
                        onFocus={(e) => {
                          e.target.style.outline = 'none';
                          e.target.style.borderColor = TavariStyles.colors.primary;
                          e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                        }}
                        onBlur={(e) => {
                          e.target.style.borderColor = TavariStyles.colors.gray300;
                          e.target.style.boxShadow = 'none';
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{
                          position: 'absolute',
                          right: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: TavariStyles.colors.gray600
                        }}
                      >
                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                  </div>

                  <div style={styles.inputGroup}>
                    <label htmlFor="confirmPassword" style={styles.label}>Confirm Password</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        id="confirmPassword"
                        name="confirmPassword"
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={formData.confirmPassword}
                        onChange={handleInputChange}
                        placeholder="Re-enter password"
                        disabled={submitting}
                        style={styles.input}
                        onFocus={(e) => {
                          e.target.style.outline = 'none';
                          e.target.style.borderColor = TavariStyles.colors.primary;
                          e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                        }}
                        onBlur={(e) => {
                          e.target.style.borderColor = TavariStyles.colors.gray300;
                          e.target.style.boxShadow = 'none';
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        style={{
                          position: 'absolute',
                          right: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: TavariStyles.colors.gray600
                        }}
                      >
                        {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                  </div>
                </div>

                <div style={styles.inputGroup}>
                  <label htmlFor="pin" style={styles.label}>New PIN (4 digits)</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="pin"
                      name="pin"
                      type={showPin ? 'text' : 'password'}
                      value={formData.pin}
                      onChange={handleInputChange}
                      placeholder="0000"
                      maxLength={4}
                      disabled={submitting}
                      style={styles.input}
                      onFocus={(e) => {
                        e.target.style.outline = 'none';
                        e.target.style.borderColor = TavariStyles.colors.primary;
                        e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = TavariStyles.colors.gray300;
                        e.target.style.boxShadow = 'none';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: TavariStyles.colors.gray600
                      }}
                    >
                      {showPin ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={styles.button}
          >
            {submitting ? 'Saving...' : 'Complete Profile'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PortalSetupWizard;

