// Step 92: Create AppBuilderDeploymentScreen.jsx
// Deployment management (store listings, submission status) - Tavari Standards
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Store, Upload } from 'lucide-react';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useAppBuilderStore } from '../../hooks/useAppBuilderStore';
import SecurityWrapper from '../../Security/SecurityWrapper.jsx';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePermissions } from '../../hooks/usePermissions';
import AppBuilderStoreListingForm from '../../components/AppBuilder/AppBuilderStoreListingForm';
import AppBuilderDeploymentStatus from '../../components/AppBuilder/AppBuilderDeploymentStatus';
import { TavariStyles } from '../../utils/TavariStyles';
import { getContainerStyles, getCenteredContentStyles } from '../../utils/tavariLayoutUtils';

// Get styles function
const getStyles = () => {
  try {
    return {
      container: {
        minHeight: '100vh',
        backgroundColor: TavariStyles?.colors?.gray50 || '#f9fafb',
        ...getContainerStyles()
      },
      loadingContainer: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: TavariStyles?.colors?.gray50 || '#f9fafb'
      },
      loadingContent: {
        textAlign: 'center'
      },
      spinner: {
        width: '48px',
        height: '48px',
        border: `3px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
        borderTop: `3px solid ${TavariStyles?.colors?.primary || '#008080'}`,
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        margin: '0 auto'
      },
      loadingText: {
        marginTop: TavariStyles?.spacing?.lg || '16px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px'
      },
      content: {
        ...getCenteredContentStyles('1400px')
      },
      header: {
        marginBottom: TavariStyles?.spacing?.xl || '20px'
      },
      backButton: {
        display: 'flex',
        alignItems: 'center',
        gap: TavariStyles?.spacing?.sm || '8px',
        backgroundColor: 'transparent',
        border: 'none',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        cursor: 'pointer',
        marginBottom: TavariStyles?.spacing?.md || '12px',
        padding: TavariStyles?.spacing?.xs || '4px'
      },
      title: {
        fontSize: TavariStyles?.typography?.fontSize?.['3xl'] || '24px',
        fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        marginBottom: TavariStyles?.spacing?.sm || '8px',
        margin: 0
      },
      subtitle: {
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        margin: 0
      },
      platformCard: {
        backgroundColor: TavariStyles?.colors?.white || '#ffffff',
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        boxShadow: TavariStyles?.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
        padding: TavariStyles?.spacing?.xl || '20px',
        marginBottom: TavariStyles?.spacing?.xl || '20px'
      },
      platformHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: TavariStyles?.spacing?.md || '12px'
      },
      platformTitle: {
        fontSize: TavariStyles?.typography?.fontSize?.xl || '18px',
        fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        margin: 0,
        display: 'flex',
        alignItems: 'center',
        gap: TavariStyles?.spacing?.sm || '8px'
      }
    };
  } catch (e) {
    console.error('Error in getStyles:', e);
    return {};
  }
};

const AppBuilderDeploymentScreen = () => {
  const navigate = useNavigate();
  const styles = useMemo(() => getStyles(), []);

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'AppBuilderDeploymentScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();

  // Store hooks
  const iosListing = useAppBuilderStore('ios');
  const androidListing = useAppBuilderStore('android');

  const canDeploy = hasPermission('appbuilder.deploy.manage') || hasElevatedPrivileges();

  if (auth.authLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingContent}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>Loading deployments...</p>
        </div>
      </div>
    );
  }

  return (
    <SecurityWrapper>
      <div style={styles.container}>
        <div style={styles.content}>
          {/* Header */}
          <div style={styles.header}>
            <button
              onClick={() => navigate('/appbuilder')}
              style={styles.backButton}
            >
              <ArrowLeft size={20} />
              <span>Back to Dashboard</span>
            </button>
            <h1 style={styles.title}>App Deployment</h1>
            <p style={styles.subtitle}>Manage store listings and deployments</p>
          </div>

          {/* iOS Section */}
          <div style={styles.platformCard}>
            <div style={styles.platformHeader}>
              <h2 style={styles.platformTitle}>
                <Store size={20} />
                iOS App Store
              </h2>
            </div>
            <AppBuilderDeploymentStatus platform="ios" />
            <PermissionGate permission="appbuilder.deploy.manage">
              <div style={{ marginTop: TavariStyles?.spacing?.xl || '20px' }}>
                <AppBuilderStoreListingForm
                  platform="ios"
                  listing={iosListing?.listing}
                  onUpdate={iosListing?.updateListing}
                  canEdit={canDeploy}
                />
              </div>
            </PermissionGate>
          </div>

          {/* Android Section */}
          <div style={styles.platformCard}>
            <div style={styles.platformHeader}>
              <h2 style={styles.platformTitle}>
                <Store size={20} />
                Google Play Store
              </h2>
            </div>
            <AppBuilderDeploymentStatus platform="android" />
            <PermissionGate permission="appbuilder.deploy.manage">
              <div style={{ marginTop: TavariStyles?.spacing?.xl || '20px' }}>
                <AppBuilderStoreListingForm
                  platform="android"
                  listing={androidListing?.listing}
                  onUpdate={androidListing?.updateListing}
                  canEdit={canDeploy}
                />
              </div>
            </PermissionGate>
          </div>
        </div>
      </div>
    </SecurityWrapper>
  );
};

// Add CSS animation for spinner
if (typeof document !== 'undefined') {
  const existingStyle = document.querySelector('#deployment-spinner-animation');
  if (!existingStyle) {
    const style = document.createElement('style');
    style.id = 'deployment-spinner-animation';
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

export default AppBuilderDeploymentScreen;
