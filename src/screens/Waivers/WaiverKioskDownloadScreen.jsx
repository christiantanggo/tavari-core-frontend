// Download page for Waiver Kiosk desktop app + launch browser kiosk (new tab).
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiDownload, FiTablet, FiAlertTriangle, FiX, FiCheckCircle, FiArrowLeft, FiCopy } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useWaiversShellStyle } from '../../contexts/WaiversShellContext';
import toast from 'react-hot-toast';
import {
  openWaiverKioskInNewTab,
  openLegacyWaiverKioskInNewTab,
  openLegacyKioskDownloadsInNewTab
} from '../../utils/waiverKioskOpen';

const WaiverKioskDownloadScreen = () => {
  const navigate = useNavigate();
  const [currentPlatform, setCurrentPlatform] = useState('unknown');
  const [downloadLinks, setDownloadLinks] = useState({});
  const [loading, setLoading] = useState(true);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState(null);

  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'WaiverKioskDownloadScreen'
  });

  const security = useSecurityContext({
    enableRateLimiting: true,
    enableAuditLogging: true,
    componentName: 'WaiverKioskDownloadScreen'
  });

  const { hasElevatedPrivileges } = usePermissions();
  const containerStyle = useWaiversShellStyle(styles.container);
  const contentStyle = useWaiversShellStyle(styles.content);
  const subtitleStyle = useWaiversShellStyle(styles.subtitle);

  const elevated =
    auth.userRole === 'manager' ||
    auth.userRole === 'owner' ||
    auth.userRole === 'admin' ||
    hasElevatedPrivileges();

  useEffect(() => {
    const detectPlatform = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      const platform = navigator.platform.toLowerCase();

      if (platform.includes('win') || userAgent.includes('windows')) {
        return 'windows';
      }
      if (platform.includes('mac') || userAgent.includes('mac')) {
        return 'mac';
      }
      if (platform.includes('linux') || userAgent.includes('linux')) {
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
        ? `https://${supabaseProjectId}.supabase.co/storage/v1/object/public/waiver-installers`
        : null;

      const installerBaseUrl =
        import.meta.env.VITE_INSTALLER_BASE_URL ||
        supabaseStorageUrl ||
        `${window.location.origin}/installers`;

      const links = {
        windows: `${installerBaseUrl}/Tavari-Waiver-Kiosk-Setup-1.0.0.exe`,
        mac: `${installerBaseUrl}/Tavari-Waiver-Kiosk.dmg`,
        linux: `${installerBaseUrl}/Tavari-Waiver-Kiosk.AppImage`
      };

      setDownloadLinks(links);

      await security.logSecurityEvent(
        'waiver_kiosk_download_page_accessed',
        {
          platform: currentPlatform || 'unknown',
          business_id: auth.selectedBusinessId
        },
        'low'
      );
    } catch (error) {
      console.error('Error loading download links:', error);
      toast.error('Failed to load download links');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenBrowserKiosk = () => {
    if (!openWaiverKioskInNewTab()) {
      toast.error('Popup blocked. Allow popups for this site to open the kiosk.');
    }
  };

  const handleOpenLegacyWaiverKiosk = () => {
    const id = auth.selectedBusinessId;
    if (!id) {
      toast.error('No business selected. Choose a business in the header, then try again.');
      return;
    }
    if (!openLegacyWaiverKioskInNewTab(id)) {
      toast.error('Popup blocked. Allow popups for this site to open the older-tablet browser kiosk.');
    }
  };

  const handleOpenLegacyDownloads = () => {
    if (!openLegacyKioskDownloadsInNewTab()) {
      toast.error('Popup blocked. Allow popups for this site to open the legacy downloads page.');
    }
  };

  const handleDownload = (platform) => {
    setSelectedPlatform(platform);
    setShowWarningModal(true);
  };

  const confirmDownload = () => {
    const link = downloadLinks[selectedPlatform];
    if (link) {
      window.open(link, '_blank');
      toast.success('Download started');
    }
    setShowWarningModal(false);
    setSelectedPlatform(null);
  };

  const copyBusinessId = async () => {
    const id = auth.selectedBusinessId;
    if (!id) {
      toast.error('No business selected. Choose a business in the app header, then try again.');
      return;
    }
    try {
      await navigator.clipboard.writeText(id);
      toast.success('Business ID copied to clipboard');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = id;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast.success('Business ID copied to clipboard');
      } catch {
        toast.error('Could not copy automatically — select the ID and copy manually');
      }
    }
  };

  if (auth.authLoading || loading) {
    return (
      <POSAuthWrapper componentName="WaiverKioskDownloadScreen">
        <div style={containerStyle}>
          <div style={styles.loading}>
            <p>Loading...</p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!elevated) {
    return (
      <POSAuthWrapper componentName="WaiverKioskDownloadScreen">
        <div style={containerStyle}>
          <div style={styles.loading}>
            <h2>Access denied</h2>
            <p>Kiosk downloads are available to managers and owners.</p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper componentName="WaiverKioskDownloadScreen">
      <div style={containerStyle}>
        <div style={styles.header}>
          <button type="button" onClick={() => navigate('/dashboard/waivers')} style={styles.backButton}>
            <FiArrowLeft style={styles.backIcon} />
            Back to Waivers
          </button>
          <FiTablet size={64} style={styles.headerIcon} />
          <h1 style={styles.title}>Waiver Kiosk</h1>
          <p style={subtitleStyle}>
            Open the kiosk in a browser for a tablet or second screen, or download the full-screen desktop
            app.
          </p>
        </div>

        <div style={contentStyle}>
          <div style={styles.businessIdCard}>
            <h3 style={styles.businessIdTitle}>Business ID</h3>
            <p style={styles.businessIdHelp}>
              Use this ID when the waiver kiosk asks for your business (browser tab or desktop app). Copy it
              before you open the kiosk on another device.
            </p>
            <div style={styles.businessIdRow}>
              <code style={styles.businessIdCode} title={auth.selectedBusinessId || ''}>
                {auth.selectedBusinessId || 'No business selected — pick one in the header'}
              </code>
              <button
                type="button"
                onClick={copyBusinessId}
                disabled={!auth.selectedBusinessId}
                style={{
                  ...styles.copyButton,
                  ...(!auth.selectedBusinessId ? styles.copyButtonDisabled : {})
                }}
              >
                <FiCopy style={styles.buttonIcon} aria-hidden />
                Copy
              </button>
            </div>
          </div>

          <div style={styles.browserKioskCard}>
            <h3 style={styles.browserKioskTitle}>Browser kiosk</h3>
            <p style={styles.browserKioskText}>
              Opens the waiver signing flow in a new tab. Use this on a device that already has a browser
              (e.g. iPad, Android tablet, or a second monitor).
            </p>
            <button type="button" style={styles.browserKioskButton} onClick={handleOpenBrowserKiosk}>
              <FiTablet style={styles.buttonIcon} />
              Open waiver kiosk in browser (new tab)
            </button>
          </div>

          <div style={styles.legacyKioskCard}>
            <h3 style={styles.browserKioskTitle}>Older tablet browser kiosk</h3>
            <p style={styles.browserKioskText}>
              Static browser-based waiver flow for older iPads and browsers that cannot run the main app stack.
              It is the replacement for the old legacy waiver page and is ready to be hosted from a dedicated
              subdomain later.
            </p>
            <button
              type="button"
              style={{
                ...styles.legacyKioskButton,
                ...(!auth.selectedBusinessId ? styles.legacyKioskButtonDisabled : {})
              }}
              onClick={handleOpenLegacyWaiverKiosk}
              disabled={!auth.selectedBusinessId}
            >
              <FiTablet style={styles.buttonIcon} />
              Open older-tablet waiver kiosk (new tab)
            </button>
          </div>

          <div style={styles.legacyKioskCard}>
            <h3 style={styles.browserKioskTitle}>Legacy downloads door</h3>
            <p style={styles.browserKioskText}>
              If this screen does not load on an old tablet, open this minimal page on that tablet instead.
              It has large download buttons for the Windows, macOS, and Linux kiosk installers (same files as
              below).
            </p>
            <button type="button" style={styles.legacyKioskButton} onClick={handleOpenLegacyDownloads}>
              <FiDownload style={styles.buttonIcon} />
              Open legacy downloads page (new tab)
            </button>
          </div>

          <h2 style={styles.installersHeading}>Desktop app installers</h2>
          <p style={styles.installersLead}>
            Full-screen app for dedicated waiver stations (optimized for older tablets).
          </p>

          <div style={styles.platformGrid}>
            <div style={styles.platformCard}>
              <h3 style={styles.platformTitle}>Windows</h3>
              <p style={styles.platformDescription}>.exe installer</p>
              <button type="button" onClick={() => handleDownload('windows')} style={styles.downloadButton}>
                <FiDownload style={styles.buttonIcon} />
                Download for Windows
              </button>
            </div>

            <div style={styles.platformCard}>
              <h3 style={styles.platformTitle}>macOS</h3>
              <p style={styles.platformDescription}>.dmg installer</p>
              <button type="button" onClick={() => handleDownload('mac')} style={styles.downloadButton}>
                <FiDownload style={styles.buttonIcon} />
                Download for macOS
              </button>
            </div>

            <div style={styles.platformCard}>
              <h3 style={styles.platformTitle}>Linux</h3>
              <p style={styles.platformDescription}>.AppImage</p>
              <button type="button" onClick={() => handleDownload('linux')} style={styles.downloadButton}>
                <FiDownload style={styles.buttonIcon} />
                Download for Linux
              </button>
            </div>
          </div>

          <div style={styles.infoBox}>
            <h3 style={styles.infoTitle}>About the desktop kiosk app</h3>
            <ul style={styles.infoList}>
              <li>Full-screen mode optimized for tablets</li>
              <li>Works on older iPads and Android tablets</li>
              <li>Auto-detects business ID from configuration</li>
              <li>Touch-optimized interface</li>
              <li>Continuous operation — stays on screen at all times</li>
            </ul>
          </div>
        </div>

        {showWarningModal && (
          <div style={styles.modalOverlay} onClick={() => setShowWarningModal(false)}>
            <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <FiAlertTriangle size={32} style={styles.warningIcon} />
                <h2 style={styles.modalTitle}>Download Warning</h2>
              </div>
              <div style={styles.modalContent}>
                <p>
                  The Waiver Kiosk desktop app is designed to run in full-screen kiosk mode. Make sure you
                  have the correct business ID configured before installing.
                </p>
                <p style={styles.modalSubtext}>
                  Platform: <strong>{selectedPlatform}</strong>
                </p>
              </div>
              <div style={styles.modalActions}>
                <button type="button" onClick={() => setShowWarningModal(false)} style={styles.modalCancelButton}>
                  <FiX style={styles.buttonIcon} />
                  Cancel
                </button>
                <button type="button" onClick={confirmDownload} style={styles.modalConfirmButton}>
                  <FiCheckCircle style={styles.buttonIcon} />
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

const styles = {
  container: {
    minHeight: '100vh',
    padding: TavariStyles.spacing.xl,
    paddingTop: 0,
    backgroundColor: TavariStyles.colors.background
  },
  header: {
    textAlign: 'center',
    marginBottom: TavariStyles.spacing.xl,
    position: 'relative'
  },
  backButton: {
    position: 'absolute',
    left: TavariStyles.spacing.xl,
    top: TavariStyles.spacing.xl,
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: 'transparent',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.xs,
    color: TavariStyles.colors.text
  },
  backIcon: {
    fontSize: '1rem'
  },
  headerIcon: {
    color: TavariStyles.colors.primary,
    marginBottom: TavariStyles.spacing.md
  },
  title: {
    fontSize: '2.5rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.sm
  },
  subtitle: {
    fontSize: '1.125rem',
    color: TavariStyles.colors.gray600,
    maxWidth: '640px',
    margin: '0 auto',
    lineHeight: 1.5
  },
  content: {
    maxWidth: '1000px',
    margin: '0 auto'
  },
  businessIdCard: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    marginBottom: TavariStyles.spacing.xl,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows.md
  },
  businessIdTitle: {
    fontSize: '1.125rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    margin: `0 0 ${TavariStyles.spacing.xs}`
  },
  businessIdHelp: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    margin: `0 0 ${TavariStyles.spacing.md}`,
    lineHeight: 1.5,
    maxWidth: '720px'
  },
  businessIdRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: TavariStyles.spacing.md
  },
  businessIdCode: {
    flex: '1 1 240px',
    minWidth: 0,
    display: 'block',
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.gray100 || '#F3F4F6',
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    fontSize: '0.8125rem',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    wordBreak: 'break-all',
    color: TavariStyles.colors.text
  },
  copyButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.xs,
    flexShrink: 0
  },
  copyButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed'
  },
  modalBusinessIdBox: {
    marginTop: TavariStyles.spacing.lg,
    padding: TavariStyles.spacing.md,
    backgroundColor: '#F9FAFB',
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  modalBusinessIdLabel: {
    display: 'block',
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.sm
  },
  modalBusinessIdRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm
  },
  modalBusinessIdCode: {
    flex: '1 1 200px',
    minWidth: 0,
    fontSize: '0.75rem',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    wordBreak: 'break-all',
    color: TavariStyles.colors.text
  },
  modalCopyButton: {
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.primary,
    border: `1px solid ${TavariStyles.colors.primary}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem'
  },
  browserKioskCard: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    marginBottom: TavariStyles.spacing.xl,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows.md,
    textAlign: 'center'
  },
  browserKioskTitle: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    margin: `0 0 ${TavariStyles.spacing.sm}`
  },
  browserKioskText: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    margin: `0 auto ${TavariStyles.spacing.lg}`,
    maxWidth: '520px',
    lineHeight: 1.5
  },
  browserKioskButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: TavariStyles.spacing.sm
  },
  legacyKioskCard: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    marginBottom: TavariStyles.spacing.xl,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows.md,
    textAlign: 'center'
  },
  legacyKioskButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.primary,
    border: `2px solid ${TavariStyles.colors.primary}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: TavariStyles.spacing.sm
  },
  legacyKioskButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed'
  },
  installersHeading: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    margin: `0 0 ${TavariStyles.spacing.xs}`
  },
  installersLead: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    margin: `0 0 ${TavariStyles.spacing.lg}`,
    lineHeight: 1.45
  },
  platformGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing.xl
  },
  platformCard: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows.md,
    textAlign: 'center'
  },
  platformTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.xs
  },
  platformDescription: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    marginBottom: TavariStyles.spacing.lg
  },
  downloadButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: TavariStyles.spacing.sm,
    width: '100%'
  },
  buttonIcon: {
    fontSize: '1.25rem'
  },
  infoBox: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows.md
  },
  infoTitle: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.md
  },
  infoList: {
    listStyle: 'disc',
    paddingLeft: TavariStyles.spacing.xl,
    color: TavariStyles.colors.text,
    lineHeight: '1.8'
  },
  loading: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xl
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000
  },
  modal: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    maxWidth: '500px',
    width: '90%',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows.xl
  },
  modalHeader: {
    textAlign: 'center',
    marginBottom: TavariStyles.spacing.lg
  },
  warningIcon: {
    color: '#F59E0B',
    marginBottom: TavariStyles.spacing.sm
  },
  modalTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text
  },
  modalContent: {
    marginBottom: TavariStyles.spacing.lg
  },
  modalSubtext: {
    marginTop: TavariStyles.spacing.md,
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600
  },
  modalActions: {
    display: 'flex',
    gap: TavariStyles.spacing.md,
    justifyContent: 'flex-end'
  },
  modalCancelButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
    backgroundColor: TavariStyles.colors.gray200,
    color: TavariStyles.colors.text,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm
  },
  modalConfirmButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm
  }
};

export default WaiverKioskDownloadScreen;
