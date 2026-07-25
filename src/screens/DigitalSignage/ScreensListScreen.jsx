// src/screens/DigitalSignage/ScreensListScreen.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiMonitor, FiPlus, FiEdit, FiTrash2, FiRefreshCw, FiWifi, FiWifiOff, FiEye } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';
import useDigitalSignage from '../../hooks/useDigitalSignage';
import ScreenRegistrationModal from '../../components/DigitalSignage/ScreenRegistrationModal';

const ScreensListScreen = ({ embedded = false }) => {
  const navigate = useNavigate();
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [selectedScreen, setSelectedScreen] = useState(null);

  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'ScreensListScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();

  const {
    screens,
    loading,
    error,
    loadScreens,
    createScreen,
    updateScreen,
    deleteScreen
  } = useDigitalSignage();

  useEffect(() => {
    if (auth.selectedBusinessId) {
      loadScreens();
    }
  }, [auth.selectedBusinessId]);

  const canCreate = hasPermission('digital_signage.screens.edit') || hasElevatedPrivileges();
  const canEdit = hasPermission('digital_signage.screens.edit') || hasElevatedPrivileges();
  const canDelete = hasPermission('digital_signage.screens.edit') || hasElevatedPrivileges();

  const handleCreate = async (screenData) => {
    try {
      await createScreen(screenData);
      setShowRegisterModal(false);
      toast.success('Screen registered successfully');
    } catch (err) {
      toast.error(`Failed to register screen: ${err.message}`);
    }
  };

  const handleUpdate = async (screenData) => {
    if (!selectedScreen?.id) return;
    try {
      await updateScreen(selectedScreen.id, {
        screen_name: screenData.name,
        screen_type: screenData.type,
        location_name: screenData.locationName || null,
        resolution_width: screenData.resolutionWidth ? parseInt(screenData.resolutionWidth, 10) : null,
        resolution_height: screenData.resolutionHeight ? parseInt(screenData.resolutionHeight, 10) : null,
        orientation: screenData.orientation,
        group_id: screenData.groupId || null,
        settings: screenData.settings || {}
      });
      setSelectedScreen(null);
    } catch (err) {
      toast.error(`Failed to update screen: ${err.message}`);
    }
  };

  const closeScreenModal = () => {
    setShowRegisterModal(false);
    setSelectedScreen(null);
  };

  const handleDelete = async (screenId) => {
    if (!window.confirm('Are you sure you want to delete this screen?')) {
      return;
    }

    try {
      await deleteScreen(screenId);
      toast.success('Screen deleted successfully');
    } catch (err) {
      toast.error(`Failed to delete screen: ${err.message}`);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'online':
        return TavariStyles.colors.success;
      case 'offline':
        return TavariStyles.colors.danger;
      case 'maintenance':
        return TavariStyles.colors.warning;
      default:
        return TavariStyles.colors.gray400;
    }
  };

  const styles = {
    container: {
      ...TavariStyles.layouts.container,
      padding: embedded ? 0 : TavariStyles.spacing.xl,
      paddingTop: embedded ? 0 : undefined
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      ...TavariStyles.typography.heading.h1
    },
    button: {
      ...TavariStyles.components.button.primary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    card: {
      ...TavariStyles.components.card,
      padding: TavariStyles.spacing.lg
    },
    cardHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'start',
      marginBottom: TavariStyles.spacing.md
    },
    cardTitle: {
      ...TavariStyles.typography.heading.h3,
      marginBottom: TavariStyles.spacing.xs
    },
    statusBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.full,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    cardActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.md
    },
    actionButton: {
      ...TavariStyles.components.button.secondary,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`
    },
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['4xl'],
      color: TavariStyles.colors.gray600
    }
  };

  const contentView = (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>
          <FiMonitor style={{ marginRight: TavariStyles.spacing.sm, verticalAlign: 'middle' }} />
          Screens
        </h1>
        {canCreate && (
          <button
            style={styles.button}
            onClick={() => setShowRegisterModal(true)}
          >
            <FiPlus /> Register Screen
          </button>
        )}
      </div>

      {loading && <div>Loading screens...</div>}
      {error && <div style={{ color: TavariStyles.colors.danger }}>Error: {error}</div>}

      {!loading && screens.length === 0 && (
        <div style={styles.emptyState}>
          <FiMonitor size={64} style={{ marginBottom: TavariStyles.spacing.lg, opacity: 0.3 }} />
          <h3>No screens registered</h3>
          <p>Register your first screen to get started</p>
          {canCreate && (
            <button
              style={{ ...styles.button, marginTop: TavariStyles.spacing.lg }}
              onClick={() => setShowRegisterModal(true)}
            >
              <FiPlus /> Register Screen
            </button>
          )}
        </div>
      )}

      {!loading && screens.length > 0 && (
        <div style={styles.grid}>
          {screens.map((screen) => (
            <div key={screen.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <div>
                  <h3 style={styles.cardTitle}>{screen.screen_name}</h3>
                  {screen.location_name && (
                    <p style={{ ...TavariStyles.typography.body, color: TavariStyles.colors.gray600 }}>
                      {screen.location_name}
                    </p>
                  )}
                </div>
                <span
                  style={{
                    ...styles.statusBadge,
                    backgroundColor: `${getStatusColor(screen.status)}20`,
                    color: getStatusColor(screen.status)
                  }}
                >
                  {screen.status === 'online' ? <FiWifi /> : <FiWifiOff />}
                  {screen.status || 'unknown'}
                </span>
              </div>

              <div style={{ marginTop: TavariStyles.spacing.md }}>
                <p style={{ ...TavariStyles.typography.body, fontSize: TavariStyles.typography.fontSize.sm }}>
                  <strong>Key:</strong> {screen.screen_key}
                </p>
                {screen.resolution_width && screen.resolution_height && (
                  <p style={{ ...TavariStyles.typography.body, fontSize: TavariStyles.typography.fontSize.sm }}>
                    <strong>Resolution:</strong> {screen.resolution_width}x{screen.resolution_height}
                  </p>
                )}
                {screen.group && (
                  <p style={{ ...TavariStyles.typography.body, fontSize: TavariStyles.typography.fontSize.sm }}>
                    <strong>Group:</strong> {screen.group.group_name}
                  </p>
                )}
              </div>

              <div style={styles.cardActions}>
                <button
                  style={styles.actionButton}
                  onClick={() => navigate(`/dashboard/digital-signage/screens/${screen.id}`)}
                >
                  <FiEye /> View Details
                </button>
                {canEdit && (
                  <button
                    style={styles.actionButton}
                    onClick={() => setSelectedScreen(screen)}
                  >
                    <FiEdit /> Edit
                  </button>
                )}
                {canDelete && (
                  <button
                    style={{ ...styles.actionButton, color: TavariStyles.colors.danger }}
                    onClick={() => handleDelete(screen.id)}
                  >
                    <FiTrash2 /> Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(showRegisterModal || selectedScreen) && (
        <ScreenRegistrationModal
          screen={selectedScreen}
          onClose={closeScreenModal}
          onSubmit={selectedScreen ? handleUpdate : handleCreate}
        />
      )}
    </div>
  );

  if (embedded) {
    return contentView;
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper>
        <PermissionGate permission="digital_signage.screens.view">
          {contentView}
        </PermissionGate>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default ScreensListScreen;

