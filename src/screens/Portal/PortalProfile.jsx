// screens/Portal/PortalProfile.jsx - Employee Profile Management
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { Save, User, Mail, Phone, MapPin, CreditCard, Lock, Eye, EyeOff, KeyRound, Calendar, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import bcrypt from 'bcryptjs';
import { getPublicUserId } from '../../utils/getPublicUserId';
import { employeeAppPath } from '../../utils/employeeAppRouting';
import { getEmployeePortalSelectedBusinessId } from '../../utils/employeeProfileSelection';
import DateDropdownInput, { getDateYearsAgoLocal, getLocalIsoDate } from '../../components/UI/DateDropdownInput';

const PortalProfile = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    address: '',
    address_line2: '',
    city: '',
    province: '',
    postal_code: '',
    birth_date: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    emergency_contact_relationship: '',
    sin_number: ''
  });
  const [errors, setErrors] = useState({});
  const [sinUnlocked, setSinUnlocked] = useState(false);
  const [sinPin, setSinPin] = useState('');
  const [sinPinError, setSinPinError] = useState('');
  const [showSin, setShowSin] = useState(false);
  const [hasSinRecord, setHasSinRecord] = useState(false);
  const [businessId, setBusinessId] = useState(null);
  /** public.users.id — employee_sin_numbers & profile rows use this, not always auth.users.id */
  const [publicUserId, setPublicUserId] = useState(null);

  useEffect(() => {
    loadProfile();
    window.addEventListener('employee-profile-selection-changed', loadProfile);
    return () => window.removeEventListener('employee-profile-selection-changed', loadProfile);
  }, []);

  const loadProfile = async () => {
    try {
      setLoading(true);
      
      // Get current user
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        navigate(employeeAppPath('/portal/login'));
        return;
      }

      setUser(currentUser);

      // Get public.users.id (business_users references public.users.id, not auth.users.id)
      const resolvedPublicUserId = await getPublicUserId(currentUser.email);
      if (!resolvedPublicUserId) {
        toast.error('User profile not found');
        setPublicUserId(null);
        return;
      }
      setPublicUserId(resolvedPublicUserId);

      // Get business_id for decrypt_sin RPC
      const { data: businessUsers } = await supabase
        .from('business_users')
        .select('business_id')
        .eq('user_id', resolvedPublicUserId)
        .limit(20);

      if (businessUsers && businessUsers.length > 0) {
        const selectedBusinessId = getEmployeePortalSelectedBusinessId();
        setBusinessId(businessUsers.find((row) => row.business_id === selectedBusinessId)?.business_id || businessUsers[0].business_id);
      }

      // Load user profile data - SELECT ALL FIELDS that the modal saves
      // Only select columns that actually exist (removed fallback columns: address, city, province, postal_code)
      const { data: profile, error } = await supabase
        .from('users')
        .select('first_name, last_name, email, phone, address_line1, address_line2, address_city, address_state, address_postal_code, birth_date, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, pin')
        .eq('id', resolvedPublicUserId)
        .single();

      if (error) throw error;

      // Check if encrypted SIN record exists
      const { data: sinRecord } = await supabase
        .from('employee_sin_numbers')
        .select('id')
        .eq('employee_id', resolvedPublicUserId)
        .maybeSingle();

      setHasSinRecord(!!sinRecord);

      setFormData({
        first_name: profile.first_name || '',
        last_name: profile.last_name || '',
        email: profile.email || currentUser.email || '',
        phone: profile.phone || '',
        address: profile.address_line1 || '',
        address_line2: profile.address_line2 || '',
        city: profile.address_city || '',
        province: profile.address_state || '',
        postal_code: profile.address_postal_code || '',
        birth_date: profile.birth_date || '',
        emergency_contact_name: profile.emergency_contact_name || '',
        emergency_contact_phone: profile.emergency_contact_phone || '',
        emergency_contact_relationship: profile.emergency_contact_relationship || '',
        sin_number: '' // Will be loaded from encrypted record after PIN unlock
      });
    } catch (error) {
      console.error('Error loading profile:', error);
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
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

  const validateForm = () => {
    const newErrors = {};

    if (!formData.first_name.trim()) {
      newErrors.first_name = 'First name is required';
    }

    if (!formData.last_name.trim()) {
      newErrors.last_name = 'Last name is required';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    if (formData.phone && !/^[\d\s\-()]+$/.test(formData.phone)) {
      newErrors.phone = 'Invalid phone number format';
    }

    if (formData.postal_code && !/^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(formData.postal_code)) {
      newErrors.postal_code = 'Invalid postal code format (e.g., A1A 1A1)';
    }

    // Validate SIN if provided and not unlocked (i.e., user is adding new SIN)
    if (!hasSinRecord && formData.sin_number && formData.sin_number.trim()) {
      const sinValidation = validateSIN(formData.sin_number);
      if (!sinValidation.isValid) {
        newErrors.sin_number = sinValidation.message;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleUnlockSIN = async () => {
    if (sinPin.length !== 4) {
      setSinPinError('PIN must be 4 digits');
      return;
    }

    try {
      setSinPinError('');

      // Verify PIN
      if (!publicUserId) {
        setSinPinError('Profile not loaded. Refresh and try again.');
        return;
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('pin')
        .eq('id', publicUserId)
        .single();

      if (userError) throw userError;

      const storedPin = userData?.pin;
      if (!storedPin) {
        setSinPinError('No PIN configured for your account. Contact administrator.');
        return;
      }

      const pinMatches = await bcrypt.compare(sinPin, storedPin);
      if (!pinMatches) {
        setSinPinError('Invalid PIN. Please try again.');
        return;
      }

      // Get encrypted SIN record
      const { data: sinRecord, error: sinError } = await supabase
        .from('employee_sin_numbers')
        .select('sin_number_encrypted')
        .eq('employee_id', publicUserId)
        .maybeSingle();

      if (sinError) throw sinError;

      if (!sinRecord || !sinRecord.sin_number_encrypted) {
        setSinPinError('No SIN record found. Contact HR to add your SIN number.');
        return;
      }

      // Decrypt SIN using RPC function
      if (!businessId) {
        setSinPinError('Unable to retrieve business information. Please try again.');
        return;
      }

      const { data: decryptedSIN, error: decryptError } = await supabase.rpc('decrypt_sin', {
        encrypted_data: sinRecord.sin_number_encrypted,
        business_id: businessId
      });

      if (decryptError) throw decryptError;

      if (!decryptedSIN || decryptedSIN.length !== 9) {
        setSinPinError('Failed to decrypt SIN. Contact administrator.');
        return;
      }

      // Set decrypted SIN in form data
      setFormData(prev => ({
        ...prev,
        sin_number: decryptedSIN
      }));

      setSinUnlocked(true);
      setShowSin(false); // Start with SIN hidden
      setSinPin(''); // Clear PIN input
    } catch (error) {
      console.error('Error unlocking SIN:', error);
      setSinPinError('Failed to unlock SIN: ' + (error.message || 'Unknown error'));
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear error for this field when user starts typing
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const handleSave = async () => {
    if (!validateForm()) {
      toast.error('Please fix the errors before saving');
      return;
    }

    setSaving(true);
    try {
      if (!businessId) {
        throw new Error('Unable to retrieve business information');
      }
      if (!publicUserId) {
        throw new Error('User profile not loaded');
      }

      // Update user profile (without SIN - SIN is handled separately)
      const { data: updatedRows, error } = await supabase
        .from('users')
        .update({
          first_name: formData.first_name.trim(),
          last_name: formData.last_name.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim() || null,
          address_line1: formData.address.trim() || null,
          address_line2: formData.address_line2.trim() || null,
          address_city: formData.city.trim() || null,
          address_state: formData.province.trim() || null,
          address_postal_code: formData.postal_code.trim().toUpperCase().replace(/\s/g, '') || null,
          birth_date: formData.birth_date || null,
          emergency_contact_name: formData.emergency_contact_name.trim() || null,
          emergency_contact_phone: formData.emergency_contact_phone.trim() || null,
          emergency_contact_relationship: formData.emergency_contact_relationship.trim() || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', publicUserId)
        .select('id');

      if (error) throw error;
      if (!updatedRows?.length) {
        throw new Error(
          'Your profile was not updated. Try signing out and back in, or contact HR if this continues.'
        );
      }

      // Handle SIN separately - encrypt and save to employee_sin_numbers table (only if no record exists and SIN is provided)
      if (!hasSinRecord && formData.sin_number && formData.sin_number.trim()) {
        const cleanSIN = formData.sin_number.replace(/\D/g, '');
        
        // Encrypt SIN using RPC function
        const { data: encryptedData, error: encryptError } = await supabase.rpc('encrypt_sin', {
          sin_text: cleanSIN,
          business_id: businessId
        });

        if (encryptError) throw encryptError;
        if (!encryptedData) throw new Error('SIN encryption failed');

        // Create new SIN record
        const { error: sinInsertError } = await supabase
          .from('employee_sin_numbers')
          .insert({
            employee_id: publicUserId,
            sin_number_encrypted: encryptedData,
            created_by: publicUserId,
            updated_by: publicUserId
          });

        if (sinInsertError) throw sinInsertError;
      }

      // Update email in auth if it changed
      if (formData.email !== user.email) {
        const { error: emailError } = await supabase.auth.updateUser({
          email: formData.email.trim()
        });
        
        if (emailError) {
          console.error('Error updating email:', emailError);
          toast.error('Profile saved but email update failed. You may need to verify your new email.');
        } else {
          toast.success('Profile updated. Please check your email to verify the new address.');
        }
      } else {
        toast.success('Profile updated successfully');
      }

      // Reload profile to get updated data
      await loadProfile();
      // Reset SIN unlock state after saving
      setSinUnlocked(false);
      setShowSin(false);
    } catch (error) {
      console.error('Error saving profile:', error);
      toast.error('Failed to save profile: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const styles = {
    container: {
      maxWidth: '800px',
      width: '100%',
      minWidth: 0,
      margin: '0 auto',
      overflowX: 'hidden',
      boxSizing: 'border-box'
    },
    header: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      boxSizing: 'border-box',
      overflowWrap: 'anywhere'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    form: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      boxSizing: 'border-box',
      minWidth: 0
    },
    section: {
      marginBottom: TavariStyles.spacing.xl
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.md,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    formGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(250px, 100%), 1fr))',
      gap: TavariStyles.spacing.md,
      minWidth: 0
    },
    formGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    input: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray900,
      transition: 'border-color 0.2s',
      width: '100%',
      boxSizing: 'border-box'
    },
    inputError: {
      borderColor: '#dc2626'
    },
    errorText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: '#dc2626',
      marginTop: '4px'
    },
    helpText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      marginTop: '4px'
    },
    fullWidth: {
      gridColumn: '1 / -1'
    },
    actions: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.xl,
      paddingTop: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`
    },
    saveButton: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: saving ? 'not-allowed' : 'pointer',
      opacity: saving ? 0.6 : 1,
      transition: 'opacity 0.2s'
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: '48px', color: TavariStyles.colors.gray600 }}>
          Loading profile...
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>My Profile</h1>
        <p style={styles.subtitle}>Update your personal information</p>
      </div>

      <form style={styles.form} onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
        {/* Personal Information */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>
            <User size={20} />
            Personal Information
          </h2>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>
                <User size={16} />
                First Name *
              </label>
              <input
                type="text"
                value={formData.first_name}
                onChange={(e) => handleInputChange('first_name', e.target.value)}
                style={{
                  ...styles.input,
                  ...(errors.first_name ? styles.inputError : {})
                }}
                required
              />
              {errors.first_name && <span style={styles.errorText}>{errors.first_name}</span>}
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                <User size={16} />
                Last Name *
              </label>
              <input
                type="text"
                value={formData.last_name}
                onChange={(e) => handleInputChange('last_name', e.target.value)}
                style={{
                  ...styles.input,
                  ...(errors.last_name ? styles.inputError : {})
                }}
                required
              />
              {errors.last_name && <span style={styles.errorText}>{errors.last_name}</span>}
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                <Mail size={16} />
                Email Address *
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                style={{
                  ...styles.input,
                  ...(errors.email ? styles.inputError : {})
                }}
                required
              />
              {errors.email && <span style={styles.errorText}>{errors.email}</span>}
              <span style={styles.helpText}>Changing your email will require verification</span>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                <Phone size={16} />
                Phone Number
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => handleInputChange('phone', e.target.value)}
                placeholder="(555) 123-4567"
                style={{
                  ...styles.input,
                  ...(errors.phone ? styles.inputError : {})
                }}
              />
              {errors.phone && <span style={styles.errorText}>{errors.phone}</span>}
            </div>
          </div>
        </div>

        {/* Address Information */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>
            <MapPin size={20} />
            Address Information
          </h2>
          <div style={styles.formGrid}>
            <div style={{ ...styles.formGroup, ...styles.fullWidth }}>
              <label style={styles.label}>
                <MapPin size={16} />
                Street Address
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => handleInputChange('address', e.target.value)}
                style={styles.input}
                placeholder="123 Main Street"
              />
            </div>

            <div style={{ ...styles.formGroup, ...styles.fullWidth }}>
              <label style={styles.label}>
                <MapPin size={16} />
                Address Line 2 (Optional)
              </label>
              <input
                type="text"
                value={formData.address_line2}
                onChange={(e) => handleInputChange('address_line2', e.target.value)}
                style={styles.input}
                placeholder="Apt, Suite, Unit, etc."
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>City</label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => handleInputChange('city', e.target.value)}
                style={styles.input}
                placeholder="Toronto"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Province</label>
              <input
                type="text"
                value={formData.province}
                onChange={(e) => handleInputChange('province', e.target.value)}
                style={styles.input}
                placeholder="ON"
                maxLength={2}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Postal Code</label>
              <input
                type="text"
                value={formData.postal_code}
                onChange={(e) => handleInputChange('postal_code', e.target.value.toUpperCase())}
                style={{
                  ...styles.input,
                  ...(errors.postal_code ? styles.inputError : {})
                }}
                placeholder="A1A 1A1"
                maxLength={7}
              />
              {errors.postal_code && <span style={styles.errorText}>{errors.postal_code}</span>}
            </div>
          </div>
        </div>

        {/* Additional Information */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>
            <Calendar size={20} />
            Additional Information
          </h2>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>
                <Calendar size={16} />
                Birth Date
              </label>
              <DateDropdownInput
                idPrefix="portal-profile-birth"
                value={formData.birth_date}
                onChange={(iso) => handleInputChange('birth_date', iso)}
                min={getDateYearsAgoLocal(120)}
                max={getLocalIsoDate()}
                selectStyle={{
                  ...styles.input,
                  flex: 1,
                  minWidth: 0,
                  fontWeight: 600
                }}
              />
            </div>
          </div>
        </div>

        {/* Emergency Contact */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>
            <Users size={20} />
            Emergency Contact
          </h2>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>
                <User size={16} />
                Contact Name
              </label>
              <input
                type="text"
                value={formData.emergency_contact_name}
                onChange={(e) => handleInputChange('emergency_contact_name', e.target.value)}
                style={styles.input}
                placeholder="John Doe"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                <Phone size={16} />
                Contact Phone
              </label>
              <input
                type="tel"
                value={formData.emergency_contact_phone}
                onChange={(e) => handleInputChange('emergency_contact_phone', e.target.value)}
                style={styles.input}
                placeholder="(555) 123-4567"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                <User size={16} />
                Relationship
              </label>
              <input
                type="text"
                value={formData.emergency_contact_relationship}
                onChange={(e) => handleInputChange('emergency_contact_relationship', e.target.value)}
                style={styles.input}
                placeholder="Spouse, Parent, etc."
              />
            </div>
          </div>
        </div>

        {/* Tax Information */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>
            <CreditCard size={20} />
            Tax Information
          </h2>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>
                <CreditCard size={16} />
                SIN Number
                {hasSinRecord && <span style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginLeft: '8px' }}>(Encrypted)</span>}
              </label>
              {!hasSinRecord ? (
                <div>
                  <input
                    type="text"
                    value={formData.sin_number || ''}
                    onChange={(e) => handleInputChange('sin_number', e.target.value.replace(/\D/g, ''))}
                    style={{
                      ...styles.input,
                      ...(errors.sin_number ? styles.inputError : {}),
                      fontFamily: 'monospace',
                      letterSpacing: '2px'
                    }}
                    placeholder="123456789"
                    maxLength={9}
                  />
                  {errors.sin_number && <span style={styles.errorText}>{errors.sin_number}</span>}
                  <span style={styles.helpText}>Enter your SIN number. It will be encrypted and stored securely.</span>
                </div>
              ) : !sinUnlocked ? (
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <input
                      type="password"
                      value={sinPin}
                      onChange={(e) => {
                        setSinPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                        setSinPinError('');
                      }}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && sinPin.length === 4) {
                          handleUnlockSIN();
                        }
                      }}
                      style={{
                        ...styles.input,
                        width: '200px',
                        fontFamily: 'monospace',
                        letterSpacing: '4px',
                        textAlign: 'center',
                        fontSize: '18px'
                      }}
                      placeholder="••••"
                      maxLength={4}
                    />
                    <button
                      type="button"
                      onClick={handleUnlockSIN}
                      disabled={sinPin.length < 4}
                      style={{
                        ...styles.saveButton,
                        padding: '12px 20px',
                        opacity: sinPin.length < 4 ? 0.5 : 1,
                        cursor: sinPin.length < 4 ? 'not-allowed' : 'pointer'
                      }}
                    >
                      <KeyRound size={16} />
                      Unlock
                    </button>
                  </div>
                  {sinPinError && <span style={styles.errorText}>{sinPinError}</span>}
                  <span style={styles.helpText}>Enter your PIN to view SIN number</span>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type={showSin ? 'text' : 'password'}
                      value={formData.sin_number || ''}
                      readOnly
                      style={{
                        ...styles.input,
                        fontFamily: 'monospace',
                        letterSpacing: '2px',
                        backgroundColor: TavariStyles.colors.gray50,
                        cursor: 'not-allowed'
                      }}
                      placeholder={showSin ? '123456789' : '•••••••••'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSin(!showSin)}
                      style={{
                        padding: '12px',
                        border: `1px solid ${TavariStyles.colors.gray300}`,
                        borderRadius: '8px',
                        background: 'white',
                        cursor: 'pointer'
                      }}
                    >
                      {showSin ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <span style={styles.helpText}>SIN is encrypted and stored securely. Only viewable with PIN. Contact HR to update.</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={styles.actions}>
          <button
            type="submit"
            onClick={handleSave}
            disabled={saving}
            style={styles.saveButton}
          >
            <Save size={18} />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PortalProfile;


