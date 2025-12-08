import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { hashValue } from '../../helpers/crypto';

// Import all required consistency files
import { SecurityWrapper } from '../../Security';
import { useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';

const AddEmployeeModal = ({ 
  isOpen, 
  onClose, 
  businessId,
  onEmployeeCreated 
}) => {
  const navigate = useNavigate();

  // Security context for employee creation
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'AddEmployeeModal',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication using standardized hook
  const {
    selectedBusinessId,
    authUser,
    userRole,
    businessData,
    authLoading,
    authError,
    isManager,
    isOwner
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager'],
    requireBusiness: true,
    componentName: 'AddEmployeeModal'
  });

  // Tax calculations for formatting
  const { formatTaxAmount } = useTaxCalculations(businessId);

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    position: '',
    department: '',
    hireDate: '',
    wage: '',
    claimCode: 1,
    employmentStatus: 'active',
    password: '',
    confirmPassword: '',
    pin: '',
    confirmPin: ''
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [showPasswords, setShowPasswords] = useState(false);
  const [businessSettings, setBusinessSettings] = useState(null);
  const [positions, setPositions] = useState([]);
  const [showNewPositionInput, setShowNewPositionInput] = useState(false);
  const [newPositionName, setNewPositionName] = useState('');
  const [roleOptions, setRoleOptions] = useState([]);
  const [selectedRole, setSelectedRole] = useState('employee');

  // Employment status options
  const employmentStatuses = [
    { value: 'active', label: 'Active' },
    { value: 'probation', label: 'Probation' },
    { value: 'suspended', label: 'Suspended' },
    { value: 'terminated', label: 'Terminated' }
  ];

  // Common departments
  const departments = [
    'Administration',
    'Human Resources',
    'Finance',
    'Marketing',
    'Sales',
    'Operations',
    'Customer Service',
    'IT/Technology',
    'Management',
    'Other'
  ];

  // CRA Claim Code options with descriptions
  const claimCodeOptions = [
    { value: 0, label: 'CC 0 - No exemptions (maximum tax deduction)' },
    { value: 1, label: 'CC 1 - Basic personal amount (most common)' },
    { value: 2, label: 'CC 2 - Basic + spouse amount' },
    { value: 3, label: 'CC 3 - Basic + eligible dependant (single parent)' },
    { value: 4, label: 'CC 4 - Basic + spouse + dependant' },
    { value: 5, label: 'CC 5 - Basic + spouse + multiple dependants' },
    { value: 6, label: 'CC 6 - Additional dependant credits' },
    { value: 7, label: 'CC 7 - Additional dependant credits' },
    { value: 8, label: 'CC 8 - Additional dependant credits' },
    { value: 9, label: 'CC 9 - Additional dependant credits' },
    { value: 10, label: 'CC 10 - Maximum claim amount (minimum tax deduction)' }
  ];

  // Load business payroll settings and positions
  useEffect(() => {
    const loadBusinessSettings = async () => {
      if (!businessId) return;

      try {
        const { data, error } = await supabase
          .from('hrpayroll_settings')
          .select('default_claim_code, tax_jurisdiction')
          .eq('business_id', businessId)
          .single();

        if (data) {
          setBusinessSettings(data);
          setFormData(prev => ({
            ...prev,
            claimCode: data.default_claim_code || 1
          }));
        }
      } catch (err) {
        console.error('Error loading business settings:', err);
      }
    };

    const loadPositions = async () => {
      if (!businessId) return;

      try {
        const { data, error } = await supabase
          .from('positions')
          .select('position_name, color')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .order('position_name');

        if (error) throw error;
        setPositions(data || []);
      } catch (err) {
        console.error('Error loading positions:', err);
      }
    };

    const loadRoles = async () => {
      if (!businessId) return;

      try {
        // Load available roles (distinct role_key for this business)
        const { data: rolesData, error: rolesError } = await supabase
          .from('role_permissions')
          .select('role_key')
          .eq('business_id', businessId);

        if (!rolesError && Array.isArray(rolesData)) {
          const unique = Array.from(new Set(rolesData.map(r => r.role_key).filter(Boolean))).sort();
          setRoleOptions(unique.length ? unique : ['owner', 'admin', 'manager', 'employee']);
        } else {
          setRoleOptions(['owner', 'admin', 'manager', 'employee']);
        }
      } catch (err) {
        console.warn('Failed to load roles:', err?.message || err);
        setRoleOptions(['owner', 'admin', 'manager', 'employee']);
      }
    };

    if (isOpen && businessId) {
      loadBusinessSettings();
      loadPositions();
      loadRoles();
      resetForm();
    }
  }, [isOpen, businessId]);

  const resetForm = () => {
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      position: '',
      department: '',
      hireDate: '',
      wage: '',
      claimCode: businessSettings?.default_claim_code || 1,
      employmentStatus: 'active',
      password: '',
      confirmPassword: '',
      pin: '',
      confirmPin: ''
    });
    setSelectedRole('employee');
    setErrors({});
  };

  const handleInputChange = async (field, value) => {
    if (field === 'email' || field === 'firstName' || field === 'lastName') {
      const validation = await validateInput(value, 'text', field);
      if (!validation.valid) {
        setErrors(prev => ({ ...prev, [field]: validation.error }));
        return;
      }
    }

    if (field === 'wage' && value) {
      const validation = await validateInput(value, 'number', 'wage');
      if (!validation.valid) {
        setErrors(prev => ({ ...prev, [field]: validation.error }));
        return;
      }
    }

    if (field === 'claimCode') {
      const validation = await validateInput(value.toString(), 'number', 'claim_code');
      if (!validation.valid || value < 0 || value > 10) {
        setErrors(prev => ({ ...prev, [field]: 'Claim code must be between 0 and 10' }));
        return;
      }
    }

    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: null
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = 'First name is required';
    }

    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Last name is required';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (formData.phone && !/^[\+\d\s\-\(\)]+$/.test(formData.phone)) {
      newErrors.phone = 'Please enter a valid phone number';
    }

    if (formData.wage && (isNaN(formData.wage) || parseFloat(formData.wage) < 0)) {
      newErrors.wage = 'Please enter a valid wage amount';
    }

    if (formData.claimCode < 0 || formData.claimCode > 10) {
      newErrors.claimCode = 'Claim code must be between 0 and 10';
    }

    if (formData.hireDate) {
      const hireDate = new Date(formData.hireDate);
      const today = new Date();
      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(today.getFullYear() + 1);

      if (hireDate > oneYearFromNow) {
        newErrors.hireDate = 'Hire date cannot be more than one year in the future';
      }
    }

    if (!formData.password.trim()) {
      newErrors.password = 'Password is required';
    } else {
      const passwordPolicyRegex = /^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{10,}$/;
      if (!passwordPolicyRegex.test(formData.password)) {
        newErrors.password = 'Password must be at least 10 characters and include 1 uppercase and 1 special character.';
      }
    }

    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    if (!formData.pin.trim()) {
      newErrors.pin = 'PIN is required';
    } else if (!/^\d{4}$/.test(formData.pin)) {
      newErrors.pin = 'PIN must be exactly 4 digits';
    }

    if (formData.pin !== formData.confirmPin) {
      newErrors.confirmPin = 'PINs do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    const rateLimitCheck = await checkRateLimit('create_employee');
    if (!rateLimitCheck.allowed) {
      setErrors({ submit: 'Rate limit exceeded. Please wait before creating another employee.' });
      return;
    }

    setLoading(true);

    try {
      await recordAction('employee_creation_attempt', true);

      // Check if email already exists in public.users
      const { data: existingUser, error: checkError } = await supabase
        .from('users')
        .select('id, email')
        .eq('email', formData.email.toLowerCase().trim())
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        throw checkError;
      }

      if (existingUser) {
        setErrors({ email: 'An employee with this email address already exists' });
        await recordAction('employee_creation_attempt', false);
        setLoading(false);
        return;
      }

      // 🔥 CRITICAL FIX: Set flag to prevent auth state clearing during employee creation
      sessionStorage.setItem('_creating_employee', 'true');

      // 🔥 CRITICAL FIX: Save current session BEFORE creating new user
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      
      if (!currentSession) {
        sessionStorage.removeItem('_creating_employee');
        throw new Error('You must be logged in to create employees');
      }

      const originalAccessToken = currentSession.access_token;
      const originalRefreshToken = currentSession.refresh_token;
      const originalUserEmail = currentSession.user.email;

      console.log('💾 Saved current session for user:', originalUserEmail);

      // Try to create Supabase Auth user
      let user = null;
      const { data: authData, error: signupError } = await supabase.auth.signUp({
        email: formData.email.toLowerCase().trim(),
        password: formData.password,
      });

      if (signupError) {
        // If user already exists in Auth, show clear error
        if (signupError.message?.includes('already registered') || signupError.message?.includes('User already registered')) {
          sessionStorage.removeItem('_creating_employee');
          setErrors({ email: 'This email address is already registered in the authentication system. Please use a different email address.' });
          await recordAction('employee_creation_attempt', false);
          setLoading(false);
          return;
        } else {
          // Other signup error
          sessionStorage.removeItem('_creating_employee');
          setErrors({ email: signupError.message || 'Failed to create authentication account. Please try again.' });
          await recordAction('employee_creation_attempt', false);
          setLoading(false);
          return;
        }
      }

      // Signup successful
      user = authData?.user;
      if (!user) {
        sessionStorage.removeItem('_creating_employee');
        setErrors({ email: 'Authentication user creation failed. Please try again.' });
        await recordAction('employee_creation_attempt', false);
        setLoading(false);
        return;
      }
      
      console.log('✅ Created auth user:', user.id);

      // 🔥 CRITICAL FIX: Immediately restore original session synchronously
      console.log('🔄 Restoring original session for:', originalUserEmail);
      
      // Use a small delay to ensure signUp completes, then restore immediately
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Retry session restoration up to 3 times
      let sessionRestored = false;
      let lastError = null;
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        const { error: sessionRestoreError } = await supabase.auth.setSession({
          access_token: originalAccessToken,
          refresh_token: originalRefreshToken
        });

        if (sessionRestoreError) {
          console.warn(`⚠️ Session restoration attempt ${attempt} failed:`, sessionRestoreError);
          lastError = sessionRestoreError;
          // Wait a bit before retrying
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        } else {
          // Verify the session was actually restored
          await new Promise(resolve => setTimeout(resolve, 100)); // Give it a moment to propagate
          const { data: { session: restoredSession } } = await supabase.auth.getSession();
          
          if (restoredSession?.user?.email === originalUserEmail) {
            console.log('✅ Session restored successfully on attempt', attempt);
            sessionRestored = true;
            break;
          } else {
            console.warn(`⚠️ Session restoration attempt ${attempt} - email mismatch`);
            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }
      }

      if (!sessionRestored) {
        console.error('❌ Failed to restore session after 3 attempts');
        sessionStorage.removeItem('_creating_employee');
        throw new Error('Session restoration failed. Please refresh the page.');
      }
      
      // Keep flag active a bit longer to catch any delayed auth events
      setTimeout(() => {
        sessionStorage.removeItem('_creating_employee');
        console.log('🧹 Cleared employee creation flag');
      }, 3000);

      // Hash password and PIN
      const hashedPassword = await hashValue(formData.password);
      const hashedPin = await hashValue(String(formData.pin || '').trim());

      // Create users table record
      const { error: insertError } = await supabase.from('users').insert({
        id: user.id,
        full_name: `${formData.firstName.trim()} ${formData.lastName.trim()}`,
        first_name: formData.firstName.trim(),
        last_name: formData.lastName.trim(),
        email: formData.email.toLowerCase().trim(),
        phone: formData.phone.trim() || null,
        hashed_password: hashedPassword,
        pin: hashedPin,
        position: formData.position.trim() || null,
        department: formData.department || null,
        hire_date: formData.hireDate || null,
        wage: formData.wage ? parseFloat(formData.wage) : null,
        claim_code: parseInt(formData.claimCode),
        employment_status: formData.employmentStatus,
        status: 'active',
        roles: ['employee']
      });

      if (insertError) {
        throw insertError;
      }

      // Link to business
      const { error: businessUserError } = await supabase.from('business_users').insert({
        user_id: user.id,
        business_id: businessId,
        role: selectedRole || 'employee'
      });

      if (businessUserError) {
        throw businessUserError;
      }

      // Create user_roles entry
      const { error: userRoleError } = await supabase
        .from('user_roles')
        .upsert(
          {
            user_id: user.id,
            business_id: businessId,
            role: selectedRole || 'employee',
            active: true,
            custom_permissions: {}
          },
          { onConflict: 'user_id,business_id' }
        );

      if (userRoleError) {
        console.warn('Failed to create user_roles entry (non-critical):', userRoleError);
        // Don't throw - this is non-critical, business_users is the primary link
      }

      await logSecurityEvent('employee_created_with_claim_code', {
        employee_id: user.id,
        employee_email: formData.email.toLowerCase().trim(),
        claim_code: formData.claimCode,
        wage: formData.wage ? parseFloat(formData.wage) : null,
        business_id: businessId,
        created_by: authUser.id,
        timestamp: new Date().toISOString()
      }, 'medium');

      await supabase.from('audit_logs').insert({
        user_id: authUser.id,
        event_type: 'employee_created',
        details: {
          method: 'manager_created',
          employee_email: formData.email.toLowerCase().trim(),
          employee_id: user.id,
          claim_code: formData.claimCode,
          wage: formData.wage ? parseFloat(formData.wage) : null,
          employment_status: formData.employmentStatus,
          timestamp: new Date().toISOString(),
        },
      });

      await recordAction('employee_creation_attempt', true);

      console.log('✅ Employee created successfully:', user.id, 'CC:', formData.claimCode);
      
      onClose();
      if (onEmployeeCreated) {
        onEmployeeCreated(user.id);
      }
      
    } catch (error) {
      console.error('❌ Error creating employee:', error);
      // Ensure flag is cleared on error
      sessionStorage.removeItem('_creating_employee');
      await recordAction('employee_creation_attempt', false);
      await logSecurityEvent('employee_creation_failed', {
        error_message: error.message,
        business_id: businessId,
        attempted_email: formData.email
      }, 'high');
      setErrors({ submit: 'Failed to create employee. Please try again.' });
    } finally {
      // Final cleanup - ensure flag is always cleared
      sessionStorage.removeItem('_creating_employee');
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  if (authLoading) {
    return (
      <div style={styles.modalOverlay}>
        <div style={styles.modal}>
          <div style={{...styles.container, justifyContent: 'center', alignItems: 'center', height: '200px'}}>
            <h3>Loading Employee Form...</h3>
            <p>Authenticating user and loading business data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (authError) {
    return (
      <div style={styles.modalOverlay}>
        <div style={styles.modal}>
          <div style={{...styles.container, justifyContent: 'center', alignItems: 'center', height: '200px'}}>
            <h3>Authentication Error</h3>
            <p>{authError}</p>
            <button 
              style={styles.createButton}
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <SecurityWrapper
      componentName="AddEmployeeModal"
      sensitiveComponent={true}
      enableAuditLogging={true}
      securityLevel="high"
    >
      <div style={styles.modalOverlay}>
        <div style={styles.modal}>
          <div style={styles.modalHeader}>
            <h2 style={styles.modalTitle}>Add New Employee</h2>
            <button onClick={onClose} style={styles.modalClose}>×</button>
          </div>

          <form onSubmit={handleSubmit} style={styles.modalContent}>
            {/* Personal Information */}
            <div style={styles.sectionHeader}>
              <h3 style={styles.sectionTitle}>Personal Information</h3>
            </div>

            <div style={styles.fieldGrid}>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>First Name *</label>
                <input
                  type="text"
                  style={{
                    ...styles.formInput,
                    borderColor: errors.firstName ? TavariStyles.colors.danger : TavariStyles.colors.primary
                  }}
                  value={formData.firstName}
                  onChange={(e) => handleInputChange('firstName', e.target.value)}
                  placeholder="Enter first name"
                />
                {errors.firstName && (
                  <div style={styles.errorMessage}>{errors.firstName}</div>
                )}
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Last Name *</label>
                <input
                  type="text"
                  style={{
                    ...styles.formInput,
                    borderColor: errors.lastName ? TavariStyles.colors.danger : TavariStyles.colors.primary
                  }}
                  value={formData.lastName}
                  onChange={(e) => handleInputChange('lastName', e.target.value)}
                  placeholder="Enter last name"
                />
                {errors.lastName && (
                  <div style={styles.errorMessage}>{errors.lastName}</div>
                )}
              </div>
            </div>

            <div style={styles.fieldGrid}>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Email Address *</label>
                <input
                  type="email"
                  style={{
                    ...styles.formInput,
                    borderColor: errors.email ? TavariStyles.colors.danger : TavariStyles.colors.primary
                  }}
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  placeholder="Enter email address"
                />
                {errors.email && (
                  <div style={styles.errorMessage}>{errors.email}</div>
                )}
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Phone Number</label>
                <input
                  type="tel"
                  style={{
                    ...styles.formInput,
                    borderColor: errors.phone ? TavariStyles.colors.danger : TavariStyles.colors.primary
                  }}
                  value={formData.phone}
                  onChange={(e) => handleInputChange('phone', e.target.value)}
                  placeholder="Enter phone number"
                />
                {errors.phone && (
                  <div style={styles.errorMessage}>{errors.phone}</div>
                )}
              </div>
            </div>

            {/* Authentication Section */}
            <div style={styles.sectionHeader}>
              <div style={styles.sectionTitleRow}>
                <h3 style={styles.sectionTitle}>Authentication Credentials</h3>
                <button 
                  type="button"
                  style={styles.toggleButton}
                  onClick={() => setShowPasswords(!showPasswords)}
                >
                  {showPasswords ? 'Hide' : 'Show'} Passwords
                </button>
              </div>
            </div>

            <div style={styles.fieldGrid}>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Password *</label>
                <input
                  type={showPasswords ? "text" : "password"}
                  style={{
                    ...styles.formInput,
                    borderColor: errors.password ? TavariStyles.colors.danger : TavariStyles.colors.primary
                  }}
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  placeholder="Enter password"
                />
                {errors.password && (
                  <div style={styles.errorMessage}>{errors.password}</div>
                )}
                <div style={styles.fieldNote}>
                  At least 10 characters, 1 uppercase, 1 special character
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Confirm Password *</label>
                <input
                  type={showPasswords ? "text" : "password"}
                  style={{
                    ...styles.formInput,
                    borderColor: errors.confirmPassword ? TavariStyles.colors.danger : TavariStyles.colors.primary
                  }}
                  value={formData.confirmPassword}
                  onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                  placeholder="Confirm password"
                />
                {errors.confirmPassword && (
                  <div style={styles.errorMessage}>{errors.confirmPassword}</div>
                )}
              </div>
            </div>

            <div style={styles.fieldGrid}>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>4-Digit PIN *</label>
                <input
                  type={showPasswords ? "text" : "password"}
                  style={{
                    ...styles.formInput,
                    borderColor: errors.pin ? TavariStyles.colors.danger : TavariStyles.colors.primary
                  }}
                  value={formData.pin}
                  onChange={(e) => handleInputChange('pin', e.target.value)}
                  placeholder="Enter 4-digit PIN"
                  maxLength={4}
                  pattern="\d*"
                />
                {errors.pin && (
                  <div style={styles.errorMessage}>{errors.pin}</div>
                )}
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Confirm PIN *</label>
                <input
                  type={showPasswords ? "text" : "password"}
                  style={{
                    ...styles.formInput,
                    borderColor: errors.confirmPin ? TavariStyles.colors.danger : TavariStyles.colors.primary
                  }}
                  value={formData.confirmPin}
                  onChange={(e) => handleInputChange('confirmPin', e.target.value)}
                  placeholder="Confirm PIN"
                  maxLength={4}
                  pattern="\d*"
                />
                {errors.confirmPin && (
                  <div style={styles.errorMessage}>{errors.confirmPin}</div>
                )}
              </div>
            </div>

            {/* Employment Information */}
            <div style={styles.sectionHeader}>
              <h3 style={styles.sectionTitle}>Employment Information</h3>
            </div>

            <div style={styles.fieldGrid}>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Position/Job Title</label>
                {!showNewPositionInput ? (
                  <>
                    <select
                      style={styles.formSelect}
                      value={formData.position}
                      onChange={(e) => {
                        if (e.target.value === 'NEW_POSITION') {
                          setShowNewPositionInput(true);
                        } else {
                          handleInputChange('position', e.target.value);
                        }
                      }}
                    >
                      <option value="">Select position</option>
                      {positions.map(pos => (
                        <option key={pos.position_name} value={pos.position_name}>
                          {pos.position_name}
                        </option>
                      ))}
                      <option value="NEW_POSITION">+ Add New Position</option>
                    </select>
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      style={{ ...styles.formInput, width: '90%' }}
                      value={newPositionName}
                      onChange={(e) => setNewPositionName(e.target.value)}
                      placeholder="Enter new position name"
                      autoFocus
                    />
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <button
                        type="button"
                        onClick={async () => {
                          if (newPositionName.trim()) {
                            // Add to positions table
                            try {
                              const { error } = await supabase
                                .from('positions')
                                .insert({
                                  business_id: businessId,
                                  position_name: newPositionName.trim(),
                                  color: '#4a90e2',
                                  is_active: true
                                });
                              
                              if (!error) {
                                handleInputChange('position', newPositionName.trim());
                                setShowNewPositionInput(false);
                                setNewPositionName('');
                                // Reload positions
                                const { data } = await supabase
                                  .from('positions')
                                  .select('position_name, color')
                                  .eq('business_id', businessId)
                                  .eq('is_active', true)
                                  .order('position_name');
                                setPositions(data || []);
                              }
                            } catch (err) {
                              console.error('Error adding position:', err);
                            }
                          }
                        }}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: TavariStyles.colors.primary,
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowNewPositionInput(false);
                          setNewPositionName('');
                        }}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: 'transparent',
                          color: TavariStyles.colors.gray600,
                          border: `1px solid ${TavariStyles.colors.gray300}`,
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Department</label>
                <select
                  style={styles.formSelect}
                  value={formData.department}
                  onChange={(e) => handleInputChange('department', e.target.value)}
                >
                  <option value="">Select department</option>
                  {departments.map(dept => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={styles.fieldGrid}>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Hire Date</label>
                <input
                  type="date"
                  style={{
                    ...styles.formInput,
                    borderColor: errors.hireDate ? TavariStyles.colors.danger : TavariStyles.colors.primary
                  }}
                  value={formData.hireDate}
                  onChange={(e) => handleInputChange('hireDate', e.target.value)}
                />
                {errors.hireDate && (
                  <div style={styles.errorMessage}>{errors.hireDate}</div>
                )}
                <div style={styles.fieldNote}>
                  Leave blank if not yet determined
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Role</label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  style={styles.formSelect}
                  disabled={loading}
                >
                  {(roleOptions.length ? roleOptions : ['owner', 'admin', 'manager', 'employee']).map((roleKey) => (
                    <option key={roleKey} value={roleKey}>
                      {roleKey.charAt(0).toUpperCase() + roleKey.slice(1).replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <div style={styles.fieldNote}>
                  Permission role for this employee
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Employment Status</label>
                <select
                  style={styles.formSelect}
                  value={formData.employmentStatus}
                  onChange={(e) => handleInputChange('employmentStatus', e.target.value)}
                >
                  {employmentStatuses.map(status => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={styles.fieldGrid}>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Hourly Wage ($/hour)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  style={{
                    ...styles.formInput,
                    borderColor: errors.wage ? TavariStyles.colors.danger : TavariStyles.colors.primary
                  }}
                  value={formData.wage}
                  onChange={(e) => handleInputChange('wage', e.target.value)}
                  placeholder="0.00"
                />
                {errors.wage && (
                  <div style={styles.errorMessage}>{errors.wage}</div>
                )}
                <div style={styles.fieldNote}>
                  Leave blank if not yet determined
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>CRA Claim Code (TD1 Form)</label>
                <select
                  style={{
                    ...styles.formSelect,
                    borderColor: errors.claimCode ? TavariStyles.colors.danger : TavariStyles.colors.primary
                  }}
                  value={formData.claimCode}
                  onChange={(e) => handleInputChange('claimCode', parseInt(e.target.value))}
                >
                  {claimCodeOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {errors.claimCode && (
                  <div style={styles.errorMessage}>{errors.claimCode}</div>
                )}
                <div style={styles.fieldNote}>
                  {businessSettings ? 
                    `Business default: CC ${businessSettings.default_claim_code}` : 
                    'Based on employee\'s TD1 tax form'
                  }
                </div>
              </div>
            </div>

            {/* Claim Code Information Box */}
            <div style={styles.claimCodeInfo}>
              <h4 style={styles.claimCodeTitle}>💡 Claim Code Information</h4>
              <p style={styles.claimCodeDescription}>
                The claim code determines how much income tax is deducted from the employee's paycheck. 
                This should match what the employee selected on their TD1 Personal Tax Credits Return form:
              </p>
              <ul style={styles.claimCodeList}>
                <li><strong>CC 0:</strong> Maximum tax deductions (no personal exemptions)</li>
                <li><strong>CC 1:</strong> Most common - basic personal amount only</li>
                <li><strong>CC 2-3:</strong> Include spouse or dependant amounts</li>
                <li><strong>CC 4+:</strong> Additional family/dependant exemptions</li>
                <li><strong>CC 10:</strong> Maximum exemptions (minimum tax deductions)</li>
              </ul>
            </div>

            {errors.submit && (
              <div style={styles.errorBanner}>
                {errors.submit}
              </div>
            )}

            {/* Form Actions */}
            <div style={styles.formActions}>
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                style={styles.cancelButton}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                style={{
                  ...styles.createButton,
                  opacity: loading ? 0.5 : 1
                }}
              >
                {loading ? 'Creating Employee...' : 'Create Employee'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </SecurityWrapper>
  );
};

// Enhanced styles using TavariStyles
const styles = {
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: TavariStyles.spacing.xl
  },
  modal: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius?.lg || '12px',
    maxWidth: '800px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: TavariStyles.shadows?.xl || '0 20px 25px rgba(0,0,0,0.1)'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: TavariStyles.spacing.xl,
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    backgroundColor: TavariStyles.colors.gray50
  },
  modalTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray900,
    margin: 0
  },
  modalClose: {
    background: 'none',
    border: 'none',
    fontSize: TavariStyles.typography.fontSize['2xl'],
    color: TavariStyles.colors.gray500,
    cursor: 'pointer',
    padding: TavariStyles.spacing.sm,
    borderRadius: TavariStyles.borderRadius?.sm || '4px'
  },
  modalContent: {
    padding: TavariStyles.spacing.xl,
    overflowY: 'auto',
    flex: 1
  },
  container: {
    display: 'flex',
    flexDirection: 'column'
  },
  sectionHeader: {
    marginBottom: TavariStyles.spacing.lg,
    paddingBottom: TavariStyles.spacing.md,
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`
  },
  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray800,
    margin: 0
  },
  sectionTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  toggleButton: {
    ...TavariStyles.components.button?.base,
    ...TavariStyles.components.button?.variants?.secondary,
    fontSize: TavariStyles.typography.fontSize.sm,
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing.xl
  },
  formGroup: {
    marginBottom: TavariStyles.spacing.lg
  },
  formLabel: {
    ...TavariStyles.components.form?.label || {
      display: 'block',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs
    }
  },
  formInput: {
    ...TavariStyles.components.form?.input || {
      width: '100%',
      padding: '12px 16px',
      border: `2px solid ${TavariStyles.colors.primary}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      boxSizing: 'border-box',
      transition: 'border-color 0.2s ease'
    }
  },
  formSelect: {
    ...TavariStyles.components.form?.select || {
      width: '100%',
      padding: '12px 16px',
      border: `2px solid ${TavariStyles.colors.primary}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      backgroundColor: TavariStyles.colors.white,
      boxSizing: 'border-box',
      cursor: 'pointer'
    }
  },
  fieldNote: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600,
    marginTop: TavariStyles.spacing.xs,
    fontStyle: 'italic'
  },
  errorMessage: {
    color: TavariStyles.colors.danger,
    fontSize: TavariStyles.typography.fontSize.sm,
    marginTop: TavariStyles.spacing.xs
  },
  errorBanner: {
    ...TavariStyles.components.banner?.base,
    ...TavariStyles.components.banner?.variants?.error,
    marginBottom: TavariStyles.spacing.xl
  },
  claimCodeInfo: {
    backgroundColor: TavariStyles.colors.infoBg,
    border: `1px solid ${TavariStyles.colors.info}30`,
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    padding: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing.xl
  },
  claimCodeTitle: {
    fontSize: TavariStyles.typography.fontSize.md,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.info,
    marginTop: 0,
    marginBottom: TavariStyles.spacing.sm
  },
  claimCodeDescription: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray700,
    marginBottom: TavariStyles.spacing.sm,
    lineHeight: TavariStyles.typography.lineHeight.relaxed
  },
  claimCodeList: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray700,
    marginLeft: TavariStyles.spacing.lg,
    lineHeight: TavariStyles.typography.lineHeight.relaxed
  },
  formActions: {
    display: 'flex',
    gap: TavariStyles.spacing.md,
    justifyContent: 'flex-end',
    paddingTop: TavariStyles.spacing.lg,
    borderTop: `1px solid ${TavariStyles.colors.gray200}`
  },
  cancelButton: {
    ...TavariStyles.components.button?.base,
    ...TavariStyles.components.button?.variants?.secondary,
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold
  },
  createButton: {
    ...TavariStyles.components.button?.base,
    ...TavariStyles.components.button?.variants?.primary,
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold
  }
};

export default AddEmployeeModal;