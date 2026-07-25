// src/screens/Register.jsx - WITH CORRECT VALIDATION PROPERTY NAMES
import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { hashValue } from '../helpers/crypto';
import { SecurityWrapper, useSecurityContext } from '../Security';
import { TavariStyles } from '../utils/TavariStyles';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import AppBuilderModuleService from '../services/AppBuilder/AppBuilderModuleService';

const Register = () => {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const signupSource = searchParams.get('source'); // Check if they came from tavari-music splash page


  const handleRegister = async () => {
    setErrorMsg('');
    setIsLoading(true);

    const passwordPolicyRegex = /^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{10,}$/;
    if (!passwordPolicyRegex.test(password)) {
      setErrorMsg('Password must be at least 10 characters and include 1 uppercase and 1 special character.');
      setIsLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match');
      setIsLoading(false);
      return;
    }

    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signupError) {
      setErrorMsg(signupError.message);
      setIsLoading(false);
      return;
    }

    const user = data?.user;
    const hashed = await hashValue(password);
    const hashedPin = await hashValue(String(pin || '').trim());

    if (!user) {
      setErrorMsg('Signup failed — no user returned.');
      setIsLoading(false);
      return;
    }

    const { error: insertError } = await supabase.from('users').insert({
      id: user.id,
      full_name: fullName,
      email,
      phone,
      hashed_password: hashed,
      pin: hashedPin,
      status: 'active',
      roles: ['owner'],
    });

    if (insertError) {
      setErrorMsg('Signup succeeded but user DB insert failed.');
      setIsLoading(false);
      return;
    }

    // Sign in the user to establish a session (needed for RPC function)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setErrorMsg('Account created but failed to sign in. Please try logging in.');
      setIsLoading(false);
      return;
    }

    // Use RPC function to create business (bypasses RLS)
    const { data: businessResult, error: businessError } = await supabase.rpc('create_business_for_user', {
      p_user_id: user.id,
      p_business_name: fullName + "'s Business"
    });

    if (businessError || !businessResult?.business_id) {
      setErrorMsg('Signup failed during business creation: ' + (businessError?.message || 'Unknown error'));
      setIsLoading(false);
      return;
    }

    const businessId = businessResult.business_id;
    
    localStorage.setItem('selectedBusinessId', businessId);

    // Enable Music module if they signed up from Tavari Music splash page
    if (signupSource === 'tavari-music') {
      try {
        AppBuilderModuleService.setBusinessId(businessId);
        await AppBuilderModuleService.enableModule('music');
        console.log('✅ Music module enabled for new business from Tavari Music signup');
      } catch (error) {
        console.error('⚠️ Failed to enable music module during registration:', error);
        // Don't fail registration if module enablement fails
      }
    }

    // Enable Voice Agent module if they signed up from Tavari Voice splash page
    if (signupSource === 'tavari-voice') {
      try {
        AppBuilderModuleService.setBusinessId(businessId);
        await AppBuilderModuleService.enableModule('voice_agent');
        console.log('✅ Voice Agent module enabled for new business from Tavari Voice signup');
      } catch (error) {
        console.error('⚠️ Failed to enable voice_agent module during registration:', error);
        // Don't fail registration if module enablement fails
      }
    }

    // CREATE DEFAULT KITCHEN STATION FOR NEW BUSINESS
    await supabase.from('pos_stations').insert({
      business_id: businessId,
      name: 'Kitchen',
      description: 'Main kitchen station',
      printer_ids: [],
      is_active: true,
      sort_order: 1,
      has_screen: true,
      screen_enabled: true,
      screen_settings: {
        auto_bump_minutes: 30,
        display_mode: 'standard'
      },
      printer_settings: {
        paper_width: 80,
        auto_cut: true
      }
    });

    // CREATE DEFAULT POS SETTINGS
    await supabase.from('pos_settings').insert({
      business_id: businessId,
      tabs_enabled: true,
      default_tab_limit: 500.00,
      max_tab_limit: 1000.00,
      tab_limit_requires_manager: true,
      tab_warning_threshold: 0.8,
      tip_enabled: true,
      default_tip_percent: 0.15
    });

    await supabase.from('audit_logs').insert({
      user_id: user.id,
      event_type: 'user_created',
      details: {
        method: 'self_register',
        email: email,
        timestamp: new Date().toISOString(),
      },
    });

    // Redirect based on signup source
    if (signupSource === 'tavari-voice') {
      // For voice module signups, redirect directly to voice dashboard
      toast.success('Registration successful! Redirecting to your voice agent dashboard...');
      navigate('/tavari-voice/dashboard');
    } else {
      // For regular signups, redirect to login
      toast.success('Registration successful! Please log in.');
      navigate('/login');
    }
    setIsLoading(false);
  };

  const styles = {
    container: {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.xl
    },
    card: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      boxShadow: TavariStyles.shadows?.lg || '0 10px 25px rgba(0,0,0,0.1)',
      padding: TavariStyles.spacing['4xl'],
      maxWidth: '500px',
      width: '100%',
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      textAlign: 'center',
      marginBottom: TavariStyles.spacing.xs,
      margin: '0 0 8px 0'
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      textAlign: 'center',
      marginBottom: TavariStyles.spacing['2xl']
    },
    inputGroup: {
      marginBottom: TavariStyles.spacing.lg
    },
    label: {
      display: 'block',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs
    },
    input: {
      width: '100%',
      padding: '12px 16px',
      fontSize: TavariStyles.typography.fontSize.md,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      outline: 'none',
      transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
      boxSizing: 'border-box'
    },
    passwordContainer: {
      position: 'relative',
      width: '100%'
    },
    passwordToggle: {
      position: 'absolute',
      right: '12px',
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: TavariStyles.colors.gray500,
      fontSize: TavariStyles.typography.fontSize.sm,
      zIndex: 1
    },
    errorMessage: {
      color: TavariStyles.colors.danger,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginBottom: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.errorBg,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      border: `1px solid ${TavariStyles.colors.danger}`,
      textAlign: 'center'
    },
    registerButton: {
      width: '100%',
      padding: '14px',
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      cursor: isLoading ? 'not-allowed' : 'pointer',
      marginTop: TavariStyles.spacing.lg,
      transition: 'background-color 0.2s ease, transform 0.1s ease',
      opacity: isLoading ? 0.6 : 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.sm
    },
    loginText: {
      marginTop: TavariStyles.spacing.xl,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      textAlign: 'center'
    },
    loginLink: {
      color: TavariStyles.colors.primary,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      textDecoration: 'underline',
      transition: TavariStyles.transitions.normal
    },
    passwordRequirements: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs,
      lineHeight: 1.4
    },
    loadingSpinner: {
      display: 'inline-block',
      width: '16px',
      height: '16px',
      border: '2px solid #ffffff40',
      borderTop: '2px solid #ffffff',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite'
    }
  };

  return (
    <SecurityWrapper>
      <div style={styles.container}>
        <style>
          {`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}
        </style>

        <div style={styles.card}>
          <h2 style={styles.title}>Create Account</h2>
          <p style={styles.subtitle}>Join Tavari and start managing your business</p>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Full Name *</label>
            <input
              style={styles.input}
              type="text"
              placeholder="Enter your full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={isLoading}
              maxLength={100}
              onFocus={(e) => {
                e.target.style.borderColor = TavariStyles.colors.primary;
                e.target.style.boxShadow = `0 0 0 2px ${TavariStyles.colors.primary}20`;
              }}
              onBlur={(e) => {
                e.target.style.borderColor = TavariStyles.colors.gray300;
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Phone Number</label>
            <input
              style={styles.input}
              type="tel"
              placeholder="Enter your phone number (optional)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={isLoading}
              maxLength={20}
              onFocus={(e) => {
                e.target.style.borderColor = TavariStyles.colors.primary;
                e.target.style.boxShadow = `0 0 0 2px ${TavariStyles.colors.primary}20`;
              }}
              onBlur={(e) => {
                e.target.style.borderColor = TavariStyles.colors.gray300;
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Email Address *</label>
            <input
              style={styles.input}
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              maxLength={254}
              onFocus={(e) => {
                e.target.style.borderColor = TavariStyles.colors.primary;
                e.target.style.boxShadow = `0 0 0 2px ${TavariStyles.colors.primary}20`;
              }}
              onBlur={(e) => {
                e.target.style.borderColor = TavariStyles.colors.gray300;
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Password *</label>
            <div style={styles.passwordContainer}>
              <input
                style={{...styles.input, paddingRight: '40px'}}
                type={showPassword ? 'text' : 'password'}
                placeholder="Create a strong password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                maxLength={128}
                onFocus={(e) => {
                  e.target.style.borderColor = TavariStyles.colors.primary;
                  e.target.style.boxShadow = `0 0 0 2px ${TavariStyles.colors.primary}20`;
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = TavariStyles.colors.gray300;
                  e.target.style.boxShadow = 'none';
                }}
              />
              <button
                type="button"
                style={styles.passwordToggle}
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                disabled={isLoading}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <div style={styles.passwordRequirements}>
              Min. 10 characters, 1 uppercase, 1 special character
            </div>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Confirm Password *</label>
            <div style={styles.passwordContainer}>
              <input
                style={{...styles.input, paddingRight: '40px'}}
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isLoading}
                maxLength={128}
                onFocus={(e) => {
                  e.target.style.borderColor = TavariStyles.colors.primary;
                  e.target.style.boxShadow = `0 0 0 2px ${TavariStyles.colors.primary}20`;
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = TavariStyles.colors.gray300;
                  e.target.style.boxShadow = 'none';
                }}
              />
              <button
                type="button"
                style={styles.passwordToggle}
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                tabIndex={-1}
                disabled={isLoading}
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>4-Digit PIN *</label>
            <input
              style={styles.input}
              type="password"
              placeholder="Create a 4-digit PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              maxLength={4}
              disabled={isLoading}
              onFocus={(e) => {
                e.target.style.borderColor = TavariStyles.colors.primary;
                e.target.style.boxShadow = `0 0 0 2px ${TavariStyles.colors.primary}20`;
              }}
              onBlur={(e) => {
                e.target.style.borderColor = TavariStyles.colors.gray300;
                e.target.style.boxShadow = 'none';
              }}
            />
            <div style={styles.passwordRequirements}>
              Used for quick authentication and sensitive actions
            </div>
          </div>

          {errorMsg && (
            <div style={styles.errorMessage}>
              {errorMsg}
            </div>
          )}

          <button
            style={styles.registerButton}
            onClick={handleRegister}
            disabled={isLoading}
            onMouseOver={(e) => {
              if (!isLoading) {
                e.target.style.backgroundColor = TavariStyles.colors.primaryHover || '#0d7377';
                e.target.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseOut={(e) => {
              e.target.style.backgroundColor = TavariStyles.colors.primary;
              e.target.style.transform = 'translateY(0)';
            }}
          >
            {isLoading && <span style={styles.loadingSpinner}></span>}
            {isLoading ? 'Creating Account...' : 'Create Account'}
          </button>

          <p style={styles.loginText}>
            Already have an account?{' '}
            <span
              style={styles.loginLink}
              onClick={() => !isLoading && navigate('/login')}
              onMouseOver={(e) => {
                if (!isLoading) e.target.style.color = TavariStyles.colors.primaryHover || '#0d7377';
              }}
              onMouseOut={(e) => {
                e.target.style.color = TavariStyles.colors.primary;
              }}
            >
              Sign In
            </span>
          </p>
        </div>
      </div>
    </SecurityWrapper>
  );
};

export default Register;