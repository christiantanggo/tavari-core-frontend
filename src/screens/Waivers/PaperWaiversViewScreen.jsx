// PaperWaiversViewScreen.jsx
// Secure view and search for paper waiver uploads with manager PIN protection
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiFile, FiSearch, FiLock, FiEye, FiDownload, FiCalendar, FiPhone, FiMail, FiUser } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { useWaiversShellStyle } from '../../contexts/WaiversShellContext';
import WaiverStorageService from '../../services/Waivers/WaiverStorageService';
import { supabase } from '../../supabaseClient';
import bcrypt from 'bcryptjs';
import toast from 'react-hot-toast';

const PaperWaiversViewScreen = () => {
  const navigate = useNavigate();

  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner', 'admin'],
    requireBusiness: true,
    componentName: 'PaperWaiversViewScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();
  const containerStyle = useWaiversShellStyle(styles.container);
  const security = useSecurityContext({
    enableRateLimiting: true,
    enableDeviceTracking: true,
    enableInputValidation: true,
    enableAuditLogging: true,
    componentName: 'PaperWaiversViewScreen',
    sensitiveComponent: true
  });

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinAttempts, setPinAttempts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [waivers, setWaivers] = useState([]);
  const [filteredWaivers, setFilteredWaivers] = useState([]);
  
  // Search filters
  const [searchFilters, setSearchFilters] = useState({
    lastName: '',
    phoneNumber: '',
    email: '',
    waiverFilledDate: '',
    uploadedDate: ''
  });

  useEffect(() => {
    if (auth.selectedBusinessId) {
      WaiverStorageService.setBusinessId(auth.selectedBusinessId);
    }
  }, [auth.selectedBusinessId]);

  // Load waivers after authentication
  useEffect(() => {
    if (isAuthenticated && auth.selectedBusinessId) {
      loadWaivers();
    }
  }, [isAuthenticated, auth.selectedBusinessId]);

  // Apply filters when they change
  useEffect(() => {
    if (isAuthenticated) {
      applyFilters();
    }
  }, [searchFilters, waivers, isAuthenticated]);

  const canView = hasPermission('waivers.view') || hasElevatedPrivileges();

  // Verify manager PIN
  const verifyManagerPIN = async () => {
    if (!pinInput || pinInput.length !== 4) {
      setPinError('Please enter a 4-digit PIN');
      return;
    }

    if (pinAttempts >= 3) {
      setPinError('Too many failed attempts. Access denied.');
      await security.logSecurityEvent('paper_waiver_access_denied', {
        reason: 'max_pin_attempts',
        attempts: pinAttempts
      }, 'high');
      return;
    }

    try {
      setLoading(true);
      setPinError('');

      const businessId = auth.selectedBusinessId;
      if (!businessId) {
        setPinError('Business ID not found');
        return;
      }

      // Get all managers/owners/admins for this business
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .eq('business_id', businessId)
        .eq('active', true)
        .in('role', ['manager', 'owner', 'admin']);

      if (rolesError || !userRoles || userRoles.length === 0) {
        setPinError('No managers found for this business');
        setPinAttempts(prev => prev + 1);
        return;
      }

      const managerUserIds = userRoles.map(ur => ur.user_id);

      // Get PINs for all managers
      const { data: managers, error: managersError } = await supabase
        .from('users')
        .select('id, full_name, email, pin')
        .in('id', managerUserIds)
        .not('pin', 'is', null);

      if (managersError || !managers || managers.length === 0) {
        setPinError('No managers with PINs configured');
        setPinAttempts(prev => prev + 1);
        return;
      }

      // Check PIN against all managers
      let pinMatched = false;
      let matchedManager = null;

      for (const manager of managers) {
        if (!manager.pin) continue;

        let matches = false;
        if (manager.pin.startsWith('$2b$') || manager.pin.startsWith('$2a$')) {
          matches = await bcrypt.compare(pinInput, manager.pin);
        } else {
          matches = String(manager.pin) === String(pinInput);
        }

        if (matches) {
          pinMatched = true;
          matchedManager = manager;
          break;
        }
      }

      if (pinMatched && matchedManager) {
        setIsAuthenticated(true);
        setPinInput('');
        setPinError('');
        setPinAttempts(0);
        
        // Log successful access
        await security.logSecurityEvent('paper_waiver_access_granted', {
          manager_id: matchedManager.id,
          manager_email: matchedManager.email,
          business_id: businessId
        }, 'medium');

        toast.success('Access granted');
      } else {
        const newAttempts = pinAttempts + 1;
        setPinAttempts(newAttempts);
        setPinError(`Invalid PIN. ${3 - newAttempts} attempts remaining.`);
        setPinInput('');

        // Log failed attempt
        await security.logSecurityEvent('paper_waiver_access_failed', {
          attempts: newAttempts,
          business_id: businessId
        }, 'high');

        if (newAttempts >= 3) {
          setPinError('Access denied. Too many failed attempts.');
          await security.logSecurityEvent('paper_waiver_access_denied', {
            reason: 'max_pin_attempts',
            attempts: newAttempts
          }, 'high');
        }
      }
    } catch (error) {
      console.error('Error verifying PIN:', error);
      setPinError('Error verifying PIN. Please try again.');
      await security.logSecurityEvent('paper_waiver_pin_error', {
        error: error.message,
        business_id: auth.selectedBusinessId
      }, 'high');
    } finally {
      setLoading(false);
    }
  };

  const loadWaivers = async () => {
    try {
      setLoading(true);
      const data = await WaiverStorageService.getUploadedWaivers({});
      setWaivers(data || []);
    } catch (error) {
      console.error('Error loading waivers:', error);
      toast.error('Error loading paper waivers');
      await security.logSecurityEvent('paper_waiver_load_error', {
        error: error.message,
        business_id: auth.selectedBusinessId
      }, 'high');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...waivers];

    if (searchFilters.lastName) {
      filtered = filtered.filter(w => 
        w.last_name?.toLowerCase().includes(searchFilters.lastName.toLowerCase())
      );
    }

    if (searchFilters.phoneNumber) {
      filtered = filtered.filter(w => 
        w.phone_number?.includes(searchFilters.phoneNumber.replace(/\D/g, ''))
      );
    }

    if (searchFilters.email) {
      filtered = filtered.filter(w => 
        w.email?.toLowerCase().includes(searchFilters.email.toLowerCase())
      );
    }

    if (searchFilters.waiverFilledDate) {
      filtered = filtered.filter(w => 
        w.waiver_filled_date === searchFilters.waiverFilledDate
      );
    }

    if (searchFilters.uploadedDate) {
      const uploadDate = new Date(searchFilters.uploadedDate).toISOString().split('T')[0];
      filtered = filtered.filter(w => {
        if (!w.uploaded_at) return false;
        const wDate = new Date(w.uploaded_at).toISOString().split('T')[0];
        return wDate === uploadDate;
      });
    }

    setFilteredWaivers(filtered);
  };

  const handleViewWaiver = async (waiver) => {
    try {
      // Log access to specific waiver
      await security.logSecurityEvent('paper_waiver_viewed', {
        waiver_upload_id: waiver.id,
        first_name: waiver.first_name,
        last_name: waiver.last_name,
        business_id: auth.selectedBusinessId
      }, 'medium');

      // Generate signed URL for secure access (valid for 1 hour)
      if (waiver.file_path) {
        const signedUrl = await WaiverStorageService.getSignedUrl(waiver.file_path, 3600);
        if (signedUrl) {
          window.open(signedUrl, '_blank', 'noopener,noreferrer');
        } else {
          toast.error('Failed to generate secure access URL');
        }
      } else {
        toast.error('Waiver file path not available');
      }
    } catch (error) {
      console.error('Error viewing waiver:', error);
      toast.error('Error opening waiver: ' + (error.message || 'Unknown error'));
      await security.logSecurityEvent('paper_waiver_view_error', {
        waiver_upload_id: waiver.id,
        error: error.message,
        business_id: auth.selectedBusinessId
      }, 'high');
    }
  };

  const handleDownloadWaiver = async (waiver) => {
    try {
      // Log download
      await security.logSecurityEvent('paper_waiver_downloaded', {
        waiver_upload_id: waiver.id,
        first_name: waiver.first_name,
        last_name: waiver.last_name,
        business_id: auth.selectedBusinessId
      }, 'medium');

      // Generate signed URL for secure download (valid for 1 hour)
      if (waiver.file_path) {
        const signedUrl = await WaiverStorageService.getSignedUrl(waiver.file_path, 3600);
        if (signedUrl) {
          const link = document.createElement('a');
          link.href = signedUrl;
          link.download = `${waiver.last_name}_${waiver.first_name}_waiver.${waiver.file_path.split('.').pop() || 'pdf'}`;
          link.target = '_blank';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          toast.success('Waiver download started');
        } else {
          toast.error('Failed to generate secure download URL');
        }
      } else {
        toast.error('Waiver file path not available');
      }
    } catch (error) {
      console.error('Error downloading waiver:', error);
      toast.error('Error downloading waiver: ' + (error.message || 'Unknown error'));
      await security.logSecurityEvent('paper_waiver_download_error', {
        waiver_upload_id: waiver.id,
        error: error.message,
        business_id: auth.selectedBusinessId
      }, 'high');
    }
  };

  const handleFilterChange = (field, value) => {
    setSearchFilters(prev => ({ ...prev, [field]: value }));
  };

  const clearFilters = () => {
    setSearchFilters({
      lastName: '',
      phoneNumber: '',
      email: '',
      waiverFilledDate: '',
      uploadedDate: ''
    });
  };

  if (auth.authLoading) {
    return (
      <POSAuthWrapper componentName="PaperWaiversViewScreen">
        <div style={TavariStyles.loadingContainer}>
          <p>Loading...</p>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!canView) {
    return (
      <POSAuthWrapper componentName="PaperWaiversViewScreen">
        <div style={TavariStyles.errorContainer}>
          <h2>Access Denied</h2>
          <p>You do not have permission to view paper waivers.</p>
        </div>
      </POSAuthWrapper>
    );
  }

  // PIN authentication screen
  if (!isAuthenticated) {
    return (
      <POSAuthWrapper componentName="PaperWaiversViewScreen">
        <SecurityWrapper componentName="PaperWaiversViewScreen" sensitiveComponent={true}>
          <div style={styles.pinContainer}>
            <div style={styles.pinCard}>
              <FiLock size={48} style={styles.lockIcon} />
              <h2 style={styles.pinTitle}>Manager PIN Required</h2>
              <p style={styles.pinSubtitle}>
                Access to paper waivers requires manager PIN verification
              </p>
              
              <div style={styles.pinInputContainer}>
                <input
                  type="password"
                  style={{
                    ...styles.pinInput,
                    ...(pinError && styles.pinInputError)
                  }}
                  value={pinInput}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setPinInput(value);
                    setPinError('');
                  }}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && pinInput.length === 4) {
                      verifyManagerPIN();
                    }
                  }}
                  placeholder="Enter 4-digit PIN"
                  maxLength={4}
                  autoFocus
                  disabled={loading || pinAttempts >= 3}
                />
              </div>

              {pinError && (
                <p style={styles.errorText}>{pinError}</p>
              )}

              {pinAttempts > 0 && pinAttempts < 3 && (
                <p style={styles.attemptsText}>
                  {3 - pinAttempts} attempts remaining
                </p>
              )}

              <button
                style={{
                  ...styles.pinButton,
                  ...((loading || pinInput.length !== 4 || pinAttempts >= 3) && styles.pinButtonDisabled)
                }}
                onClick={verifyManagerPIN}
                disabled={loading || pinInput.length !== 4 || pinAttempts >= 3}
              >
                {loading ? 'Verifying...' : 'Verify PIN'}
              </button>

              <button
                style={styles.cancelButton}
                onClick={() => navigate('/dashboard/waivers')}
              >
                Cancel
              </button>
            </div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  // Main view screen
  return (
    <POSAuthWrapper componentName="PaperWaiversViewScreen">
      <SecurityWrapper componentName="PaperWaiversViewScreen" sensitiveComponent={true}>
        <div style={containerStyle}>
          {/* Search Filters */}
          <div style={styles.searchSection}>
            <h3 style={styles.sectionTitle}>
              <FiSearch size={20} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
              Search Filters
            </h3>
            <div style={styles.filterGrid}>
              <div style={styles.filterField}>
                <label style={styles.filterLabel}>
                  <FiUser size={16} style={{ marginRight: '4px' }} />
                  Last Name
                </label>
                <input
                  type="text"
                  style={styles.filterInput}
                  value={searchFilters.lastName}
                  onChange={(e) => handleFilterChange('lastName', e.target.value)}
                  placeholder="Enter last name"
                />
              </div>

              <div style={styles.filterField}>
                <label style={styles.filterLabel}>
                  <FiPhone size={16} style={{ marginRight: '4px' }} />
                  Phone Number
                </label>
                <input
                  type="tel"
                  style={styles.filterInput}
                  value={searchFilters.phoneNumber}
                  onChange={(e) => handleFilterChange('phoneNumber', e.target.value)}
                  placeholder="Enter phone number"
                />
              </div>

              <div style={styles.filterField}>
                <label style={styles.filterLabel}>
                  <FiMail size={16} style={{ marginRight: '4px' }} />
                  Email
                </label>
                <input
                  type="email"
                  style={styles.filterInput}
                  value={searchFilters.email}
                  onChange={(e) => handleFilterChange('email', e.target.value)}
                  placeholder="Enter email"
                />
              </div>

              <div style={styles.filterField}>
                <label style={styles.filterLabel}>
                  <FiCalendar size={16} style={{ marginRight: '4px' }} />
                  Waiver Filled Date
                </label>
                <input
                  type="date"
                  style={styles.filterInput}
                  value={searchFilters.waiverFilledDate}
                  onChange={(e) => handleFilterChange('waiverFilledDate', e.target.value)}
                />
              </div>

              <div style={styles.filterField}>
                <label style={styles.filterLabel}>
                  <FiCalendar size={16} style={{ marginRight: '4px' }} />
                  Uploaded Date
                </label>
                <input
                  type="date"
                  style={styles.filterInput}
                  value={searchFilters.uploadedDate}
                  onChange={(e) => handleFilterChange('uploadedDate', e.target.value)}
                />
              </div>

              <div style={styles.filterField}>
                <button
                  style={styles.clearButton}
                  onClick={clearFilters}
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </div>

          {/* Results */}
          <div style={styles.resultsSection}>
            <div style={styles.resultsHeader}>
              <h3 style={styles.sectionTitle}>
                Results ({filteredWaivers.length})
              </h3>
              <button
                style={styles.refreshButton}
                onClick={loadWaivers}
                disabled={loading}
              >
                Refresh
              </button>
            </div>

            {loading ? (
              <div style={styles.loadingState}>
                <p>Loading waivers...</p>
              </div>
            ) : filteredWaivers.length === 0 ? (
              <div style={styles.emptyState}>
                <FiFile size={48} style={{ color: TavariStyles.colors.gray400, marginBottom: '16px' }} />
                <p>No waivers found matching your search criteria</p>
              </div>
            ) : (
              <div style={styles.waiverList}>
                {filteredWaivers.map((waiver) => (
                  <div key={waiver.id} style={styles.waiverCard}>
                    <div style={styles.waiverInfo}>
                      <h4 style={styles.waiverName}>
                        {waiver.first_name} {waiver.last_name}
                      </h4>
                      <div style={styles.waiverDetails}>
                        {waiver.phone_number && (
                          <span style={styles.detailItem}>
                            <FiPhone size={14} /> {waiver.phone_number}
                          </span>
                        )}
                        {waiver.email && (
                          <span style={styles.detailItem}>
                            <FiMail size={14} /> {waiver.email}
                          </span>
                        )}
                        {waiver.waiver_filled_date && (
                          <span style={styles.detailItem}>
                            <FiCalendar size={14} /> Waiver Date: {new Date(waiver.waiver_filled_date).toLocaleDateString()}
                          </span>
                        )}
                        {waiver.uploaded_at && (
                          <span style={styles.detailItem}>
                            Uploaded: {new Date(waiver.uploaded_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={styles.waiverActions}>
                      <button
                        style={styles.viewButton}
                        onClick={() => handleViewWaiver(waiver)}
                        title="View Waiver"
                      >
                        <FiEye size={18} />
                      </button>
                      <button
                        style={styles.downloadButton}
                        onClick={() => handleDownloadWaiver(waiver)}
                        title="Download Waiver"
                      >
                        <FiDownload size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.background || TavariStyles.colors.gray50,
    padding: TavariStyles.spacing.xl,
    paddingTop: 0
  },
  pinContainer: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TavariStyles.colors.gray900,
    padding: 'clamp(16px, 4vw, 32px)'
  },
  pinCard: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: 'clamp(20px, 4vw, 32px)',
    maxWidth: 'min(400px, 100%)',
    width: '100%',
    textAlign: 'center',
    boxShadow: TavariStyles.shadows?.lg || '0 10px 40px rgba(0,0,0,0.2)',
    boxSizing: 'border-box'
  },
  lockIcon: {
    color: TavariStyles.colors.primary,
    marginBottom: TavariStyles.spacing.md
  },
  pinTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.sm
  },
  pinSubtitle: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    marginBottom: TavariStyles.spacing.xl
  },
  pinInputContainer: {
    marginBottom: TavariStyles.spacing.md,
    width: '100%'
  },
  pinInput: {
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    padding: '14px 16px',
    fontSize: 'clamp(16px, 2.4vw, 20px)',
    letterSpacing: 'clamp(1px, 0.5vw, 4px)',
    textAlign: 'center',
    border: `2px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontFamily: 'monospace',
    fontWeight: 'bold'
  },
  pinInputError: {
    borderColor: TavariStyles.colors.error,
    backgroundColor: TavariStyles.colors.errorBg || '#fee'
  },
  errorText: {
    color: TavariStyles.colors.error,
    fontSize: TavariStyles.typography.fontSize.sm,
    marginBottom: TavariStyles.spacing.sm
  },
  attemptsText: {
    color: TavariStyles.colors.warning,
    fontSize: TavariStyles.typography.fontSize.sm,
    marginBottom: TavariStyles.spacing.md
  },
  pinButton: {
    width: '100%',
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600',
    cursor: 'pointer',
    marginBottom: TavariStyles.spacing.sm
  },
  pinButtonDisabled: {
    backgroundColor: TavariStyles.colors.gray300,
    cursor: 'not-allowed',
    opacity: 0.6
  },
  cancelButton: {
    width: '100%',
    padding: TavariStyles.spacing.sm,
    backgroundColor: 'transparent',
    color: TavariStyles.colors.gray600,
    border: 'none',
    fontSize: TavariStyles.typography.fontSize.sm,
    cursor: 'pointer'
  },
  header: {
    textAlign: 'center',
    marginBottom: TavariStyles.spacing.xl
  },
  headerIcon: {
    color: TavariStyles.colors.primary,
    marginBottom: TavariStyles.spacing.md
  },
  title: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.sm
  },
  subtitle: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray600
  },
  searchSection: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    marginBottom: TavariStyles.spacing.xl,
    boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
  },
  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.md
  },
  filterGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: TavariStyles.spacing.md
  },
  filterField: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs
  },
  filterLabel: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    display: 'flex',
    alignItems: 'center'
  },
  filterInput: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: TavariStyles.typography.fontSize.base
  },
  clearButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.gray200,
    color: TavariStyles.colors.text,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600',
    marginTop: '20px'
  },
  resultsSection: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
  },
  resultsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: TavariStyles.spacing.md
  },
  refreshButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600'
  },
  waiverList: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md
  },
  waiverCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    backgroundColor: TavariStyles.colors.white,
    transition: 'all 0.2s ease'
  },
  waiverInfo: {
    flex: 1
  },
  waiverName: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.xs
  },
  waiverDetails: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: TavariStyles.spacing.md,
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600
  },
  detailItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  waiverActions: {
    display: 'flex',
    gap: TavariStyles.spacing.sm
  },
  viewButton: {
    padding: TavariStyles.spacing.sm,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  downloadButton: {
    padding: TavariStyles.spacing.sm,
    backgroundColor: TavariStyles.colors.success,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  loadingState: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xl,
    color: TavariStyles.colors.gray600
  },
  emptyState: {
    textAlign: 'center',
    padding: TavariStyles.spacing['2xl'],
    color: TavariStyles.colors.gray600
  }
};

export default PaperWaiversViewScreen;

