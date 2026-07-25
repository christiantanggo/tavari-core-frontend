// Step 83: Create WaiverSearchScreen.jsx
// Staff waiver search interface
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiSearch, FiFileText, FiUser } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useWaiversShellStyle } from '../../contexts/WaiversShellContext';
import WaiverSearchBar from '../../components/Waivers/WaiverSearchBar';
import WaiverStatusBadge from '../../components/Waivers/WaiverStatusBadge';
import WaiverSearchService from '../../services/Waivers/WaiverSearchService';
import toast from 'react-hot-toast';
import { formatDateOfBirthDisplay } from '../../utils/waiverDateOfBirth';

const WaiverSearchScreen = () => {
  const navigate = useNavigate();

  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'WaiverSearchScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();
  const containerStyle = useWaiversShellStyle(styles.container);
  const security = useSecurityContext({
    enableRateLimiting: true,
    enableDeviceTracking: true,
    enableInputValidation: true,
    enableAuditLogging: true,
    componentName: 'WaiverSearchScreen',
    sensitiveComponent: true
  });

  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState('phone');

  useEffect(() => {
    if (auth.selectedBusinessId) {
      WaiverSearchService.setBusinessId(auth.selectedBusinessId);
    }
  }, [auth.selectedBusinessId]);

  const canViewWaivers = hasPermission('waivers.view') || hasElevatedPrivileges();

  const handleSearch = async (term, type, filters) => {
    if (!term || term.trim() === '') {
      setSearchResults([]);
      return;
    }

    setLoading(true);
    setSearchTerm(term);
    setSearchType(type);

    try {
      let results = [];

      switch (type) {
        case 'phone':
          results = await WaiverSearchService.searchByPhone(term);
          break;
        case 'email':
          results = await WaiverSearchService.searchByEmail(term);
          break;
        case 'name':
          const nameParts = term.split(' ');
          results = await WaiverSearchService.searchByName(
            nameParts[0] || '',
            nameParts[1] || ''
          );
          break;
        case 'qr':
          const qrResult = await WaiverSearchService.searchByQR(term);
          results = qrResult ? [qrResult] : [];
          break;
        default:
          results = await WaiverSearchService.fuzzySearch(term);
      }

      // Apply filters
      if (filters.status) {
        results = results.filter(w => {
          if (filters.status === 'valid') return w.is_valid && !isWaiverExpired(w.expires_at);
          if (filters.status === 'expired') return isWaiverExpired(w.expires_at);
          if (filters.status === 'expiring_soon') {
            if (!w.expires_at) return false;
            const daysUntilExpiry = Math.ceil((new Date(w.expires_at) - new Date()) / (1000 * 60 * 60 * 24));
            return daysUntilExpiry <= 30 && daysUntilExpiry > 0;
          }
          if (filters.status === 'invalid') return !w.is_valid;
          return true;
        });
      }

      setSearchResults(results);
    } catch (error) {
      console.error('Error searching waivers:', error);
      toast.error('Error searching waivers');
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const isWaiverExpired = (expiresAt) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) <= new Date();
  };

  if (auth.authLoading) {
    return (
      <POSAuthWrapper componentName="WaiverSearchScreen">
        <div style={TavariStyles.loadingContainer}>
          <p>Loading...</p>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!canViewWaivers) {
    return (
      <POSAuthWrapper componentName="WaiverSearchScreen">
        <div style={TavariStyles.errorContainer}>
          <h2>Access Denied</h2>
          <p>You do not have permission to search waivers.</p>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper componentName="WaiverSearchScreen">
      <SecurityWrapper componentName="WaiverSearchScreen" sensitiveComponent={true}>
        <div style={containerStyle}>
          <div style={styles.header}>
            <FiSearch size={32} style={styles.headerIcon} />
            <h1 style={styles.title}>Search Waivers</h1>
            <p style={styles.subtitle}>Find waivers by phone, name, email, or QR code</p>
          </div>

          <WaiverSearchBar
            onSearch={handleSearch}
            defaultSearchType="phone"
          />

          {loading && (
            <div style={styles.loading}>
              <p>Searching...</p>
            </div>
          )}

          {!loading && searchResults.length > 0 && (
            <div style={styles.results}>
              <h3 style={styles.resultsTitle}>
                Found {searchResults.length} waiver{searchResults.length !== 1 ? 's' : ''}
              </h3>
              <div style={styles.resultsList}>
                {searchResults.map(waiver => (
                  <div
                    key={waiver.id}
                    style={styles.resultCard}
                    onClick={() => navigate(`/dashboard/waivers/${waiver.id}`)}
                  >
                    <div style={styles.resultHeader}>
                      <div style={styles.resultInfo}>
                        <h4 style={styles.resultName}>
                          {waiver.first_name} {waiver.last_name}
                        </h4>
                        <p style={styles.resultDetails}>
                          {waiver.email && <span>{waiver.email}</span>}
                          {waiver.phone_number && <span>{waiver.phone_number}</span>}
                          {waiver.date_of_birth && (
                            <span>DOB: {formatDateOfBirthDisplay(waiver.date_of_birth)}</span>
                          )}
                        </p>
                        {waiver.signed_at && (
                          <p style={styles.resultDate}>
                            Signed: {new Date(waiver.signed_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <WaiverStatusBadge waiver={waiver} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && searchTerm && searchResults.length === 0 && (
            <div style={styles.noResults}>
              <FiFileText size={48} style={{ color: TavariStyles.colors.gray400 }} />
              <p>No waivers found matching your search</p>
            </div>
          )}
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.background,
    padding: TavariStyles.spacing.xl,
    paddingTop: 0
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
  loading: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xl,
    color: TavariStyles.colors.gray600
  },
  results: {
    marginTop: TavariStyles.spacing.xl
  },
  resultsTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.md
  },
  resultsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md
  },
  resultCard: {
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.md,
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  resultHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start'
  },
  resultInfo: {
    flex: 1
  },
  resultName: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    margin: 0,
    marginBottom: TavariStyles.spacing.xs
  },
  resultDetails: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: TavariStyles.spacing.xs,
    display: 'flex',
    gap: TavariStyles.spacing.md,
    flexWrap: 'wrap'
  },
  resultDateBlock: {
    marginTop: TavariStyles.spacing.xs
  },
  resultDate: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500,
    margin: 0
  },
  resultExpiresSub: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginTop: '4px'
  },
  noResults: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xl,
    color: TavariStyles.colors.gray600
  }
};

export default WaiverSearchScreen;




