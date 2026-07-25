// src/screens/DigitalSignage/ScreenDetailView.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiMonitor, FiEdit, FiRefreshCw, FiWifi, FiWifiOff, FiSettings, FiCopy, FiExternalLink } from 'react-icons/fi';
import { QRCodeSVG } from 'qrcode.react';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';
import useDigitalSignage from '../../hooks/useDigitalSignage';
import { buildPlayerUrl } from '../../services/SignagePlayerService';
import ScreenRegistrationModal from '../../components/DigitalSignage/ScreenRegistrationModal';

const ScreenDetailView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [screen, setScreen] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);

  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'ScreenDetailView'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();

  const {
    screens,
    loading,
    error,
    loadScreens,
    updateScreen
  } = useDigitalSignage();

  useEffect(() => {
    if (auth.selectedBusinessId && id) {
      loadScreens();
    }
  }, [auth.selectedBusinessId, id]);

  useEffect(() => {
    if (screens.length > 0 && id) {
      const found = screens.find(s => s.id === id);
      setScreen(found);
    }
  }, [screens, id]);

  const canEdit = hasPermission('digital_signage.screens.edit') || hasElevatedPrivileges();

  const handleUpdateScreen = async (screenData) => {
    if (!screen?.id) return;
    try {
      const updated = await updateScreen(screen.id, {
        screen_name: screenData.name,
        screen_type: screenData.type,
        location_name: screenData.locationName || null,
        resolution_width: screenData.resolutionWidth ? parseInt(screenData.resolutionWidth, 10) : null,
        resolution_height: screenData.resolutionHeight ? parseInt(screenData.resolutionHeight, 10) : null,
        orientation: screenData.orientation,
        group_id: screenData.groupId || null,
        settings: screenData.settings || {}
      });
      setScreen(updated);
      setShowEditModal(false);
    } catch (err) {
      toast.error(`Failed to update screen: ${err.message}`);
    }
  };

  const playerUrl = useMemo(() => {
    if (!screen?.screen_key) return '';
    return buildPlayerUrl(screen.screen_key);
  }, [screen?.screen_key]);

  const copyPlayerUrl = async () => {
    if (!playerUrl) return;
    try {
      await navigator.clipboard.writeText(playerUrl);
      toast.success('Player URL copied');
    } catch {
      toast.error('Could not copy URL');
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
      ...TavariStyles.components.button.secondary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    card: {
      ...TavariStyles.components.card,
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.lg
    },
    cardTitle: {
      ...TavariStyles.typography.heading.h3,
      marginBottom: TavariStyles.spacing.md
    },
    infoGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: TavariStyles.spacing.md
    },
    infoItem: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md
    },
    infoLabel: {
      ...TavariStyles.typography.body,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xs
    },
    infoValue: {
      ...TavariStyles.typography.heading.h4
    },
    statusBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      borderRadius: TavariStyles.borderRadius.full,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    playerHint: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      lineHeight: 1.5,
      marginBottom: TavariStyles.spacing.md
    },
    playerHintList: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      lineHeight: 1.55,
      margin: `0 0 ${TavariStyles.spacing.md}`,
      paddingLeft: TavariStyles.spacing.lg
    },
    playerUrlRow: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.lg,
      flexWrap: 'wrap'
    },
    playerUrl: {
      flex: '1 1 200px',
      fontFamily: 'ui-monospace, monospace',
      fontSize: TavariStyles.typography.fontSize.sm,
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      wordBreak: 'break-all'
    },
    iconBtn: {
      ...TavariStyles.components.button.secondary,
      padding: TavariStyles.spacing.sm,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    iconBtnLink: {
      ...TavariStyles.components.button.secondary,
      padding: TavariStyles.spacing.sm,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: TavariStyles.colors.gray700,
      textDecoration: 'none'
    },
    qrWrap: {
      display: 'inline-block',
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`
    }
  };

  if (loading) {
    return (
      <div style={TavariStyles.layouts.centerContent}>
        <div>Loading screen details...</div>
      </div>
    );
  }

  if (error || !screen) {
    return (
      <div style={TavariStyles.layouts.centerContent}>
        <div style={{ color: TavariStyles.colors.danger }}>
          {error || 'Screen not found'}
        </div>
        <button
          style={{ ...styles.button, marginTop: TavariStyles.spacing.lg }}
          onClick={() => navigate('/dashboard/digital-signage/screens')}
        >
          Back to Screens
        </button>
      </div>
    );
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper>
        <PermissionGate permission="digital_signage.screens.view">
          <div style={styles.container}>
            <div style={styles.header}>
              <h1 style={styles.title}>
                <FiMonitor style={{ marginRight: TavariStyles.spacing.sm, verticalAlign: 'middle' }} />
                {screen.screen_name}
              </h1>
              <div style={{ display: 'flex', gap: TavariStyles.spacing.md }}>
                <button
                  style={styles.button}
                  onClick={() => navigate('/dashboard/digital-signage/screens')}
                >
                  Back
                </button>
                {canEdit && (
                  <button
                    style={styles.button}
                    onClick={() => setShowEditModal(true)}
                  >
                    <FiEdit /> Edit
                  </button>
                )}
              </div>
            </div>

            <div style={styles.card}>
              <h2 style={styles.cardTitle}>Screen Information</h2>
              <div style={styles.infoGrid}>
                <div style={styles.infoItem}>
                  <div style={styles.infoLabel}>Status</div>
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
                <div style={styles.infoItem}>
                  <div style={styles.infoLabel}>Screen Key</div>
                  <div style={styles.infoValue}>{screen.screen_key}</div>
                </div>
                <div style={styles.infoItem}>
                  <div style={styles.infoLabel}>Screen Type</div>
                  <div style={styles.infoValue}>{screen.screen_type}</div>
                </div>
                {screen.location_name && (
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>Location</div>
                    <div style={styles.infoValue}>{screen.location_name}</div>
                  </div>
                )}
                {screen.resolution_width && screen.resolution_height && (
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>Resolution</div>
                    <div style={styles.infoValue}>
                      {screen.resolution_width} × {screen.resolution_height}
                    </div>
                  </div>
                )}
                <div style={styles.infoItem}>
                  <div style={styles.infoLabel}>Orientation</div>
                  <div style={styles.infoValue}>{screen.orientation}</div>
                </div>
                {screen.last_seen_at && (
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>Last Seen</div>
                    <div style={styles.infoValue}>
                      {new Date(screen.last_seen_at).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {screen.screen_key ? (
              <div style={styles.card}>
                <h2 style={styles.cardTitle}>Player setup</h2>
                <p style={styles.playerHint}>
                  For a clean display with no address bar, use one of these options:
                </p>
                <ul style={styles.playerHintList}>
                  <li>
                    <strong>Tap “Connect screen”</strong> on the player, then tap{' '}
                    <strong>Tap for fullscreen</strong> if the browser asks — or open settings (top-right corner) →{' '}
                    Enter fullscreen.
                  </li>
                  <li>
                    <strong>Android / Fire tablet:</strong> Fully Kiosk Browser (recommended) or similar kiosk app —
                    load this URL and enable kiosk mode.
                  </li>
                  <li>
                    <strong>Windows:</strong> Chrome or Edge in kiosk mode, or press F11 after opening the player.
                  </li>
                  <li>
                    <strong>iPad:</strong> Safari → Share → Add to Home Screen, then open from the home screen icon.
                  </li>
                </ul>
                <p style={styles.playerHint}>
                  The screen key is included in the link below.
                </p>
                <div style={styles.playerUrlRow}>
                  <code style={styles.playerUrl}>{playerUrl}</code>
                  <button type="button" style={styles.iconBtn} onClick={copyPlayerUrl} title="Copy URL">
                    <FiCopy />
                  </button>
                  <a
                    href={playerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.iconBtnLink}
                    title="Open player"
                  >
                    <FiExternalLink />
                  </a>
                </div>
                <div style={styles.qrWrap}>
                  <QRCodeSVG value={playerUrl} size={160} level="M" includeMargin />
                </div>
              </div>
            ) : null}

            {showEditModal && screen ? (
              <ScreenRegistrationModal
                screen={screen}
                onClose={() => setShowEditModal(false)}
                onSubmit={handleUpdateScreen}
              />
            ) : null}
          </div>
        </PermissionGate>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default ScreenDetailView;



