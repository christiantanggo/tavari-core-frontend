// src/screens/Music/MusicDesktopDownload.jsx
// Desktop app download page for Tavari Music
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiDownload, FiMonitor, FiAlertTriangle, FiX, FiCheckCircle } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';
import { usePermissions } from '../../hooks/usePermissions';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';

const WINDOWS_INSTALLER_FILENAME =
  import.meta.env.VITE_MUSIC_DESKTOP_WINDOWS_INSTALLER || 'Tavari-Music-Desktop-Setup-1.0.1.exe';
const INSTALLATION_CONFIG_FILENAME = 'tavari-installation-config.json';

const triggerBrowserDownload = (href, filename) => {
  const link = document.createElement('a');
  link.href = href;
  if (filename) {
    link.download = filename;
  }
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const triggerJsonDownload = (filename, payload) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  triggerBrowserDownload(objectUrl, filename);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};

const MusicDesktopDownload = () => {
  const navigate = useNavigate();
  const [currentPlatform, setCurrentPlatform] = useState('unknown');
  const [downloadLinks, setDownloadLinks] = useState({});
  const [loading, setLoading] = useState(true);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState(null);

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'MusicDesktopDownload'
  });

  const security = useSecurityContext({
    enableRateLimiting: true,
    enableAuditLogging: true,
    componentName: 'MusicDesktopDownload'
  });

  const { hasElevatedPrivileges } = usePermissions();

  useEffect(() => {
    // Detect platform
    const detectPlatform = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      const platform = navigator.platform.toLowerCase();
      
      if (platform.includes('win') || userAgent.includes('windows')) {
        return 'windows';
      } else if (platform.includes('mac') || userAgent.includes('mac')) {
        return 'mac';
      } else if (platform.includes('linux') || userAgent.includes('linux')) {
        return 'linux';
      }
      return 'unknown';
    };

    setCurrentPlatform(detectPlatform());
    loadDownloadLinks();
  }, []);

  const loadDownloadLinks = async () => {
    try {
      setLoading(true);
      
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseProjectId = supabaseUrl ? supabaseUrl.match(/https?:\/\/([^.]+)/)?.[1] : null;
      const supabaseStorageUrl = supabaseProjectId 
        ? `https://${supabaseProjectId}.supabase.co/storage/v1/object/public/music-installers`
        : null;
      
      const installerBaseUrl = import.meta.env.VITE_INSTALLER_BASE_URL || 
                                supabaseStorageUrl ||
                                (window.location.origin + '/installers');
      
      // .exe installer for Windows (uploaded to Supabase)
      const links = {
        windows: `${installerBaseUrl}/${WINDOWS_INSTALLER_FILENAME}`, // .exe installer
        mac: `${installerBaseUrl}/Tavari-Music-Desktop.dmg`,
        linux: `${installerBaseUrl}/Tavari-Music-Desktop.AppImage`
      };

      // Debug logging
      console.log('🔍 Download URL Debug:');
      console.log('  Supabase URL:', supabaseUrl);
      console.log('  Project ID:', supabaseProjectId);
      console.log('  Storage URL:', supabaseStorageUrl);
      console.log('  Installer Base URL:', installerBaseUrl);
      console.log('  Windows Download URL:', links.windows);

      setDownloadLinks(links);
      
      await security.logSecurityEvent('desktop_app_download_page_accessed', {
        platform: currentPlatform || 'unknown',
        business_id: auth.selectedBusinessId
      }, 'low');
      
    } catch (error) {
      console.error('Error loading download links:', error);
      toast.error('Failed to load download links');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadClick = (platform) => {
    setSelectedPlatform(platform);
    setShowWarningModal(true);
  };

  const handleConfirmDownload = async () => {
    setShowWarningModal(false);
    const platform = selectedPlatform;
    
    try {
      // For Windows, download .exe installer directly
      let link = downloadLinks[platform];
      let filename = '';
      
      if (platform === 'windows') {
        // Always use .exe installer (uploaded to Supabase)
        link = downloadLinks.windows;
        filename = WINDOWS_INSTALLER_FILENAME;
        
        // Verify file exists before downloading
        try {
          console.log('🔍 Verifying download URL:', link);
          const response = await fetch(link, { method: 'HEAD' });
          console.log('📡 Response status:', response.status);
          console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));
          
          if (!response.ok) {
            toast.error(`Installer not found (${response.status}). Check: 1) Bucket name is "music-installers", 2) File is PUBLIC, 3) Filename is exact.`);
            console.error('❌ Download failed - URL:', link);
            console.error('❌ Response status:', response.status);
            console.error('❌ Response text:', await response.text().catch(() => 'N/A'));
            return;
          }
          console.log('✅ File verified - exists and accessible');
        } catch (error) {
          toast.error('Failed to verify installer. Please check your connection.');
          console.error('❌ Download verification error:', error);
          console.error('❌ Failed URL:', link);
          return;
        }
      } else {
        filename = link.split('/').pop() || 
                  (platform === 'mac' ? 'Tavari-Music-Desktop.dmg' : 
                   'Tavari-Music-Desktop.AppImage');
      }
      
      if (!link) {
        toast.error(`${platform} installer not available`);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast.error('Please log in first before downloading');
        return;
      }

      // Generate installation token (but don't download JSON file)
      const installationToken = await generateInstallationToken(auth.selectedBusinessId, session);

      // 🔥 CRITICAL: Save session and business ID for Electron app to pick up
      // This allows the app to auto-login without requiring a monitor/keyboard
      const electronConfig = {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        user: session.user,
        business_id: auth.selectedBusinessId, // CRITICAL: Business ID for kiosk
        savedAt: new Date().toISOString(),
        source: 'download_page'
      };
      
      // Save to localStorage - Electron app will pick this up on first load
      localStorage.setItem('tavari_electron_pending_config', JSON.stringify(electronConfig));
      console.log('✅ Session and business ID saved for Electron app:', auth.selectedBusinessId);
      
      // Also save to regular session storage as backup
      localStorage.setItem('tavariPinnedBusinessId', auth.selectedBusinessId);
      localStorage.setItem('selectedBusinessId', auth.selectedBusinessId);
      localStorage.setItem('currentBusinessId', auth.selectedBusinessId);

      const installationConfig = {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: session.expires_at,
        userId: session.user.id,
        business_id: auth.selectedBusinessId,
        generatedAt: new Date().toISOString(),
        source: 'music_desktop_download'
      };

      triggerJsonDownload(INSTALLATION_CONFIG_FILENAME, installationConfig);

      await security.logSecurityEvent('desktop_app_download_initiated', {
        platform,
        business_id: auth.selectedBusinessId,
        download_url: link,
        has_auto_login: !!installationToken,
        installation_config_downloaded: true
      }, 'medium');

      // Download installer right after the config file so both downloads happen from the same user action.
      triggerBrowserDownload(link, filename);

      toast.success(
        'Two files downloaded: the installer (.exe) and tavari-installation-config.json. ' +
          'Install on THIS computer and keep both files in Downloads so the kiosk can load your music library.',
        { duration: 8000 }
      );
      
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Failed to initiate download');
      await security.logSecurityEvent('desktop_app_download_failed', {
        platform,
        error: error.message
      }, 'medium');
    }
  };

  const generateInstallationToken = async (businessId, session) => {
    try {
      const { data: installation, error } = await supabase
        .from('music_installations')
        .insert({
          business_id: businessId,
          device_fingerprint: `web-download-${Date.now()}`,
          device_name: 'Desktop App Download',
          app_version: '1.0.0',
          status: 'pending',
          license_type: 'trial'
        })
        .select()
        .single();

      if (error) {
        console.error('Failed to create installation:', error);
        return null;
      }

      // Don't download JSON file automatically - user can download it separately if needed
      // The app will use the session from localStorage for auto-login
      
      return `${installation.id}:${session.access_token.substring(0, 20)}`;
    } catch (error) {
      console.error('Failed to generate installation token:', error);
      return null;
    }
  };

  const styles = {
    container: {
      maxWidth: '1000px',
      margin: '0 auto',
      padding: '40px 20px',
      paddingTop: '100px', // Extra padding to account for fixed header (60px) + spacing
      fontFamily: TavariStyles.typography?.fontFamily || 'system-ui, sans-serif'
    },
    header: {
      textAlign: 'center',
      marginBottom: '40px'
    },
    title: {
      fontSize: '33px',
      fontWeight: 'bold',
      color: TavariStyles.colors.gray900,
      marginBottom: '12px'
    },
    subtitle: {
      fontSize: '18px',
      color: TavariStyles.colors.gray600,
      marginBottom: '24px'
    },
    warningBox: {
      background: '#FFF3CD',
      border: `1px solid #FFC107`,
      borderRadius: '8px',
      padding: '20px',
      marginBottom: '40px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px'
    },
    warningIcon: {
      color: '#856404',
      fontSize: '24px',
      flexShrink: 0,
      marginTop: '2px'
    },
    warningContent: {
      flex: 1
    },
    warningTitle: {
      fontSize: '16px',
      fontWeight: '600',
      color: '#856404',
      marginBottom: '8px'
    },
    warningText: {
      fontSize: '14px',
      color: '#856404',
      lineHeight: '1.6',
      margin: 0
    },
    platformGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: '24px',
      marginBottom: '40px'
    },
    platformCard: {
      background: 'white',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: '12px',
      padding: '32px',
      textAlign: 'center',
      transition: 'all 0.2s',
      boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
    },
    platformCardRecommended: {
      border: `2px solid ${TavariStyles.colors.primary}`,
      boxShadow: `0 4px 12px ${TavariStyles.colors.primary}20`
    },
    platformIcon: {
      fontSize: '48px',
      color: TavariStyles.colors.primary,
      marginBottom: '16px'
    },
    platformName: {
      fontSize: '20px',
      fontWeight: '600',
      color: TavariStyles.colors.gray900,
      marginBottom: '8px'
    },
    platformLabel: {
      fontSize: '13px',
      color: TavariStyles.colors.primary,
      fontWeight: '500',
      marginBottom: '20px',
      padding: '4px 12px',
      background: `${TavariStyles.colors.primary}15`,
      borderRadius: '12px',
      display: 'inline-block'
    },
    downloadButton: {
      width: '100%',
      padding: '14px 24px',
      background: TavariStyles.colors.primary,
      color: 'white',
      border: 'none',
      borderRadius: '8px',
      fontSize: '16px',
      fontWeight: '600',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      transition: 'all 0.2s',
      marginTop: '16px'
    },
    downloadButtonHover: {
      background: TavariStyles.colors.primaryDark,
      transform: 'scale(1.02)'
    },
    modalOverlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    },
    modal: {
      background: 'white',
      borderRadius: '12px',
      padding: '32px',
      maxWidth: '500px',
      width: '100%',
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      position: 'relative'
    },
    modalHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '24px'
    },
    modalTitle: {
      fontSize: '24px',
      fontWeight: '600',
      color: TavariStyles.colors.gray900,
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    },
    modalClose: {
      background: 'none',
      border: 'none',
      fontSize: '24px',
      cursor: 'pointer',
      color: TavariStyles.colors.gray500,
      padding: '4px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    modalContent: {
      marginBottom: '24px'
    },
    modalWarning: {
      background: '#FFF3CD',
      border: `1px solid #FFC107`,
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '20px',
      display: 'flex',
      gap: '12px'
    },
    modalWarningText: {
      fontSize: '14px',
      color: '#856404',
      lineHeight: '1.6',
      margin: 0
    },
    modalList: {
      listStyle: 'none',
      padding: 0,
      margin: '16px 0'
    },
    modalListItem: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '10px',
      marginBottom: '12px',
      fontSize: '14px',
      color: TavariStyles.colors.gray700,
      lineHeight: '1.6'
    },
    modalActions: {
      display: 'flex',
      gap: '12px',
      justifyContent: 'flex-end'
    },
    modalButton: {
      padding: '12px 24px',
      borderRadius: '8px',
      fontSize: '16px',
      fontWeight: '600',
      cursor: 'pointer',
      border: 'none',
      transition: 'all 0.2s'
    },
    modalButtonCancel: {
      background: TavariStyles.colors.gray200,
      color: TavariStyles.colors.gray700
    },
    modalButtonConfirm: {
      background: TavariStyles.colors.primary,
      color: 'white'
    }
  };

  const platformInfo = {
    windows: {
      name: 'Windows',
      file: '.exe Installer',
      description: 'Standard Windows installer - double-click to install'
    },
    mac: {
      name: 'macOS',
      file: '.dmg',
      description: 'Standard Mac installer'
    },
    linux: {
      name: 'Linux',
      file: '.AppImage',
      description: 'Universal Linux app'
    }
  };

  if (!auth.isReady || loading) {
    return (
      <POSAuthWrapper 
        requiredRoles={['manager', 'owner']} 
        requireBusiness={true}
        componentName="MusicDesktopDownload"
      >
        <div style={styles.container}>
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={styles.title}>Loading...</div>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper 
      requiredRoles={['manager', 'owner']} 
      requireBusiness={true}
      componentName="MusicDesktopDownload"
    >
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>Tavari Music Desktop App</h1>
          <p style={styles.subtitle}>
            Download for Windows, Mac, or Linux
          </p>
        </div>

        {/* Warning Box */}
        <div style={styles.warningBox}>
          <FiAlertTriangle style={styles.warningIcon} />
          <div style={styles.warningContent}>
            <div style={styles.warningTitle}>Initial Setup Requirements</div>
            <p style={styles.warningText}>
              <strong>Internet required for initial setup:</strong> The app needs internet for first-time login and to download 
              your music library and schedules. Once cached, the app will continue playing music offline using cached songs 
              and schedules. Your session will be saved for automatic login on future launches.
            </p>
          </div>
        </div>

        {/* Platform Cards */}
        <div style={styles.platformGrid}>
          {['windows', 'mac', 'linux'].map((platform) => {
            const info = platformInfo[platform];
            const isRecommended = currentPlatform === platform;
            
            return (
              <div 
                key={platform}
                style={{
                  ...styles.platformCard,
                  ...(isRecommended ? styles.platformCardRecommended : {})
                }}
              >
                <FiMonitor style={styles.platformIcon} />
                <div style={styles.platformName}>{info.name}</div>
                {isRecommended && (
                  <div style={styles.platformLabel}>Recommended for your device</div>
                )}
                <button
                  style={styles.downloadButton}
                  onClick={() => handleDownloadClick(platform)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = TavariStyles.colors.primaryDark;
                    e.currentTarget.style.transform = 'scale(1.02)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = TavariStyles.colors.primary;
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  <FiDownload /> Download {info.file}
                </button>
                <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginTop: '8px' }}>
                  {info.description}
                </div>
              </div>
            );
          })}
        </div>

        {/* Warning Modal */}
        {showWarningModal && (
          <div style={styles.modalOverlay} onClick={() => setShowWarningModal(false)}>
            <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <h2 style={styles.modalTitle}>
                  <FiAlertTriangle color="#FFC107" />
                  Download Confirmation
                </h2>
                <button
                  style={styles.modalClose}
                  onClick={() => setShowWarningModal(false)}
                >
                  <FiX />
                </button>
              </div>
              
              <div style={styles.modalContent}>
                <div style={styles.modalWarning}>
                  <FiAlertTriangle color="#856404" size={20} />
                  <p style={styles.modalWarningText}>
                    <strong>Important: Your browser or antivirus may warn about this download</strong>
                  </p>
                </div>
                
                <p style={{ fontSize: '14px', color: TavariStyles.colors.gray700, marginBottom: '20px', lineHeight: '1.6' }}>
                  The desktop app is a portable application that may trigger security warnings. This is normal and safe. 
                  The file is not signed with a code signing certificate, which is why you may see warnings.
                </p>
                
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '15px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '12px' }}>
                    What to do when you see warnings:
                  </div>
                  <ul style={styles.modalList}>
                    <li style={styles.modalListItem}>
                      <FiCheckCircle color={TavariStyles.colors.gray600} size={16} style={{ marginTop: '2px' }} />
                      <span><strong>Browser warning:</strong> Click "Keep" or "Download anyway" if your browser warns about the file</span>
                    </li>
                    <li style={styles.modalListItem}>
                      <FiCheckCircle color={TavariStyles.colors.gray600} size={16} style={{ marginTop: '2px' }} />
                      <span><strong>Antivirus warning:</strong> Click "Allow" or "Run anyway" if Windows Defender or your antivirus flags it</span>
                    </li>
                    <li style={styles.modalListItem}>
                      <FiCheckCircle color={TavariStyles.colors.gray600} size={16} style={{ marginTop: '2px' }} />
                      <span><strong>Windows SmartScreen:</strong> Click "More info" then "Run anyway" if Windows blocks the file</span>
                    </li>
                    <li style={styles.modalListItem}>
                      <FiCheckCircle color={TavariStyles.colors.gray600} size={16} style={{ marginTop: '2px' }} />
                      <span><strong>File blocked:</strong> Right-click the downloaded file → Properties → Check "Unblock" → Apply</span>
                    </li>
                  </ul>
                </div>
                
                <div style={{ 
                  background: TavariStyles.colors.gray50, 
                  padding: '16px', 
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: TavariStyles.colors.gray600,
                  lineHeight: '1.6'
                }}>
                  <strong>Why you see warnings:</strong> The app is unsigned (no code signing certificate) and portable (no installer). 
                  This is normal for small business software. The file is safe and comes directly from your Tavari account.
                </div>
              </div>
              
              <div style={styles.modalActions}>
                <button
                  style={{ ...styles.modalButton, ...styles.modalButtonCancel }}
                  onClick={() => setShowWarningModal(false)}
                >
                  Cancel
                </button>
                <button
                  style={{ ...styles.modalButton, ...styles.modalButtonConfirm }}
                  onClick={handleConfirmDownload}
                >
                  Continue Download
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </POSAuthWrapper>
  );
};

export default MusicDesktopDownload;
