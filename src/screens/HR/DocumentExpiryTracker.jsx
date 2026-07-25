// screens/HR/DocumentExpiryTracker.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, AlertTriangle, CheckCircle, Clock, FileText, User, Bell } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

// Import security and authentication
import { SecurityWrapper, useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';

const DocumentExpiryTracker = () => {
  const navigate = useNavigate();
  
  // Security context for sensitive document data
  const {
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'CertificateTracker',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication using standardized hook
  const {
    selectedBusinessId,
    authUser,
    userRole,
    businessData,
    authLoading,
    authError,
    isManager,
    isOwner
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin', 'hr_admin'],
    requireBusiness: true,
    componentName: 'CertificateTracker'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();
  
  // Tracker state (food safety, first aid, and other expiring certificates)
  const [expiringDocuments, setExpiringDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedDaysAhead, setSelectedDaysAhead] = useState(30);

  // Permission checks
  const canViewDocuments = hasAnyPermission([
    'hr.documents.view',
    'hr.documents.view_all'
  ]) || hasElevatedPrivileges();

  const canSendNotifications = hasPermission('hr.notifications.send') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewDocuments) {
      toast.error('You do not have permission to view certificates');
      navigate('/dashboard/hr/dashboard');
    }
  }, [permissionsLoading, canViewDocuments]);

  useEffect(() => {
    if (!selectedBusinessId || authLoading || permissionsLoading || !canViewDocuments) return;
    loadExpiringDocuments();
  }, [selectedBusinessId, selectedDaysAhead, authLoading, permissionsLoading, canViewDocuments]);

  const loadExpiringDocuments = async () => {
    if (!selectedBusinessId || !canViewDocuments) return;
    
    setLoading(true);
    try {
      await logSecurityEvent('document_expiry_access', {
        action: 'load_expiring_documents',
        business_id: selectedBusinessId,
        days_ahead: selectedDaysAhead
      }, 'low');

      const { data, error } = await supabase.rpc('get_expiring_documents', {
        p_business_id: selectedBusinessId,
        p_days_ahead: selectedDaysAhead
      });

      if (error) throw error;
      setExpiringDocuments(data || []);
      
      recordAction('view_expiring_documents', selectedBusinessId);
    } catch (error) {
      console.error('Error loading expiring documents:', error);
      toast.error('Failed to load expiring certificates');
      
      await logSecurityEvent('document_expiry_access_failed', {
        error_message: error.message,
        business_id: selectedBusinessId
      }, 'medium');
    } finally {
      setLoading(false);
    }
  };

  const sendExpiryNotifications = async () => {
    if (!canSendNotifications) {
      toast.error('You do not have permission to send notifications');
      return;
    }

    // Rate limiting check
    const canProceed = await checkRateLimit('send_notifications', 5, 3600);
    if (!canProceed) {
      toast.error('Notification limit reached. Please wait before sending more.');
      return;
    }

    try {
      await logSecurityEvent('notification_send_attempt', {
        action: 'send_document_expiry_notifications',
        business_id: selectedBusinessId
      }, 'medium');

      const { data, error } = await supabase.rpc('send_document_expiry_notifications');
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        const result = data[0];
        toast.success(`Sent ${result.notifications_sent} expiry notifications`);
        
        await logSecurityEvent('notifications_sent', {
          notifications_count: result.notifications_sent,
          business_id: selectedBusinessId,
          sent_by: authUser?.id
        }, 'low');
        
        recordAction('send_notifications', selectedBusinessId);
      }
    } catch (error) {
      console.error('Error sending notifications:', error);
      toast.error('Failed to send notifications');
      
      await logSecurityEvent('notification_send_failed', {
        error_message: error.message,
        business_id: selectedBusinessId
      }, 'high');
    }
  };

  const getExpiryStatusBadge = (status) => {
    const statusConfig = {
      'expired': { color: '#dc2626', bg: '#fee2e2', icon: AlertTriangle, text: 'Expired' },
      'expiring_soon': { color: '#d97706', bg: '#fef3c7', icon: Clock, text: 'Expiring Soon' },
      'expiring_later': { color: '#1e40af', bg: '#dbeafe', icon: Calendar, text: 'Expiring Later' },
      'valid': { color: '#059669', bg: '#d1fae5', icon: CheckCircle, text: 'Valid' }
    };

    const config = statusConfig[status] || statusConfig['valid'];
    const Icon = config.icon;

    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 10px',
        borderRadius: '20px',
        fontSize: '12px',
        fontWeight: '600',
        backgroundColor: config.bg,
        color: config.color
      }}>
        <Icon size={12} style={{ marginRight: '4px' }} />
        {config.text}
      </span>
    );
  };

  // Loading states
  if (permissionsLoading || authLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}></div>
        <p>Loading certificates…</p>
      </div>
    );
  }

  if (!canViewDocuments) {
    return (
      <div style={styles.errorContainer}>
        <AlertTriangle size={48} style={{ color: '#dc2626', marginBottom: '16px' }} />
        <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#1f2937' }}>Access Denied</h3>
        <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '8px' }}>
          You do not have permission to view certificates
        </p>
        <button
          onClick={() => navigate('/dashboard/hr/dashboard')}
          style={styles.backButton}
        >
          Return to HR Dashboard
        </button>
      </div>
    );
  }

  if (authError) {
    return (
      <div style={styles.errorContainer}>
        <AlertTriangle size={48} style={{ color: '#dc2626', marginBottom: '16px' }} />
        <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#1f2937' }}>Authentication Error</h3>
        <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '8px' }}>{authError}</p>
      </div>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'admin', 'hr_admin']}
      requireBusiness={true}
      componentName="CertificateTracker"
    >
      <SecurityWrapper>
        <div style={styles.container}>
          <div style={styles.header}>
            <h1 style={styles.title}>Certificates</h1>
            <p style={styles.subtitle}>
              Track food safety, first aid, and other expiring certificates and compliance documents. Wage premium rules
              for shifts are configured under Employee Management → Shift Premiums.
            </p>
          </div>

          <DocumentTrackerTab
            expiringDocuments={expiringDocuments}
            loading={loading}
            selectedDaysAhead={selectedDaysAhead}
            setSelectedDaysAhead={setSelectedDaysAhead}
            onSendNotifications={sendExpiryNotifications}
            getExpiryStatusBadge={getExpiryStatusBadge}
            canSendNotifications={canSendNotifications}
          />

          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

