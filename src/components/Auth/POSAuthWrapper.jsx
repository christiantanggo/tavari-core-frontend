// components/Auth/POSAuthWrapper.jsx - Fixed Authentication Component
import React, { useEffect, useState } from 'react';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';

/**
 * Authentication wrapper component for POS screens
 * Handles loading states, errors, and renders children when authenticated
 * 
 * @param {Object} props
 * @param {React.ReactNode} props.children - Content to render when authenticated
 * @param {string[]} props.requiredRoles - Required user roles
 * @param {boolean} props.requireBusiness - Whether business selection is required
 * @param {string} props.componentName - Component name for logging
 * @param {React.ReactNode} props.loadingContent - Custom loading content
 * @param {React.ReactNode} props.errorContent - Custom error content
 * @param {Function} props.onAuthReady - Callback when auth is ready with auth state
 * @returns {React.ReactNode} Rendered component
 */
const POSAuthWrapper = ({
  children,
  requiredRoles = null,
  requireBusiness = true,
  componentName = 'POS Component',
  loadingContent = null,
  errorContent = null,
  onAuthReady = null
}) => {
  const auth = usePOSAuth({
    requiredRoles,
    requireBusiness,
    componentName
  });

  const [authReady, setAuthReady] = useState(false);

  // Call onAuthReady callback when authentication is complete and ready
  useEffect(() => {
    if (auth.isReady && !authReady) {
      setAuthReady(true);
      if (onAuthReady) {
        onAuthReady({
          selectedBusinessId: auth.selectedBusinessId,
          authUser: auth.authUser,
          userRole: auth.userRole,
          businessData: auth.businessData,
          ...auth
        });
      }
    }
  }, [auth.isReady, authReady, onAuthReady, auth]);

  // Create styles using TavariStyles
  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '60vh',
      padding: TavariStyles.spacing.xl,
      borderTop: '1px solid transparent',
      borderRight: '1px solid transparent',
      borderBottom: '1px solid transparent',
      borderLeft: '1px solid transparent'
    },
    
    loadingCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing['3xl'],
      textAlign: 'center',
      maxWidth: '500px',
      width: '100%'
    },
    
    errorCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing['3xl'],
      textAlign: 'center',
      maxWidth: '500px',
      width: '100%',
      border: `2px solid ${TavariStyles.colors.danger}`
    },
    
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.lg
    },
    
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xl
    },
    
    errorTitle: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.danger,
      marginBottom: TavariStyles.spacing.lg
    },
    
    errorMessage: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xl,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    
    spinner: {
      width: '40px',
      height: '40px',
      borderWidth: '4px',
      borderStyle: 'solid',
      borderColor: '#f3f4f6',
      borderTopColor: '#008080',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      margin: '0 auto 20px auto'
    },
    
    buttonGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      justifyContent: 'center',
      flexWrap: 'wrap'
    },
    
    primaryButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg
    },
    
    secondaryButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.lg
    },
    
    authInfo: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      marginTop: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      position: 'fixed',
      bottom: TavariStyles.spacing.md,
      right: TavariStyles.spacing.md,
      maxWidth: '300px'
    },
    
    authInfoRow: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: TavariStyles.spacing.xs
    },
    
    authInfoLabel: {
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    
    rolesBadge: {
      display: 'inline-block',
      padding: '4px 8px',
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginTop: TavariStyles.spacing.xs
    }
  };

  // Loading state
  if (auth.authLoading) {
    if (loadingContent) {
      return loadingContent;
    }

    return (
      <div style={styles.container}>
        <div style={styles.loadingCard}>
          <div style={styles.spinner}></div>
          <h3 style={styles.title}>Loading {componentName}...</h3>
          <p style={styles.subtitle}>
            Authenticating user and loading business data...
          </p>
          
          {/* Add CSS for spinner animation */}
          <style>
            {`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}
          </style>
        </div>
      </div>
    );
  }

  // Error state
  if (auth.authError) {
    if (errorContent) {
      return errorContent;
    }

    return (
      <div style={styles.container}>
        <div style={styles.errorCard}>
          <h3 style={styles.errorTitle}>Authentication Error</h3>
          <p style={styles.errorMessage}>{auth.authError}</p>
          
          <div style={styles.buttonGroup}>
            <button 
              style={styles.primaryButton}
              onClick={auth.goToLogin}
            >
              Return to Login
            </button>
            <button 
              style={styles.secondaryButton}
              onClick={auth.refreshAuth}
            >
              Retry Authentication
            </button>
            <button 
              style={styles.secondaryButton}
              onClick={auth.goToDashboard}
            >
              Go to Dashboard
            </button>
          </div>
          
          {auth.clearAuthError && (
            <button 
              style={{
                ...styles.secondaryButton,
                marginTop: TavariStyles.spacing.md
              }}
              onClick={auth.clearAuthError}
            >
              Clear Error
            </button>
          )}
        </div>
      </div>
    );
  }

  // Not ready state (shouldn't happen with proper auth flow)
  if (!auth.isReady) {
    return (
      <div style={styles.container}>
        <div style={styles.errorCard}>
          <h3 style={styles.errorTitle}>Setup Required</h3>
          <p style={styles.errorMessage}>
            Authentication is incomplete. Please ensure you are logged in and have selected a business.
          </p>
          
          <div style={styles.buttonGroup}>
            <button 
              style={styles.primaryButton}
              onClick={auth.goToDashboard}
            >
              Go to Dashboard
            </button>
            <button 
              style={styles.secondaryButton}
              onClick={auth.refreshAuth}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated and ready - render children
  return (
    <>
      {children}
      
      {/* Optional auth info panel for debugging */}
      {process.env.NODE_ENV === 'development' && (
        <div style={styles.authInfo}>
          <div style={styles.authInfoRow}>
            <span style={styles.authInfoLabel}>User:</span>
            <span>{auth.authUser?.email}</span>
          </div>
          <div style={styles.authInfoRow}>
            <span style={styles.authInfoLabel}>Business ID:</span>
            <span>{auth.selectedBusinessId?.slice(0, 8)}...</span>
          </div>
          <div style={styles.authInfoRow}>
            <span style={styles.authInfoLabel}>Role:</span>
            <span>{auth.userRole}</span>
          </div>
          {auth.businessData && (
            <div style={styles.authInfoRow}>
              <span style={styles.authInfoLabel}>Business:</span>
              <span>{auth.businessData.name}</span>
            </div>
          )}
          {requiredRoles && (
            <div>
              <span style={styles.authInfoLabel}>Required Roles:</span>
              <div style={styles.rolesBadge}>
                {Array.isArray(requiredRoles) ? requiredRoles.join(', ') : requiredRoles}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default POSAuthWrapper;