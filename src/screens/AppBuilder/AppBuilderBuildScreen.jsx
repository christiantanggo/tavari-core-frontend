// Step 91: Create AppBuilderBuildScreen.jsx
// Build management interface - Tavari Standards
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useAppBuilderBuilds } from '../../hooks/useAppBuilderBuilds';
import SecurityWrapper from '../../Security/SecurityWrapper.jsx';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePermissions } from '../../hooks/usePermissions';
import toast from 'react-hot-toast';
import AppBuilderBuildTrigger from '../../components/AppBuilder/AppBuilderBuildTrigger';
import AppBuilderBuildStatus from '../../components/AppBuilder/AppBuilderBuildStatus';
import AppBuilderBuildHistory from '../../components/AppBuilder/AppBuilderBuildHistory';
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
      sectionCard: {
        backgroundColor: TavariStyles?.colors?.white || '#ffffff',
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        boxShadow: TavariStyles?.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
        padding: TavariStyles?.spacing?.xl || '20px',
        marginBottom: TavariStyles?.spacing?.xl || '20px'
      },
      sectionTitle: {
        fontSize: TavariStyles?.typography?.fontSize?.xl || '18px',
        fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        marginBottom: TavariStyles?.spacing?.md || '12px',
        margin: 0
      }
    };
  } catch (e) {
    console.error('Error in getStyles:', e);
    return {};
  }
};

const AppBuilderBuildScreen = () => {
  const navigate = useNavigate();
  const styles = useMemo(() => getStyles(), []);

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'AppBuilderBuildScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();

  // Builds hook
  const { builds, currentBuild, loading, createBuild, cancelBuild, subscribeToBuild } = useAppBuilderBuilds();

  const canBuild = hasPermission('appbuilder.build.create') || hasElevatedPrivileges();

  React.useEffect(() => {
    if (currentBuild && subscribeToBuild) {
      try {
        const unsubscribe = subscribeToBuild(currentBuild.id, (updatedBuild) => {
          if (updatedBuild && updatedBuild.build_status === 'success') {
            toast.success('Build completed successfully!');
          } else if (updatedBuild && updatedBuild.build_status === 'failed') {
            toast.error('Build failed');
          }
        });
        return unsubscribe;
      } catch (error) {
        console.error('Error subscribing to build:', error);
      }
    }
  }, [currentBuild, subscribeToBuild]);

  if (auth.authLoading || loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingContent}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>Loading builds...</p>
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
            <h1 style={styles.title}>App Builds</h1>
            <p style={styles.subtitle}>Create and manage app builds</p>
          </div>

          {/* Current Build Status */}
          {currentBuild && (
            <div style={styles.sectionCard}>
              <h2 style={styles.sectionTitle}>Current Build</h2>
              <AppBuilderBuildStatus
                build={currentBuild}
                onCancel={canBuild && cancelBuild ? () => {
                  try {
                    cancelBuild(currentBuild.id);
                  } catch (error) {
                    console.error('Error cancelling build:', error);
                    toast.error('Failed to cancel build');
                  }
                } : null}
              />
            </div>
          )}

          {/* Build Trigger */}
          <PermissionGate permission="appbuilder.build.create">
            <div style={styles.sectionCard}>
              <h2 style={styles.sectionTitle}>Create New Build</h2>
              <AppBuilderBuildTrigger
                onCreate={createBuild}
                disabled={currentBuild?.build_status === 'building' || currentBuild?.build_status === 'queued'}
              />
            </div>
          </PermissionGate>

          {/* Build History */}
          <div style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>Build History</h2>
            <AppBuilderBuildHistory builds={builds} />
          </div>
        </div>
      </div>
    </SecurityWrapper>
  );
};

// Add CSS animation for spinner
if (typeof document !== 'undefined') {
  const existingStyle = document.querySelector('#build-spinner-animation');
  if (!existingStyle) {
    const style = document.createElement('style');
    style.id = 'build-spinner-animation';
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

export default AppBuilderBuildScreen;
