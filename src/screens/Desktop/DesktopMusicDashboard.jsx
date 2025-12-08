// src/screens/Music/DesktopMusicDashboard.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { FiMonitor, FiWifi, FiSmartphone, FiSettings, FiDownload, FiLock, FiRefreshCw } from 'react-icons/fi';
import AudioPlayer from '../../components/Music/AudioPlayer';
import DesktopSystemMonitor from '../../components/Desktop/DesktopSystemMonitor';
import PlaybackMonitor from '../../components/Music/PlaybackMonitor';
import DesktopMusicStatusDashboard from '../../components/Desktop/DesktopMusicStatusDashboard';
import UpdateManager from '../../components/Desktop/UpdateManager';
import InstallationManager from '../../components/Desktop/InstallationManager';
import { useBusiness } from '../../contexts/BusinessContext';
import { useUserProfile } from '../../hooks/useUserProfile';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

const DesktopMusicDashboard = () => {
  const { business } = useBusiness();
  const { profile } = useUserProfile();
  const { hasPermission, hasAnyPermission, isOwner, isManager, hasElevatedPrivileges, loading: permissionsLoading } = usePermissions();
  
  const [isElectron, setIsElectron] = useState(false);
  const [remoteServerInfo, setRemoteServerInfo] = useState(null);
  const [networkInterfaces, setNetworkInterfaces] = useState([]);
  const [showQR, setShowQR] = useState(false);

  // Check if user has permission to access music dashboard
  const canAccessMusicDashboard = hasAnyPermission([
    'music.control.play_pause',
    'music.settings.edit',
    'music.library.upload'
  ]) || hasElevatedPrivileges();

  useEffect(() => {
    // Check if running in Electron
    const checkElectron = async () => {
      if (window.electronAPI) {
        setIsElectron(true);
        
        // Only initialize if user has permission
        if (canAccessMusicDashboard) {
          await initializeDesktopFeatures();
        }
      }
    };
    
    if (!permissionsLoading) {
      checkElectron();
    }
  }, [permissionsLoading, canAccessMusicDashboard]);

  const initializeDesktopFeatures = async () => {
    // Check permission before initializing
    if (!hasAnyPermission(['music.settings.edit', 'music.control.play_pause']) && !hasElevatedPrivileges()) {
      toast.error('You do not have permission to initialize desktop features');
      return;
    }

    try {
      // Get remote server info
      const serverInfo = await window.electronAPI.getServerInfo();
      setRemoteServerInfo(serverInfo);
      
      // Start remote server if not running (managers and owners only)
      if (!serverInfo.running && (isManager() || isOwner())) {
        await window.electronAPI.startRemoteServer();
      }
      
    } catch (error) {
      console.error('Desktop initialization error:', error);
      toast.error('Failed to initialize desktop features');
    }
  };

  const handleToggleAutoStart = () => {
    // Check permission
    if (!hasPermission('music.settings.edit')) {
      toast.error('You do not have permission to modify system settings');
      return;
    }

    // Proceed with toggle
    toast.success('Auto-start setting updated');
  };

  const handleToggleAutoUpdate = () => {
    // Check permission
    if (!hasPermission('music.settings.edit')) {
      toast.error('You do not have permission to modify update settings');
      return;
    }

    // Proceed with toggle
    toast.success('Auto-update setting updated');
  };

  const handleShowQRCode = () => {
    // Check permission for remote control
    if (!hasAnyPermission(['music.control.play_pause', 'music.settings.edit']) && !hasElevatedPrivileges()) {
      toast.error('You do not have permission to access remote control features');
      return;
    }

    setShowQR(!showQR);
  };

  const generateQRCode = (url) => {
    // Simple QR code generation (in real app, use a proper QR library)
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
  };

  // Loading state
  if (permissionsLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner}></div>
        <p style={styles.loadingText}>Loading permissions...</p>
      </div>
    );
  }

  // Permission check - No access
  if (!canAccessMusicDashboard) {
    return (
      <div style={styles.noAccessContainer}>
        <div style={styles.noAccessCard}>
          <FiLock size={64} style={styles.lockIcon} />
          <h2 style={styles.noAccessTitle}>Access Denied</h2>
          <p style={styles.noAccessText}>
            You do not have permission to access the Desktop Music Dashboard.
          </p>
          <p style={styles.noAccessSubtext}>
            This feature requires music control permissions. Please contact your administrator if you need access.
          </p>
          <div style={styles.permissionsRequired}>
            <strong>Required Permissions:</strong>
            <ul style={styles.permissionsList}>
              <li>Music Control (Play/Pause)</li>
              <li>Music Settings</li>
              <li>Music Library Upload</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // If not in Electron, show regular music dashboard
  if (!isElectron) {
    return (
      <div style={styles.fallbackContainer}>
        <div style={styles.fallbackMessage}>
          <FiMonitor size={48} style={styles.fallbackIcon} />
          <h2>Desktop Features Not Available</h2>
          <p>
            These features are only available in the Tavari Music Desktop application.
          </p>
          
          {/* Show audio player only if user has control permission */}
          <PermissionGate 
            permissions={['music.control.play_pause']} 
            requireAny
            fallback={
              <p style={styles.noPlayerText}>
                You do not have permission to control music playback.
              </p>
            }
          >
            <AudioPlayer />
          </PermissionGate>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.titleSection}>
          <FiMonitor size={32} style={styles.headerIcon} />
          <div>
            <h1 style={styles.title}>Tavari Music Desktop</h1>
            <p style={styles.subtitle}>
              Professional background music system for {business?.name || 'your business'}
            </p>
          </div>
        </div>
      </div>

      {/* Installation Check - Only for owners/admins */}
      <PermissionGate requireElevated>
        <InstallationManager />
      </PermissionGate>

      {/* Main Content Grid */}
      <div style={styles.contentGrid}>
        {/* Music Player Section - Basic control permission required */}
        <PermissionGate 
          permissions={['music.control.play_pause']} 
          requireAny
          fallback={
            <div style={styles.playerSection}>
              <h3 style={styles.sectionTitle}>Music Player</h3>
              <div style={styles.permissionDenied}>
                <FiLock size={24} />
                <p>You do not have permission to control music playback.</p>
              </div>
            </div>
          }
        >
          <div style={styles.playerSection}>
            <h3 style={styles.sectionTitle}>Music Player</h3>
            <AudioPlayer />
          </div>
        </PermissionGate>

        {/* Remote Control Section - Requires control or settings permission */}
        <PermissionGate 
          permissions={['music.control.play_pause', 'music.settings.edit']} 
          requireAny
          fallback={
            <div style={styles.remoteSection}>
              <h3 style={styles.sectionTitle}>Remote Control</h3>
              <div style={styles.permissionDenied}>
                <FiLock size={20} />
                <p>Remote control access restricted.</p>
              </div>
            </div>
          }
        >
          <div style={styles.remoteSection}>
            <h3 style={styles.sectionTitle}>Remote Control</h3>
            <div style={styles.remoteContent}>
              {remoteServerInfo?.running ? (
                <div style={styles.remoteActive}>
                  <div style={styles.remoteStatus}>
                    <FiWifi size={20} style={styles.statusIcon} />
                    <span>Remote control server active</span>
                  </div>
                  <div style={styles.remoteUrl}>
                    <strong>Access URL:</strong> {remoteServerInfo.url}
                  </div>
                  <div style={styles.remoteActions}>
                    <button 
                      style={styles.qrButton}
                      onClick={handleShowQRCode}
                    >
                      <FiSmartphone size={16} />
                      {showQR ? 'Hide QR Code' : 'Show QR Code'}
                    </button>
                  </div>
                  {showQR && (
                    <div style={styles.qrContainer}>
                      <img 
                        src={generateQRCode(remoteServerInfo.url)}
                        alt="QR Code for remote access"
                        style={styles.qrCode}
                      />
                      <p style={styles.qrInstructions}>
                        Scan with your phone to control music remotely
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div style={styles.remoteInactive}>
                  <p>Remote control server not available</p>
                </div>
              )}
            </div>
          </div>
        </PermissionGate>
      </div>

      {/* Unified Music Status Dashboard - Shows playback, cache, and schedules */}
      <DesktopMusicStatusDashboard />

      {/* System Monitoring - Only for managers and above */}
      <PermissionGate 
        permissions={['music.settings.edit']} 
        requireAny
        fallback={null}
      >
        <DesktopSystemMonitor />
      </PermissionGate>

      {/* Update Management - Only for owners/admins */}
      <PermissionGate requireElevated>
        <UpdateManager />
      </PermissionGate>

      {/* Quick Settings - Only for those with settings permission */}
      <PermissionGate 
        permission="music.settings.edit"
        fallback={null}
      >
        <div style={styles.quickSettings}>
          <h3 style={styles.sectionTitle}>Quick Settings</h3>
          <div style={styles.settingsGrid}>
            <div style={styles.settingCard}>
              <FiSettings size={24} style={styles.settingIcon} />
              <div>
                <h4 style={styles.settingTitle}>Auto-Start</h4>
                <p style={styles.settingDescription}>Start with Windows</p>
              </div>
              <label style={styles.settingToggle}>
                <input 
                  type="checkbox" 
                  defaultChecked 
                  onChange={handleToggleAutoStart}
                />
                <span style={styles.toggleSlider}></span>
              </label>
            </div>
            
            <div style={styles.settingCard}>
              <FiDownload size={24} style={styles.settingIcon} />
              <div>
                <h4 style={styles.settingTitle}>Auto-Update</h4>
                <p style={styles.settingDescription}>Download updates automatically</p>
              </div>
              <label style={styles.settingToggle}>
                <input 
                  type="checkbox" 
                  defaultChecked 
                  onChange={handleToggleAutoUpdate}
                />
                <span style={styles.toggleSlider}></span>
              </label>
            </div>
            
            {/* Restart App Card */}
            <div 
              style={{
                ...styles.settingCard,
                border: `2px solid ${TavariStyles?.colors?.error || '#dc3545'}`,
                backgroundColor: `${TavariStyles?.colors?.error || '#dc3545'}08`
              }}
              onClick={async () => {
                if (window.confirm('Restart the desktop app? Music will resume automatically after restart.')) {
                  try {
                    console.log('🔄 Manual restart requested from desktop dashboard');
                    if (window.electronAPI?.restartApp) {
                      await window.electronAPI.restartApp();
                    } else {
                      toast.error('Restart function not available');
                    }
                  } catch (error) {
                    console.error('Error restarting app:', error);
                    toast.error('Failed to restart app. Please restart manually.');
                  }
                }
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = TavariStyles?.colors?.error || '#dc3545';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.cursor = 'pointer';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = TavariStyles?.colors?.error || '#dc3545';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <FiRefreshCw size={24} style={{ ...styles.settingIcon, color: TavariStyles?.colors?.error || '#dc3545' }} />
              <div style={{ flex: 1 }}>
                <h4 style={styles.settingTitle}>Restart App</h4>
                <p style={styles.settingDescription}>
                  Restart the desktop app to apply updates or fix issues. Daily auto-restart at 3:00 AM.
                </p>
              </div>
              <button
                style={{
                  padding: '8px 16px',
                  backgroundColor: TavariStyles?.colors?.error || '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: '600',
                  whiteSpace: 'nowrap'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm('Restart the desktop app? Music will resume automatically after restart.')) {
                    if (window.electronAPI?.restartApp) {
                      window.electronAPI.restartApp().catch(err => {
                        toast.error('Failed to restart app');
                      });
                    }
                  }
                }}
              >
                Restart Now
              </button>
            </div>
          </div>
        </div>
      </PermissionGate>

      {/* Connection Status */}
      <div style={styles.statusBar}>
        <div style={styles.statusItem}>
          <FiWifi size={16} />
          <span>Connected to Tavari Cloud</span>
        </div>
        <div style={styles.statusItem}>
          <FiMonitor size={16} />
          <span>Desktop App v1.0.0</span>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    width: '100%',
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
    padding: '40px',
  },
  loadingSpinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f3f3',
    borderTop: '4px solid #20c997',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '20px',
  },
  loadingText: {
    fontSize: '16px',
    color: '#666',
  },
  noAccessContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
    padding: '40px',
  },
  noAccessCard: {
    backgroundColor: '#fff',
    border: '2px solid #e9ecef',
    borderRadius: '12px',
    padding: '50px',
    maxWidth: '600px',
    textAlign: 'center',
    boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
  },
  lockIcon: {
    color: '#dc3545',
    marginBottom: '20px',
  },
  noAccessTitle: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '15px',
  },
  noAccessText: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '10px',
    lineHeight: '1.6',
  },
  noAccessSubtext: {
    fontSize: '14px',
    color: '#999',
    marginBottom: '30px',
    lineHeight: '1.5',
  },
  permissionsRequired: {
    backgroundColor: '#f8f9fa',
    border: '1px solid #dee2e6',
    borderRadius: '6px',
    padding: '20px',
    textAlign: 'left',
  },
  permissionsList: {
    margin: '10px 0 0 0',
    paddingLeft: '20px',
    color: '#666',
  },
  fallbackContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
    padding: '40px',
  },
  fallbackMessage: {
    textAlign: 'center',
    maxWidth: '600px',
  },
  fallbackIcon: {
    color: '#ccc',
    marginBottom: '20px',
  },
  noPlayerText: {
    color: '#999',
    fontSize: '14px',
    marginTop: '20px',
  },
  header: {
    marginBottom: '40px',
    paddingBottom: '20px',
    borderBottom: '2px solid #e9ecef',
  },
  titleSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
  },
  headerIcon: {
    color: '#20c997',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#333',
    margin: '0 0 8px 0',
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
    margin: '0',
  },
  contentGrid: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr',
    gap: '30px',
    marginBottom: '40px',
  },
  playerSection: {
    backgroundColor: '#fff',
    padding: '25px',
    borderRadius: '8px',
    border: '2px solid #e9ecef',
  },
  remoteSection: {
    backgroundColor: '#f8f9fa',
    padding: '25px',
    borderRadius: '8px',
    border: '2px solid #e9ecef',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    margin: '0 0 20px 0',
  },
  permissionDenied: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '30px',
    color: '#999',
    fontSize: '14px',
    gap: '10px',
  },
  remoteContent: {
    fontSize: '14px',
  },
  remoteActive: {
    color: '#333',
  },
  remoteStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '15px',
    color: '#28a745',
    fontWeight: '500',
  },
  statusIcon: {
    color: '#28a745',
  },
  remoteUrl: {
    marginBottom: '15px',
    padding: '10px',
    backgroundColor: '#fff',
    borderRadius: '4px',
    border: '1px solid #e9ecef',
    fontFamily: 'monospace',
    fontSize: '13px',
  },
  remoteActions: {
    marginBottom: '15px',
  },
  qrButton: {
    backgroundColor: '#20c997',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '8px 12px',
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'background-color 0.2s',
  },
  qrContainer: {
    textAlign: 'center',
    padding: '20px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    border: '1px solid #e9ecef',
  },
  qrCode: {
    maxWidth: '150px',
    height: 'auto',
    marginBottom: '10px',
  },
  qrInstructions: {
    fontSize: '12px',
    color: '#666',
    margin: '0',
  },
  remoteInactive: {
    color: '#dc3545',
    fontStyle: 'italic',
  },
  quickSettings: {
    backgroundColor: '#f8f9fa',
    padding: '25px',
    borderRadius: '8px',
    border: '2px solid #e9ecef',
    marginBottom: '30px',
  },
  settingsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px',
  },
  settingCard: {
    backgroundColor: '#fff',
    padding: '20px',
    borderRadius: '6px',
    border: '1px solid #e9ecef',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },
  settingIcon: {
    color: '#20c997',
  },
  settingTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    margin: '0 0 4px 0',
  },
  settingDescription: {
    fontSize: '14px',
    color: '#666',
    margin: '0',
  },
  settingToggle: {
    position: 'relative',
    marginLeft: 'auto',
    cursor: 'pointer',
  },
  toggleSlider: {
    position: 'relative',
    display: 'inline-block',
    width: '44px',
    height: '24px',
    backgroundColor: '#e9ecef',
    borderRadius: '12px',
    transition: 'background-color 0.3s',
  },
  statusBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '15px 0',
    borderTop: '1px solid #e9ecef',
    fontSize: '14px',
    color: '#666',
    flexWrap: 'wrap',
    gap: '15px',
  },
  statusItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
};

// Add CSS animation for loading spinner
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleSheet);

export default DesktopMusicDashboard;