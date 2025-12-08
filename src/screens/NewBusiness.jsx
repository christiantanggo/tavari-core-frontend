// src/screens/NewBusiness.jsx - WITH SESSION DEBUG + DB FUNCTION APPROACH
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { SecurityWrapper, useSecurityContext } from '../Security';
import { usePOSAuth } from '../hooks/usePOSAuth';
import { usePermissions } from '../hooks/usePermissions';
import { useBusinessContext } from '../contexts/BusinessContext';
import { TavariStyles } from '../utils/TavariStyles';
import SessionManager from '../components/SessionManager';
import toast from 'react-hot-toast';

const NewBusiness = () => {
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { setSelectedBusinessId } = useBusinessContext();

  // Security context for business creation
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'NewBusiness',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication - only authenticated users can create businesses
  const {
    authUser,
    authLoading
  } = usePOSAuth({
    requiredRoles: [],
    requireBusiness: false,
    componentName: 'NewBusiness'
  });

  // Permission checks
  const { 
    hasPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  const handleCreateBusiness = async () => {
    console.log('🚀 === START: handleCreateBusiness ===');

    if (isLoading) return;

    setError('');
    setIsLoading(true);

    try {
      // Rate limiting
      const rateLimitResult = await checkRateLimit('create_business', authUser?.id);
      if (!rateLimitResult.allowed) {
        setError('Too many business creation attempts. Please wait before trying again.');
        toast.error('Rate limit exceeded');
        setIsLoading(false);
        return;
      }

      // Validate business name
      if (!businessName || businessName.trim().length < 2) {
        setError('Business name must be at least 2 characters');
        setIsLoading(false);
        return;
      }

      const sanitizedName = businessName.trim();

      // CHECK SESSION STATUS
      console.log('🔍 === CHECKING SESSION STATUS ===');
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      
      console.log('Session exists:', !!sessionData?.session);
      console.log('Session user ID:', sessionData?.session?.user?.id);
      console.log('Session user email:', sessionData?.session?.user?.email);
      console.log('Auth user ID (hook):', authUser?.id);
      console.log('IDs match:', sessionData?.session?.user?.id === authUser?.id);
      console.log('Access token exists:', !!sessionData?.session?.access_token);
      console.log('Access token (first 30):', sessionData?.session?.access_token?.substring(0, 30));
      
      if (sessionError) {
        console.error('Session error:', sessionError);
      }

      if (!sessionData?.session) {
        console.error('❌ NO SESSION FOUND!');
        throw new Error('Your session has expired. Please refresh the page and try again.');
      }

      // USE DATABASE FUNCTION INSTEAD OF DIRECT INSERT
      console.log('🏢 Creating business using database function...');
      const { data: result, error: functionError } = await supabase.rpc('create_business_for_user', {
        p_user_id: authUser?.id,
        p_business_name: sanitizedName
      });

      console.log('Function result:', result);
      console.log('Function error:', functionError);

      if (functionError) {
        console.error('Function error:', functionError);
        throw new Error('Failed to create business: ' + functionError.message);
      }

      if (!result || !result.business_id) {
        throw new Error('Failed to create business - no ID returned');
      }

      const newBusinessId = result.business_id;
      console.log('✅ Business created! ID:', newBusinessId);

      // Set business context
      setSelectedBusinessId(newBusinessId);
      localStorage.setItem('currentBusinessId', newBusinessId);
      localStorage.setItem('selectedBusinessId', newBusinessId);

      toast.success(`Business "${sanitizedName}" created successfully!`);
      navigate('/dashboard/home');

    } catch (error) {
      console.error('❌ Business creation failed:', error);
      setError(error.message || 'Failed to create business');
      toast.error('Failed to create business: ' + error.message);
    } finally {
      setIsLoading(false);
    }
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
    header: {
      textAlign: 'center',
      marginBottom: TavariStyles.spacing['2xl']
    },
    icon: {
      fontSize: '48px',
      marginBottom: TavariStyles.spacing.md
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs,
      margin: '0 0 8px 0'
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      lineHeight: 1.5
    },
    inputGroup: {
      marginBottom: TavariStyles.spacing.xl
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
    inputError: {
      borderColor: TavariStyles.colors.danger,
      boxShadow: `0 0 0 2px ${TavariStyles.colors.danger}20`
    },
    errorMessage: {
      color: TavariStyles.colors.danger,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginTop: TavariStyles.spacing.xs,
      padding: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.errorBg,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      border: `1px solid ${TavariStyles.colors.danger}`
    },
    buttonGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.xl
    },
    createButton: {
      flex: 1,
      padding: '14px',
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      cursor: isLoading ? 'not-allowed' : 'pointer',
      transition: 'background-color 0.2s ease, transform 0.1s ease',
      opacity: isLoading ? 0.6 : 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.sm
    },
    cancelButton: {
      flex: 1,
      padding: '14px',
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700,
      border: `2px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: isLoading ? 'not-allowed' : 'pointer',
      transition: 'all 0.2s ease'
    },
    infoBox: {
      backgroundColor: '#e3f2fd',
      border: '1px solid #2196F3',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.lg,
      fontSize: TavariStyles.typography.fontSize.xs,
      color: '#1976D2',
      lineHeight: 1.5
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

  if (authLoading || permissionsLoading) {
    return (
      <SessionManager>
        <div style={styles.container}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '32px',
              height: '32px',
              border: '3px solid #14B8A6',
              borderTop: '3px solid transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 8px auto'
            }}></div>
            <p style={{ color: '#6b7280' }}>Loading...</p>
          </div>
        </div>
      </SessionManager>
    );
  }

  return (
    <SecurityWrapper>
      <SessionManager>
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
            <div style={styles.header}>
              <div style={styles.icon}>🏢</div>
              <h2 style={styles.title}>Create New Business</h2>
              <p style={styles.subtitle}>
                Set up your new business and start managing it right away
              </p>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Business Name *</label>
              <input
                type="text"
                placeholder="Enter your business name"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                disabled={isLoading}
                maxLength={100}
                style={{
                  ...styles.input,
                  ...(error && !businessName.trim() ? styles.inputError : {})
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = TavariStyles.colors.primary;
                  e.target.style.boxShadow = `0 0 0 2px ${TavariStyles.colors.primary}20`;
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = TavariStyles.colors.gray300;
                  e.target.style.boxShadow = 'none';
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !isLoading && businessName.trim()) {
                    handleCreateBusiness();
                  }
                }}
              />
              <div style={{
                fontSize: TavariStyles.typography.fontSize.xs,
                color: TavariStyles.colors.gray500,
                marginTop: TavariStyles.spacing.xs
              }}>
                {businessName.length}/100 characters
              </div>
            </div>

            {error && (
              <div style={styles.errorMessage}>
                {error}
              </div>
            )}

            <div style={styles.buttonGroup}>
              <button
                style={styles.cancelButton}
                onClick={() => !isLoading && navigate('/dashboard/home')}
                disabled={isLoading}
                onMouseOver={(e) => {
                  if (!isLoading) {
                    e.target.style.backgroundColor = TavariStyles.colors.gray50;
                    e.target.style.borderColor = TavariStyles.colors.gray400;
                  }
                }}
                onMouseOut={(e) => {
                  e.target.style.backgroundColor = TavariStyles.colors.white;
                  e.target.style.borderColor = TavariStyles.colors.gray300;
                }}
              >
                Cancel
              </button>

              <button
                style={styles.createButton}
                onClick={handleCreateBusiness}
                disabled={isLoading || !businessName.trim()}
                onMouseOver={(e) => {
                  if (!isLoading && businessName.trim()) {
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
                {isLoading ? 'Creating...' : 'Create Business'}
              </button>
            </div>

            <div style={styles.infoBox}>
              <strong>ℹ️ What happens next?</strong>
              <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                <li>You'll be assigned as the business owner</li>
                <li>You'll get full access to all features</li>
                <li>You can add employees and managers</li>
                <li>Your business will be ready to use immediately</li>
              </ul>
            </div>
          </div>
        </div>
      </SessionManager>
    </SecurityWrapper>
  );
};

export default NewBusiness;