// Certificate expiry list (shared UI)
const DocumentTrackerTab = ({
  expiringDocuments,
  loading,
  selectedDaysAhead,
  setSelectedDaysAhead,
  onSendNotifications,
  getExpiryStatusBadge,
  canSendNotifications
}) => {
  const expiredCount = expiringDocuments.filter(doc => doc.expiry_status === 'expired').length;
  const expiringSoonCount = expiringDocuments.filter(doc => doc.expiry_status === 'expiring_soon').length;
  const inWindowCount = expiringDocuments.length;

  return (
    <div style={styles.tabContent}>
      <div style={styles.controlsCard}>
        <div style={styles.controlsContent}>
          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Show certificates expiring within:</label>
            <select
              value={selectedDaysAhead}
              onChange={(e) => setSelectedDaysAhead(parseInt(e.target.value, 10))}
              style={styles.formSelect}
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>

          {canSendNotifications && (
            <button type="button" onClick={onSendNotifications} style={styles.notificationButton}>
              <Bell size={16} style={{ marginRight: '8px' }} />
              Send Notifications
            </button>
          )}
        </div>
      </div>

      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <AlertTriangle size={24} style={{ color: '#dc2626' }} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryLabel}>Expired</div>
            <div style={styles.summaryValue}>{expiredCount}</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <Clock size={24} style={{ color: '#d97706' }} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryLabel}>Expiring soon</div>
            <div style={styles.summaryValue}>{expiringSoonCount}</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <CheckCircle size={24} style={{ color: '#059669' }} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryLabel}>In this window</div>
            <div style={styles.summaryValue}>{inWindowCount}</div>
          </div>
        </div>
      </div>

      <div style={styles.tableCard}>
        <div style={styles.tableHeader}>
          <h3 style={styles.tableTitle}>Certificates requiring attention</h3>
        </div>

        {loading ? (
          <div style={styles.loadingState}>
            <div style={styles.spinner} />
          </div>
        ) : expiringDocuments.length === 0 ? (
          <div style={styles.emptyState}>
            <FileText size={48} style={{ color: '#9ca3af', marginBottom: '16px' }} />
            <p style={{ color: '#6b7280' }}>No certificates expiring within {selectedDaysAhead} days</p>
          </div>
        ) : (
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead style={styles.thead}>
                <tr>
                  <th style={styles.th}>Employee</th>
                  <th style={styles.th}>Certificate / document</th>
                  <th style={styles.th}>Expiry date</th>
                  <th style={styles.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {expiringDocuments.map((doc) => (
                  <tr key={doc.document_id} style={styles.tr}>
                    <td style={styles.td}>
                      <div style={styles.employeeCell}>
                        <div style={styles.avatar}>
                          <User size={16} style={{ color: '#6b7280' }} />
                        </div>
                        <div style={styles.employeeName}>{doc.employee_name}</div>
                      </div>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.documentName}>{doc.file_name}</div>
                      <div style={styles.documentCategory}>
                        {doc.document_category.replace(/_/g, ' ')}
                      </div>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.expiryDate}>
                        {new Date(doc.expiry_date).toLocaleDateString()}
                      </div>
                      <div style={styles.daysRemaining}>
                        {doc.days_until_expiry >= 0
                          ? `${doc.days_until_expiry} days remaining`
                          : `${Math.abs(doc.days_until_expiry)} days overdue`
                        }
                      </div>
                    </td>
                    <td style={styles.td}>
                      {getExpiryStatusBadge(doc.expiry_status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    backgroundColor: '#f8f9fa',
    padding: '20px',
    paddingTop: '0px',
    boxSizing: 'border-box'
  },
  header: {
    marginBottom: '30px',
    textAlign: 'center'
  },
  title: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  subtitle: {
    fontSize: '16px',
    color: '#6b7280',
    marginTop: '8px'
  },
  tabContainer: {
    marginBottom: '30px',
    backgroundColor: 'white',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    overflow: 'hidden'
  },
  tabList: {
    display: 'flex',
    borderBottom: '1px solid #e5e7eb'
  },
  tab: {
    flex: 1,
    padding: '16px',
    backgroundColor: '#f8f9fa',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    color: '#6b7280',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.2s',
    borderRight: '1px solid #e5e7eb'
  },
  tabActive: {
    backgroundColor: '#008080',
    color: 'white'
  },
  tabContent: {
    flex: 1,
    overflowY: 'auto'
  },
  controlsCard: {
    backgroundColor: 'white',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    padding: '24px',
    marginBottom: '24px'
  },
  controlsContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: '20px',
    flexWrap: 'wrap'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column'
  },
  formLabel: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '6px'
  },
  formInput: {
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '12px'
  },
  formSelect: {
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '11px',
    backgroundColor: 'white'
  },
  formTextarea: {
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'vertical'
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '18px',
    fontWeight: '500',
    color: '#374151',
    cursor: 'pointer'
  },
  notificationButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 16px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '28px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
    marginBottom: '24px'
  },
  summaryCard: {
    backgroundColor: 'white',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    padding: '20px',
    display: 'flex',
    alignItems: 'center'
  },
  summaryIcon: {
    marginRight: '16px'
  },
  summaryContent: {
    flex: 1
  },
  summaryLabel: {
    fontSize: '14px',
    color: '#6b7280',
    marginBottom: '4px'
  },
  summaryValue: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  tableCard: {
    backgroundColor: 'white',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    overflow: 'hidden'
  },
  tableHeader: {
    padding: '20px 24px',
    borderBottom: '1px solid #e5e7eb'
  },
  tableTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#1f2937',
    margin: 0
  },
  tableContainer: {
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  thead: {
    backgroundColor: '#f8f9fa'
  },
  th: {
    padding: '12px 24px',
    textAlign: 'left',
    fontSize: '14px',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  tr: {
    borderBottom: '1px solid #e5e7eb'
  },
  td: {
    padding: '16px 24px',
    fontSize: '14px'
  },
  employeeCell: {
    display: 'flex',
    alignItems: 'center'
  },
  avatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: '#e5e7eb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '12px'
  },
  employeeName: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#1f2937'
  },
  documentName: {
    fontSize: '14px',
    color: '#1f2937',
    marginBottom: '4px'
  },
  documentCategory: {
    fontSize: '14px',
    color: '#6b7280',
    textTransform: 'capitalize'
  },
  expiryDate: {
    fontSize: '14px',
    color: '#1f2937',
    marginBottom: '4px'
  },
  daysRemaining: {
    fontSize: '24px',
    color: '#6b7280'
  },
  premiumBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 10px',
    borderRadius: '20px',
    fontSize: '18px',
    fontWeight: '600',
    backgroundColor: '#d1fae5',
    color: '#059669'
  },
  actionLink: {
    background: 'none',
    border: 'none',
    color: '#008080',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500',
    textDecoration: 'underline'
  },
  rulesHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
    backgroundColor: 'white',
    padding: '24px',
    borderRadius: '12px',
    border: '1px solid #e5e7eb'
  },
  rulesTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  rulesSubtitle: {
    fontSize: '14px',
    color: '#6b7280',
    marginTop: '4px'
  },
  addRuleButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 20px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  rulesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: '20px'
  },
  ruleCard: {
    backgroundColor: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '20px'
  },
  ruleHeader: {
    marginBottom: '16px',
    paddingBottom: '16px',
    borderBottom: '1px solid #e5e7eb'
  },
  ruleTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  ruleTitle: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '14px',
    fontWeight: '600'
  },
  ruleCategory: {
    fontSize: '13px',
    color: '#6b7280',
    textTransform: 'capitalize'
  },
  ruleBody: {
    marginBottom: '16px'
  },
  ruleDetail: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px'
  },
  ruleDetailLabel: {
    fontSize: '12px',
    color: '#6b7280'
  },
  ruleDetailValue: {
    fontSize: '14px',
    color: '#1f2937',
    fontWeight: '500'
  },
  ruleDescription: {
    marginTop: '12px',
    padding: '12px',
    backgroundColor: '#f8f9fa',
    borderRadius: '6px',
    fontSize: '20px',
    color: '#6b7280',
    fontStyle: 'italic'
  },
  ruleActions: {
    display: 'flex',
    gap: '8px'
  },
  ruleActionButton: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  ruleDeleteButton: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    maxWidth: '500px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column'
  },
  modalHeader: {
    padding: '24px',
    borderBottom: '1px solid #e5e7eb'
  },
  modalTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1f2937',
    margin: 0
  },
  modalBody: {
    padding: '24px',
    overflowY: 'auto',
    flex: 1
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '20px 24px',
    borderTop: '1px solid #e5e7eb'
  },
  modalCancelButton: {
    padding: '10px 20px',
    backgroundColor: 'white',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  modalSaveButton: {
    padding: '10px 20px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  modalCloseButton: {
    padding: '10px 20px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  premiumSummary: {
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '20px'
  },
  premiumRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '12px'
  },
  premiumLabel: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151'
  },
  premiumValue: {
    fontSize: '13px',
    color: '#1f2937'
  },
  premiumDetailCard: {
    fontSize: '13px',
    backgroundColor: '#dbeafe',
    borderRadius: '6px',
    padding: '12px'
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    gap: '16px'
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f8f9fa',
    padding: '40px'
  },
  backButton: {
    marginTop: '20px',
    padding: '12px 24px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  loadingState: {
    display: 'flex',
    justifyContent: 'center',
    padding: '60px'
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px',
    textAlign: 'center'
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #e5e7eb',
    borderTop: '3px solid #008080',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  }
};

export default DocumentExpiryTracker;