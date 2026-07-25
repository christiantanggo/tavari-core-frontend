// Step 85: Create WaiverListScreen.jsx
// List view of waivers with filters
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiFileText, FiDownload, FiFilter } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useWaiversShellStyle } from '../../contexts/WaiversShellContext';
import { useWaivers } from '../../hooks/useWaivers';
import WaiverSearchBar from '../../components/Waivers/WaiverSearchBar';
import WaiverStatusBadge from '../../components/Waivers/WaiverStatusBadge';
import WaiverExportService from '../../services/Waivers/waiverExportService';
import WaiverSettingsService from '../../services/Waivers/WaiverSettingsService';
import toast from 'react-hot-toast';

const WaiverListScreen = () => {
  const navigate = useNavigate();

  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'WaiverListScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();
  const containerStyle = useWaiversShellStyle(styles.container);
  const security = useSecurityContext({
    enableRateLimiting: true,
    enableDeviceTracking: true,
    enableInputValidation: true,
    enableAuditLogging: true,
    componentName: 'WaiverListScreen',
    sensitiveComponent: true
  });

  const [filters, setFilters] = useState({});
  const { waivers, loading, refresh } = useWaivers(filters, { businessId: auth.selectedBusinessId });
  const [selectedWaivers, setSelectedWaivers] = useState([]);
  const [stationDisplayNamesByTemplateId, setStationDisplayNamesByTemplateId] = useState({});

  useEffect(() => {
    if (auth.selectedBusinessId) {
      WaiverExportService.setBusinessId(auth.selectedBusinessId);
    }
  }, [auth.selectedBusinessId]);

  useEffect(() => {
    let cancelled = false;

    const loadWaiverDisplayNames = async () => {
      if (!auth.selectedBusinessId) {
        setStationDisplayNamesByTemplateId({});
        return;
      }

      try {
        WaiverSettingsService.setBusinessId(auth.selectedBusinessId);
        const settings = await WaiverSettingsService.getGlobalSettings();
        if (cancelled) return;

        const configuredTemplates = Array.isArray(settings?.waiver_station_templates)
          ? settings.waiver_station_templates
          : [];

        const nextMap = configuredTemplates.reduce((acc, item) => {
          const templateId = String(item?.templateId || '').trim();
          const displayName = String(item?.displayName || '').trim();
          if (templateId && displayName) {
            acc[templateId] = displayName;
          }
          return acc;
        }, {});

        setStationDisplayNamesByTemplateId(nextMap);
      } catch (error) {
        console.error('Error loading waiver display names:', error);
        if (!cancelled) {
          setStationDisplayNamesByTemplateId({});
        }
      }
    };

    loadWaiverDisplayNames();

    return () => {
      cancelled = true;
    };
  }, [auth.selectedBusinessId]);

  const canViewWaivers = hasPermission('waivers.view') || hasElevatedPrivileges();
  const canExport = hasPermission('waivers.export') || hasElevatedPrivileges();

  const handleExport = async (format) => {
    try {
      if (format === 'csv') {
        await WaiverExportService.exportToCSV(filters);
        toast.success('Waivers exported to CSV');
      } else if (format === 'pdf') {
        await WaiverExportService.generateWaiverReport(filters);
        toast.success('Waiver report generated');
      }
    } catch (error) {
      console.error('Error exporting:', error);
      toast.error('Error exporting waivers');
    }
  };

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
  };

  const getWaiverDisplayName = (waiver) => {
    const template = waiver?.waiver_templates;
    const configuredDisplayName = template?.id
      ? stationDisplayNamesByTemplateId[String(template.id)]
      : '';

    return (
      configuredDisplayName ||
      template?.waiver_title ||
      template?.template_name ||
      'Waiver'
    );
  };

  if (auth.authLoading) {
    return (
      <POSAuthWrapper componentName="WaiverListScreen">
        <div style={TavariStyles.loadingContainer}>
          <p>Loading...</p>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!canViewWaivers) {
    return (
      <POSAuthWrapper componentName="WaiverListScreen">
        <div style={TavariStyles.errorContainer}>
          <h2>Access Denied</h2>
          <p>You do not have permission to view waivers.</p>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper componentName="WaiverListScreen">
      <SecurityWrapper componentName="WaiverListScreen" sensitiveComponent={true}>
        <div style={containerStyle}>
          <div style={styles.header}>
            <FiFileText size={32} style={styles.headerIcon} />
            <h1 style={styles.title}>Waivers</h1>
            <div style={styles.headerActions}>
              {canExport && (
                <div style={styles.exportButtons}>
                  <button
                    onClick={() => handleExport('csv')}
                    style={styles.exportButton}
                  >
                    <FiDownload /> Export CSV
                  </button>
                  <button
                    onClick={() => handleExport('pdf')}
                    style={styles.exportButton}
                  >
                    <FiDownload /> Export PDF
                  </button>
                </div>
              )}
            </div>
          </div>

          <WaiverSearchBar
            onSearch={(term, type, searchFilters) => {
              setFilters({ ...filters, ...searchFilters, search: term, searchType: type });
            }}
            onFilterChange={handleFilterChange}
          />

          {loading ? (
            <div style={styles.loading}>
              <p>Loading waivers...</p>
            </div>
          ) : waivers.length > 0 ? (
            <div style={styles.waiversList}>
              {waivers.map(waiver => (
                <div
                  key={waiver.id}
                  style={styles.waiverCard}
                  onClick={() => navigate(`/dashboard/waivers/${waiver.id}`)}
                >
                  <div style={styles.waiverHeader}>
                    <div style={styles.waiverInfo}>
                      <h4 style={styles.waiverName}>
                        {waiver.first_name} {waiver.last_name}
                      </h4>
                      <p style={styles.waiverDetails}>
                        {waiver.email && <span>{waiver.email}</span>}
                        {waiver.phone_number && <span>{waiver.phone_number}</span>}
                        <span>Waiver: {getWaiverDisplayName(waiver)}</span>
                      </p>
                      {waiver.signed_at && (
                        <p style={styles.waiverDate}>
                          Signed: {new Date(waiver.signed_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <WaiverStatusBadge waiver={waiver} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.emptyState}>
              <FiFileText size={48} style={{ color: TavariStyles.colors.gray400 }} />
              <p>No waivers found</p>
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
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: TavariStyles.spacing.xl
  },
  headerIcon: {
    color: TavariStyles.colors.primary
  },
  title: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    margin: 0
  },
  headerActions: {
    display: 'flex',
    gap: TavariStyles.spacing.sm
  },
  exportButtons: {
    display: 'flex',
    gap: TavariStyles.spacing.sm
  },
  exportButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.xs,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  loading: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xl,
    color: TavariStyles.colors.gray600
  },
  waiversList: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md
  },
  waiverCard: {
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.md,
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  waiverHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start'
  },
  waiverInfo: {
    flex: 1
  },
  waiverName: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    margin: 0,
    marginBottom: TavariStyles.spacing.xs
  },
  waiverDetails: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: TavariStyles.spacing.xs,
    display: 'flex',
    gap: TavariStyles.spacing.md,
    flexWrap: 'wrap'
  },
  waiverDateBlock: {
    marginTop: TavariStyles.spacing.xs
  },
  waiverDate: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500,
    margin: 0
  },
  waiverExpiresSub: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginTop: '4px'
  },
  emptyState: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xl,
    color: TavariStyles.colors.gray600
  }
};

export default WaiverListScreen;




