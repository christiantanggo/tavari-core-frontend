// src/screens/DigitalSignage/PartyHostManagementScreen.jsx
import React, { useState, useEffect } from 'react';
import { FiUsers, FiPlus, FiEdit, FiTrash2, FiClock, FiImage, FiCalendar } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';
import { usePartyHost } from '../../hooks/usePartyHost';
import useDigitalSignage from '../../hooks/useDigitalSignage';
import PartyHostFormModal from '../../components/DigitalSignage/PartyHostFormModal';

const PartyHostManagementScreen = () => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedHost, setSelectedHost] = useState(null);

  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'PartyHostManagementScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();

  const {
    partyHosts,
    availableEvents,
    loading,
    error,
    loadPartyHosts,
    loadAvailableEvents,
    createPartyHost,
    updatePartyHost,
    deletePartyHost
  } = usePartyHost();

  const {
    screens,
    loadScreens
  } = useDigitalSignage();

  useEffect(() => {
    if (auth.selectedBusinessId) {
      loadPartyHosts();
      loadAvailableEvents();
      loadScreens();
    }
  }, [auth.selectedBusinessId]);

  const canCreate = hasPermission('digital_signage.content.edit') || hasElevatedPrivileges();
  const canEdit = hasPermission('digital_signage.content.edit') || hasElevatedPrivileges();
  const canDelete = hasPermission('digital_signage.content.edit') || hasElevatedPrivileges();

  const mapHostFormToDb = (hostData) => ({
    host_name: hostData.name,
    screen_id: hostData.screenId || null,
    scheduling_event_id: hostData.eventId || null,
    theme_color: hostData.themeColor,
    background_color: hostData.backgroundColor,
    background_image_url: hostData.backgroundImageUrl || null,
    font_family: hostData.fontFamily,
    show_countdown: hostData.showCountdown,
    countdown_target_time: hostData.countdownTargetTime || null,
    countdown_label: hostData.countdownLabel,
    allow_photo_uploads: hostData.allowPhotoUploads,
    max_photos: hostData.maxPhotos,
    photo_display_duration_seconds: hostData.photoDisplayDuration
  });

  const handleCreate = async (hostData) => {
    try {
      if (selectedHost?.id) {
        await updatePartyHost(selectedHost.id, mapHostFormToDb(hostData));
      } else {
        await createPartyHost(hostData);
      }
      setShowCreateModal(false);
      setSelectedHost(null);
    } catch (err) {
      toast.error(`Failed to save party host: ${err.message}`);
    }
  };

  const handleDelete = async (hostId) => {
    if (!window.confirm('Are you sure you want to delete this party host?')) {
      return;
    }

    try {
      await deletePartyHost(hostId);
      toast.success('Party host deleted successfully');
    } catch (err) {
      toast.error(`Failed to delete party host: ${err.message}`);
    }
  };

  const formatEventDate = (event) => {
    if (!event) return 'Not connected';
    const date = new Date(event.event_date);
    return date.toLocaleDateString();
  };

  const styles = {
    container: {
      ...TavariStyles.layouts.container,
      padding: TavariStyles.spacing.xl
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
    cardMeta: {
      ...TavariStyles.typography.body,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xs,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    statusBadge: {
      display: 'inline-flex',
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.full,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      backgroundColor: `${TavariStyles.colors.success}20`,
      color: TavariStyles.colors.success
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

  return (
    <SecurityWrapper>
      <POSAuthWrapper>
        <PermissionGate permission="digital_signage.content.view">
          <div style={styles.container}>
            <div style={styles.header}>
              <h1 style={styles.title}>
                <FiUsers style={{ marginRight: TavariStyles.spacing.sm, verticalAlign: 'middle' }} />
                Party Hosts
              </h1>
              {canCreate && (
                <button
                  style={styles.button}
                  onClick={() => setShowCreateModal(true)}
                >
                  <FiPlus /> Create Party Host
                </button>
              )}
            </div>

            {loading && <div>Loading party hosts...</div>}
            {error && <div style={{ color: TavariStyles.colors.danger }}>Error: {error}</div>}

            {!loading && partyHosts.length === 0 && (
              <div style={styles.emptyState}>
                <FiUsers size={64} style={{ marginBottom: TavariStyles.spacing.lg, opacity: 0.3 }} />
                <h3>No party hosts created</h3>
                <p>Create your first party host to manage party room displays</p>
                {canCreate && (
                  <button
                    style={{ ...styles.button, marginTop: TavariStyles.spacing.lg }}
                    onClick={() => setShowCreateModal(true)}
                  >
                    <FiPlus /> Create Party Host
                  </button>
                )}
              </div>
            )}

            {!loading && partyHosts.length > 0 && (
              <div style={styles.grid}>
                {partyHosts.map((host) => (
                  <div key={host.id} style={styles.card}>
                    <div style={styles.cardHeader}>
                      <div>
                        <h3 style={styles.cardTitle}>{host.host_name}</h3>
                        {host.is_published && (
                          <span style={styles.statusBadge}>Published</span>
                        )}
                      </div>
                    </div>

                    {host.screen && (
                      <div style={styles.cardMeta}>
                        <FiCalendar />
                        Screen: {host.screen.screen_name}
                      </div>
                    )}
                    {host.show_countdown && (
                      <div style={styles.cardMeta}>
                        <FiClock />
                        Countdown: {host.countdown_label}
                      </div>
                    )}
                    {host.allow_photo_uploads && (
                      <div style={styles.cardMeta}>
                        <FiImage />
                        Photo uploads enabled
                      </div>
                    )}

                    {(canEdit || canDelete) && (
                      <div style={styles.cardActions}>
                        {canEdit && (
                          <button
                            style={styles.actionButton}
                            onClick={() => {
                              setSelectedHost(host);
                              setShowCreateModal(true);
                            }}
                          >
                            <FiEdit /> Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            style={{ ...styles.actionButton, color: TavariStyles.colors.danger }}
                            onClick={() => handleDelete(host.id)}
                          >
                            <FiTrash2 /> Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {showCreateModal && (
              <PartyHostFormModal
                onClose={() => {
                  setShowCreateModal(false);
                  setSelectedHost(null);
                }}
                onSubmit={handleCreate}
                host={selectedHost}
                screens={screens}
                events={availableEvents}
              />
            )}
          </div>
        </PermissionGate>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default PartyHostManagementScreen;



