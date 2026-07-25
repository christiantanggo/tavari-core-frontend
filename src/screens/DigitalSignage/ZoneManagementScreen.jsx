// src/screens/DigitalSignage/ZoneManagementScreen.jsx
import React, { useState, useEffect } from 'react';
import { FiLayers, FiPlus, FiEdit, FiTrash2, FiMonitor } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';
import useDigitalSignage from '../../hooks/useDigitalSignage';
import ZoneFormModal from '../../components/DigitalSignage/ZoneFormModal';

const ZoneManagementScreen = () => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedZone, setSelectedZone] = useState(null);
  const [selectedScreen, setSelectedScreen] = useState(null);

  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'ZoneManagementScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();

  const {
    zones,
    screens,
    loading,
    error,
    loadZones,
    loadScreens,
    createZone,
    updateZone,
    deleteZone
  } = useDigitalSignage();

  useEffect(() => {
    if (auth.selectedBusinessId) {
      loadZones({ screenId: selectedScreen });
      loadScreens();
    }
  }, [auth.selectedBusinessId, selectedScreen]);

  const canCreate = hasPermission('digital_signage.zones.edit') || hasElevatedPrivileges();
  const canEdit = hasPermission('digital_signage.zones.edit') || hasElevatedPrivileges();
  const canDelete = hasPermission('digital_signage.zones.edit') || hasElevatedPrivileges();

  const mapZoneFormToDb = (zoneData) => ({
    zone_name: zoneData.name,
    screen_id: zoneData.screenId || null,
    position_x: zoneData.positionX,
    position_y: zoneData.positionY,
    width: zoneData.width,
    height: zoneData.height,
    position_unit: zoneData.positionUnit,
    z_index: zoneData.zIndex,
    background_color: zoneData.backgroundColor || null
  });

  const handleCreate = async (zoneData) => {
    try {
      await createZone(zoneData);
      setShowCreateModal(false);
      toast.success('Zone created successfully');
    } catch (err) {
      toast.error(`Failed to create zone: ${err.message}`);
    }
  };

  const handleUpdate = async (zoneData) => {
    if (!selectedZone?.id) return;
    try {
      await updateZone(selectedZone.id, mapZoneFormToDb(zoneData));
      setSelectedZone(null);
    } catch (err) {
      toast.error(`Failed to update zone: ${err.message}`);
    }
  };

  const closeZoneModal = () => {
    setShowCreateModal(false);
    setSelectedZone(null);
  };

  const handleDelete = async (zoneId) => {
    if (!window.confirm('Are you sure you want to delete this zone?')) {
      return;
    }

    try {
      await deleteZone(zoneId);
      toast.success('Zone deleted successfully');
    } catch (err) {
      toast.error(`Failed to delete zone: ${err.message}`);
    }
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
    filterBar: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md
    },
    filterSelect: {
      ...TavariStyles.components.input,
      padding: TavariStyles.spacing.sm,
      minWidth: '200px'
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
      marginBottom: TavariStyles.spacing.xs
    },
    zonePreview: {
      width: '100%',
      height: '150px',
      backgroundColor: TavariStyles.colors.gray100,
      borderRadius: TavariStyles.borderRadius.sm,
      marginBottom: TavariStyles.spacing.md,
      border: `2px dashed ${TavariStyles.colors.gray300}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative'
    },
    zoneBox: {
      position: 'absolute',
      border: `2px solid ${TavariStyles.colors.primary}`,
      backgroundColor: `${TavariStyles.colors.primary}20`
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
        <PermissionGate permission="digital_signage.zones.view">
          <div style={styles.container}>
            <div style={styles.header}>
              <h1 style={styles.title}>
                <FiLayers style={{ marginRight: TavariStyles.spacing.sm, verticalAlign: 'middle' }} />
                Zones
              </h1>
              {canCreate && (
                <button
                  style={styles.button}
                  onClick={() => setShowCreateModal(true)}
                >
                  <FiPlus /> Create Zone
                </button>
              )}
            </div>

            <div style={styles.filterBar}>
              <select
                style={styles.filterSelect}
                value={selectedScreen || ''}
                onChange={(e) => setSelectedScreen(e.target.value || null)}
              >
                <option value="">All Screens</option>
                {screens.map(screen => (
                  <option key={screen.id} value={screen.id}>
                    {screen.screen_name}
                  </option>
                ))}
              </select>
            </div>

            {loading && <div>Loading zones...</div>}
            {error && <div style={{ color: TavariStyles.colors.danger }}>Error: {error}</div>}

            {!loading && zones.length === 0 && (
              <div style={styles.emptyState}>
                <FiLayers size={64} style={{ marginBottom: TavariStyles.spacing.lg, opacity: 0.3 }} />
                <h3>No zones created</h3>
                <p>Create zones to organize content on screens</p>
                {canCreate && (
                  <button
                    style={{ ...styles.button, marginTop: TavariStyles.spacing.lg }}
                    onClick={() => setShowCreateModal(true)}
                  >
                    <FiPlus /> Create Zone
                  </button>
                )}
              </div>
            )}

            {!loading && zones.length > 0 && (
              <div style={styles.grid}>
                {zones.map((zone) => (
                  <div key={zone.id} style={styles.card}>
                    <div style={styles.cardHeader}>
                      <h3 style={styles.cardTitle}>{zone.zone_name}</h3>
                    </div>

                    <div style={styles.zonePreview}>
                      <div
                        style={{
                          ...styles.zoneBox,
                          left: `${(zone.position_x / 1920) * 100}%`,
                          top: `${(zone.position_y / 1080) * 100}%`,
                          width: `${(zone.width / 1920) * 100}%`,
                          height: `${(zone.height / 1080) * 100}%`
                        }}
                      />
                    </div>

                    <div style={styles.cardMeta}>
                      <div><strong>Size:</strong> {zone.width} × {zone.height} {zone.position_unit}</div>
                      <div><strong>Position:</strong> ({zone.position_x}, {zone.position_y})</div>
                      {zone.screen && (
                        <div><strong>Screen:</strong> {zone.screen.screen_name}</div>
                      )}
                    </div>

                    {(canEdit || canDelete) && (
                      <div style={styles.cardActions}>
                        {canEdit && (
                          <button
                            style={styles.actionButton}
                            onClick={() => {
                              setSelectedZone(zone);
                              setShowCreateModal(true);
                            }}
                          >
                            <FiEdit /> Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            style={{ ...styles.actionButton, color: TavariStyles.colors.danger }}
                            onClick={() => handleDelete(zone.id)}
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

            {(showCreateModal || selectedZone) && (
              <ZoneFormModal
                zone={selectedZone}
                onClose={closeZoneModal}
                onSubmit={selectedZone ? handleUpdate : handleCreate}
                screens={screens}
              />
            )}
          </div>
        </PermissionGate>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default ZoneManagementScreen;



