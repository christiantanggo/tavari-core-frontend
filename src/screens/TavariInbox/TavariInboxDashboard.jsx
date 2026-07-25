import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import toast from 'react-hot-toast';
import {
  FiInbox,
  FiRefreshCw,
  FiShield,
  FiEdit3
} from 'react-icons/fi';
import MailboxManagement from '../../components/Inbox/MailboxManagement';
import EmailInbox from '../../components/Inbox/EmailInbox';
import EmailHistory from '../../components/Inbox/EmailHistory';
import InboxSignatureSettings from '../../components/Inbox/InboxSignatureSettings';

const domainStatusStyles = {
  verified: {
    backgroundColor: '#e8f5e8',
    color: '#2e7d32',
    borderColor: '#4caf50'
  },
  pending: {
    backgroundColor: '#fff3cd',
    color: '#856404',
    borderColor: '#ff9800'
  },
  failed: {
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderColor: '#f44336'
  }
};

const normalizeDomainStatus = (value) => {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'success' || status === 'verified') return 'verified';
  if (status === 'failed') return 'failed';
  return 'pending';
};

const formatDnsRecordRow = (record, idx) => {
  if (!record) return null;
  return (
    <div key={`${record.name}-${idx}`} style={styles.dnsRow}>
      <span style={styles.dnsType}>{record.type}</span>
      <div style={styles.dnsDetails}>
        <span style={styles.dnsHost}>{record.name}</span>
        <span style={styles.dnsValue}>{record.value}</span>
      </div>
    </div>
  );
};

const TavariInboxDashboard = () => {
  const { business } = useBusiness();
  const {
    selectedBusinessId,
    authLoading,
    permissionsLoading,
    authError,
    authUser
  } = usePOSAuth({
    requiredRoles: null, // Use permissions instead of hardcoded roles
    requireBusiness: true,
    componentName: 'TavariInboxDashboard'
  });

  const { hasPermission, hasAnyPermission, hasElevatedPrivileges } = usePermissions();
  const {
    checkRateLimit,
    logSecurityEvent,
    recordAction
  } = useSecurityContext({
    componentName: 'TavariInboxDashboard',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  const businessId = selectedBusinessId || business?.id;
  
  // State declarations
  const [mailDomains, setMailDomains] = useState([]);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [showAddDomainModal, setShowAddDomainModal] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [submittingDomain, setSubmittingDomain] = useState(false);
  const [checkingDomainId, setCheckingDomainId] = useState(null);
  const [activeTab, setActiveTab] = useState('inbox');
  const [newMessageRequest, setNewMessageRequest] = useState(0);

  // Check inbox permissions - use domains.edit for managing domains
  const canManageDomains = hasPermission('inbox.domains.edit') || hasElevatedPrivileges();
  const canViewDomains = hasPermission('inbox.domains.view') || hasPermission('inbox.domains.edit') || hasElevatedPrivileges();
  const canViewMailboxes = hasPermission('inbox.mailboxes.view') || hasElevatedPrivileges();
  const canViewSettings = hasPermission('inbox.settings.view') || hasElevatedPrivileges();

  // Tab configuration with permission-based filtering
  const tabs = [
    { 
      id: 'inbox', 
      label: 'Inbox', 
      icon: '📥', 
      description: 'View and manage received emails',
      requiredPermissions: ['inbox.emails.view'],
      requiresElevated: false
    },
    {
      id: 'history',
      label: 'History',
      icon: '📨',
      description: 'View outbound system email history',
      requiredPermissions: ['inbox.emails.view'],
      requiresElevated: false
    },
    { 
      id: 'domains', 
      label: 'Domains', 
      icon: '🌐', 
      description: 'Verify and manage email domains',
      requiredPermissions: ['inbox.domains.view'],
      requiresElevated: false
    },
    { 
      id: 'mailboxes', 
      label: 'Mailboxes', 
      icon: '📬', 
      description: 'Manage mailboxes and forwarding',
      requiredPermissions: ['inbox.mailboxes.view'],
      requiresElevated: false
    },
    { 
      id: 'settings', 
      label: 'Settings', 
      icon: '⚙️', 
      description: 'Storage, compliance, and configuration',
      requiredPermissions: ['inbox.settings.view'],
      requiresElevated: false
    }
  ];

  // Filter tabs based on user permissions (memoized)
  const availableTabs = useMemo(() => {
    return tabs.filter(tab => {
      // Check if user has elevated privileges if required
      if (tab.requiresElevated && !hasElevatedPrivileges()) {
        return false;
      }
      
      // Check if user has any of the required permissions
      if (tab.requiredPermissions && tab.requiredPermissions.length > 0) {
        return hasAnyPermission(tab.requiredPermissions);
      }
      
      return true;
    });
  }, [hasElevatedPrivileges, hasAnyPermission, permissionsLoading]);

  // Set default tab to first available tab based on permissions
  useEffect(() => {
    if (!permissionsLoading && availableTabs.length > 0 && !availableTabs.find(t => t.id === activeTab)) {
      setActiveTab(availableTabs[0].id);
    }
  }, [permissionsLoading, availableTabs, activeTab]);

  const handleTabChange = (tabId) => {
    // Check if user has permission to access this tab
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Verify permissions before switching
    if (tab.requiredPermissions && tab.requiredPermissions.length > 0) {
      if (!hasAnyPermission(tab.requiredPermissions)) {
        toast.error('You do not have permission to access this tab');
        return;
      }
    }

    if (tab.requiresElevated && !hasElevatedPrivileges()) {
      toast.error('This feature requires elevated privileges');
      return;
    }

    // Record action for audit asynchronously
    setTimeout(() => {
      recordAction('inbox_tab_navigation', true).catch(err => 
        console.error('Failed to record tab navigation:', err)
      );
    }, 0);
    
    setActiveTab(tabId);
  };

  // Render tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'inbox':
        return renderInboxTab();
      case 'history':
        return renderHistoryTab();
      case 'domains':
        return renderDomainsTab();
      case 'mailboxes':
        return renderMailboxesTab();
      case 'settings':
        return renderSettingsTab();
      default:
        return renderInboxTab();
    }
  };

  const renderInboxTab = () => {
    return (
      <PermissionGate
        permission="inbox.emails.view"
        fallback={
          <div style={styles.permissionBanner}>
            <FiShield />
            <div>
              <strong>Access required</strong>
              <p>You need inbox email permissions to view emails.</p>
            </div>
          </div>
        }
      >
        <EmailInbox businessId={businessId} newMessageRequest={newMessageRequest} />
      </PermissionGate>
    );
  };

  const renderHistoryTab = () => {
    return (
      <PermissionGate
        permission="inbox.emails.view"
        fallback={
          <div style={styles.permissionBanner}>
            <FiShield />
            <div>
              <strong>Access required</strong>
              <p>You need inbox email permissions to view outbound email history.</p>
            </div>
          </div>
        }
      >
        <EmailHistory businessId={businessId} />
      </PermissionGate>
    );
  };

  const renderDomainsTab = () => {
    return (
      <PermissionGate
        permission="inbox.domains.view"
        fallback={
          <div style={styles.permissionBanner}>
            <FiShield />
            <div>
              <strong>Access required</strong>
              <p>You need inbox domain permissions to view domains.</p>
            </div>
          </div>
        }
      >
        {loadingDomains ? (
          <div style={styles.loadingDomains}>
            <FiRefreshCw className="spin" /> Loading domains…
          </div>
        ) : mailDomains.length === 0 ? (
          <div style={styles.emptyState}>
            <p>No domains connected yet. Add your business domain to send email from your own address.</p>
          </div>
        ) : (
          <div style={styles.domainGrid}>
            {mailDomains.map((domain) => {
              const records = domain.verification_records || {};
              const identityRecord = records.identity;
              const dkimRecords = records.dkim || [];
              const mxRecord = records.mx;
              const mailFromRecords = records.mailFrom || [];
              const dmarcRecord = records.dmarc;
              const statusKey = normalizeDomainStatus(domain.status);
              const badgeStyle = domainStatusStyles[statusKey] || domainStatusStyles.pending;

              return (
                <div key={domain.id} style={styles.domainCard}>
                  <div style={styles.domainHeader}>
                    <div>
                      <div style={styles.domainName}>{domain.domain_name}</div>
                      <div style={styles.domainStatusBadge}>
                        <span
                          style={{
                            ...styles.domainStatusChip,
                            ...badgeStyle
                          }}
                        >
                          {statusKey.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        style={styles.secondaryButton}
                        onClick={() => handleCheckDomainStatus(domain)}
                        disabled={checkingDomainId === domain.id}
                      >
                        {checkingDomainId === domain.id ? 'Checking…' : 'Check status'}
                      </button>
                      {canManageDomains && domain.status === 'pending' && (
                        <button
                          style={{
                            ...styles.secondaryButton,
                            backgroundColor: '#e8f5e8',
                            color: '#2e7d32',
                            borderColor: '#4caf50'
                          }}
                          onClick={() => handleMarkAsVerified(domain)}
                          disabled={checkingDomainId === domain.id}
                          title="Mark as verified if you're already sending emails from this domain"
                        >
                          Mark as Verified
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={styles.dnsSection}>
                    <h4 style={styles.dnsSectionTitle}>Required DNS Records</h4>
                    <p style={styles.dnsHelpText}>Add these records to your DNS provider. Verification can take up to 24 hours.</p>
                    <div style={styles.dnsRecordList}>
                      {formatDnsRecordRow(identityRecord, 0)}
                      {dkimRecords.map(formatDnsRecordRow)}
                      {formatDnsRecordRow(mxRecord, 'mx')}
                      {mailFromRecords.map((record, idx) => formatDnsRecordRow(record, `mail-from-${idx}`))}
                      {formatDnsRecordRow(dmarcRecord, 'dmarc')}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PermissionGate>
    );
  };

  const renderMailboxesTab = () => {
    return (
      <PermissionGate
        permission="inbox.mailboxes.view"
        fallback={
          <div style={styles.permissionBanner}>
            <FiShield />
            <div>
              <strong>Access required</strong>
              <p>You need inbox mailbox permissions to view mailboxes.</p>
            </div>
          </div>
        }
      >
        <MailboxManagement businessId={businessId} />
      </PermissionGate>
    );
  };

  const renderSettingsTab = () => {
    return (
      <PermissionGate
        permission="inbox.settings.view"
        fallback={
          <div style={styles.permissionBanner}>
            <FiShield />
            <div>
              <strong>Access required</strong>
              <p>You need inbox settings permissions to view settings.</p>
            </div>
          </div>
        }
      >
        <InboxSignatureSettings businessId={businessId} />
      </PermissionGate>
    );
  };

  const awsRegion = import.meta.env.VITE_AWS_REGION || 'us-east-1';

  const parseDkimTokens = useCallback((value) => {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.filter((token) => typeof token === 'string');
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.filter((token) => typeof token === 'string');
        }
        return [value];
      } catch {
        return [value];
      }
    }
    return [];
  }, []);

  const buildDnsRecordsFromDomain = useCallback((domain) => {
    const domainName = domain.domain || domain.domain_name || '';
    const identityToken = domain.verification_token || null;
    const dkimTokens = parseDkimTokens(domain.dkim_tokens);
    const mailFromDomain = domain.mail_from_domain || `mail.${domainName}`;

    const identity = identityToken
      ? {
          type: 'TXT',
          name: `_amazonses.${domainName}`,
          value: identityToken
        }
      : null;

    const dkim = dkimTokens.map((token) => ({
      type: 'CNAME',
      name: `${token}._domainkey.${domainName}`,
      value: `${token}.dkim.amazonses.com`
    }));

    const mx = {
      type: 'MX',
      name: domainName,
      value: `10 inbound-smtp.${awsRegion}.amazonaws.com`
    };

    const mailFrom = [
      {
        type: 'MX',
        name: mailFromDomain,
        value: `10 feedback-smtp.${awsRegion}.amazonses.com`
      },
      {
        type: 'TXT',
        name: mailFromDomain,
        value: domain.spf_record || 'v=spf1 include:amazonses.com ~all'
      }
    ];

    const dmarc = {
      type: 'TXT',
      name: `_dmarc.${domainName}`,
      value: domain.dmarc_record || 'v=DMARC1; p=none;'
    };

    return {
      identity,
      dkim,
      mx,
      mailFrom,
      dmarc
    };
  }, [awsRegion, parseDkimTokens]);

  const loadMailDomains = useCallback(async () => {
    if (!businessId) return;
    try {
      setLoadingDomains(true);
      const { data, error } = await supabase
        .from('mail_domains')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const mapped = (data || []).map((domain) => {
        const domainName = domain.domain || domain.domain_name || '';
        const statusKey = normalizeDomainStatus(domain.ses_verification_status || (domain.verified ? 'verified' : 'pending'));
        return {
          ...domain,
          domain_name: domainName,
          status: statusKey,
          verification_records: buildDnsRecordsFromDomain(domain)
        };
      });

      setMailDomains(mapped);
    } catch (error) {
      console.error('Error loading mail domains:', error);
      toast.error('Failed to load domains');
    } finally {
      setLoadingDomains(false);
    }
  }, [businessId, buildDnsRecordsFromDomain]);

  useEffect(() => {
    if (businessId && !authLoading && !permissionsLoading && canViewDomains) {
      loadMailDomains();
    }
  }, [businessId, authLoading, permissionsLoading, canViewDomains, loadMailDomains]);

  const handleStartDomainVerification = async () => {
    const domainValue = newDomain.trim().toLowerCase();
    const sanitizedDomain = domainValue
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split('?')[0]
      .split('#')[0];

    if (!sanitizedDomain || sanitizedDomain.includes(' ')) {
      toast.error('Enter a valid domain (e.g. example.com).');
      return;
    }

    try {
      if (!checkRateLimit('start_domain_verification', 5, 60000)) {
        toast.error('Please wait before starting another verification.');
        return;
      }

      setSubmittingDomain(true);
      await logSecurityEvent('mail_domain_verification_started', {
        action: 'start_verification',
        domain: sanitizedDomain,
        business_id: businessId,
        initiated_by: authUser?.id
      }, 'high');

      const { data, error } = await supabase.functions.invoke('mail-domain-manager', {
        body: {
          action: 'start',
          domain: sanitizedDomain,
          businessId
        }
      });

      if (error) {
        throw new Error(error?.message || 'Failed to start verification');
      }

      toast.success('Domain verification started. Add the DNS records shown below.');
      setShowAddDomainModal(false);
      setNewDomain('');
      await loadMailDomains();
      await recordAction('mail_domain_verification_start', true, sanitizedDomain);
    } catch (error) {
      console.error('Failed to start domain verification:', error);
      toast.error(error.message || 'Failed to start verification');
      await recordAction('mail_domain_verification_start', false, sanitizedDomain);
    } finally {
      setSubmittingDomain(false);
    }
  };

  const handleCheckDomainStatus = async (domainRecord) => {
    if (!domainRecord) return;
    try {
      if (!checkRateLimit('check_domain_status', 10, 60000)) {
        toast.error('Please wait before checking status again.');
        return;
      }

      setCheckingDomainId(domainRecord.id);
      const { data, error } = await supabase.functions.invoke('mail-domain-manager', {
        body: {
          action: 'status',
          domain: domainRecord.domain || domainRecord.domain_name,
          domainId: domainRecord.id
        }
      });

      if (error) {
        throw new Error(error?.message || 'Failed to check status');
      }

      const domainData = data?.domain || {};
      const consolidatedStatus = normalizeDomainStatus(domainData.ses_verification_status || (domainData.verified ? 'verified' : 'pending'));

      if (consolidatedStatus === 'verified') {
        toast.success(`${domainRecord.domain_name} is verified!`);
      } else if (consolidatedStatus === 'failed') {
        toast.error(`${domainRecord.domain_name} verification failed. Please review DNS records.`);
      } else {
        toast('Still waiting for DNS propagation…', { icon: '⏳' });
      }

      await recordAction('mail_domain_status_check', true, domainRecord.id);
      await loadMailDomains();
    } catch (error) {
      console.error('Failed to check domain status:', error);
      toast.error(error.message || 'Failed to check status');
      await recordAction('mail_domain_status_check', false, domainRecord?.id);
    } finally {
      setCheckingDomainId(null);
    }
  };

  const handleMarkAsVerified = async (domainRecord) => {
    if (!domainRecord) return;
    
    if (!confirm(`Mark ${domainRecord.domain_name} as verified? This will update the status in the database.`)) {
      return;
    }

    try {
      if (!checkRateLimit('mark_domain_verified', 5, 60000)) {
        toast.error('Please wait before marking another domain as verified.');
        return;
      }

      setCheckingDomainId(domainRecord.id);
      
      // Directly update the database to mark as verified
      const { data, error } = await supabase
        .from('mail_domains')
        .update({
          verified: true,
          ses_verification_status: 'Success',
          verified_at: new Date().toISOString(),
          last_checked_at: new Date().toISOString(),
          verification_errors: null
        })
        .eq('id', domainRecord.id)
        .select()
        .single();

      if (error) {
        throw new Error(error.message || 'Failed to update domain status');
      }

      toast.success(`${domainRecord.domain_name} marked as verified!`);
      await recordAction('mail_domain_mark_verified', true, domainRecord.id);
      await loadMailDomains();
    } catch (error) {
      console.error('Failed to mark domain as verified:', error);
      toast.error(error.message || 'Failed to mark as verified');
      await recordAction('mail_domain_mark_verified', false, domainRecord?.id);
    } finally {
      setCheckingDomainId(null);
    }
  };

  if (authLoading || permissionsLoading) {
    return (
      <POSAuthWrapper>
        <SecurityWrapper>
          <div style={styles.container}>
            <div style={styles.loading}>Loading Tavari Inbox…</div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  // Check if user has any inbox permissions
  const hasInboxAccess = hasPermission('inbox.dashboard.view') || 
                         hasPermission('inbox.emails.view') ||
                         hasPermission('inbox.domains.view') || 
                         hasPermission('inbox.mailboxes.view') || 
                         hasPermission('inbox.settings.view') || 
                         hasElevatedPrivileges();

  if (!hasInboxAccess) {
    return (
      <POSAuthWrapper>
        <SecurityWrapper>
          <div style={styles.container}>
            <div style={styles.loading}>
              <FiShield size={48} style={{ marginBottom: '16px', color: '#ef4444' }} />
              <h2 style={{ marginBottom: '8px' }}>Access Denied</h2>
              <p>You do not have permission to access Tavari Inbox.</p>
              <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '8px' }}>
                Contact your administrator to request access.
              </p>
            </div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  if (authError) {
    return (
      <POSAuthWrapper>
        <SecurityWrapper>
          <div style={styles.container}>
            <div style={styles.error}>Error: {authError}</div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper>
      <SecurityWrapper>
        <div style={styles.container}>
          <TavariModuleHeader
            title="Tavari Inbox"
            description="Configure inbound and outbound email for your business. Verify domains, manage mailboxes, and keep communications inside Tavari."
            actionLabel={hasPermission('inbox.emails.view') || hasElevatedPrivileges() ? 'New Message' : undefined}
            actionIcon={<FiEdit3 size={18} />}
            onAction={() => {
              setActiveTab('inbox');
              setNewMessageRequest(prev => prev + 1);
            }}
          />

          <TavariTabSystemComponent
            tabs={availableTabs}
            mode="state"
            activeTab={activeTab}
            onTabChange={handleTabChange}
            ariaLabel="Tavari Inbox module"
            variant="module"
          />

          {/* Tab content */}
          <div style={styles.tabContent}>
            {renderTabContent()}
          </div>
        </div>
      </SecurityWrapper>

      {showAddDomainModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <h2 style={styles.modalTitle}>Add Domain</h2>
            <p style={styles.modalSubtitle}>Enter your business domain to begin verification</p>
            <input
              type="text"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="example.com"
              style={styles.modalInput}
            />
            <div style={styles.modalActions}>
              <button
                style={styles.secondaryButton}
                onClick={() => {
                  setShowAddDomainModal(false);
                  setNewDomain('');
                }}
                disabled={submittingDomain}
              >
                Cancel
              </button>
              <button
                style={{
                  ...styles.primaryButton,
                  opacity: submittingDomain ? 0.7 : 1,
                  cursor: submittingDomain ? 'not-allowed' : 'pointer'
                }}
                onClick={handleStartDomainVerification}
                disabled={submittingDomain}
              >
                {submittingDomain ? 'Starting…' : 'Start Verification'}
              </button>
            </div>
          </div>
        </div>
      )}
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    padding: '20px',
    paddingTop: '80px',
    width: '100%',
    backgroundColor: '#f8f8f8',
    minHeight: '100vh',
    boxSizing: 'border-box'
  },
  loading: {
    textAlign: 'center',
    padding: '60px 20px',
    fontSize: '18px',
    color: '#666'
  },
  error: {
    textAlign: 'center',
    padding: '60px 20px',
    fontSize: '18px',
    color: '#c62828'
  },
  header: {
    marginBottom: '30px'
  },
  title: {
    fontSize: '33px',
    fontWeight: 'bold',
    color: '#333',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '8px'
  },
  titleIcon: {
    fontSize: '30px',
    color: 'teal'
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
    margin: 0,
    lineHeight: 1.6
  },
  tabContent: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    border: '1px solid #e0e0e0',
    padding: '24px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.05)',
    minHeight: '400px'
  },
  grid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    maxWidth: '620px'
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    border: '1px solid #e0e0e0',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.05)'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  cardIconWrapper: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    backgroundColor: 'rgba(0,128,128,0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  cardIcon: {
    fontSize: '24px',
    color: 'teal'
  },
  cardTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0
  },
  cardSubtitle: {
    fontSize: '14px',
    color: '#666',
    margin: 0
  },
  primaryButton: {
    marginLeft: 'auto',
    backgroundColor: 'teal',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 18px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  secondaryButton: {
    backgroundColor: '#e0e0e0',
    color: '#333',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  permissionBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '16px',
    backgroundColor: '#fff3cd',
    borderRadius: '8px',
    border: '1px solid #fbc02d',
    color: '#856404'
  },
  loadingDomains: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: '#666'
  },
  emptyState: {
    textAlign: 'center',
    padding: '20px',
    fontSize: '15px',
    color: '#666'
  },
  domainGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '18px'
  },
  domainCard: {
    backgroundColor: '#f8f8f8',
    borderRadius: '10px',
    border: '1px solid #e0e0e0',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  domainHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px'
  },
  domainName: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333'
  },
  domainStatusBadge: {
    marginTop: '6px'
  },
  domainStatusChip: {
    padding: '5px 10px',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#fff',
    display: 'inline-block'
  },
  dnsSection: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    border: '1px solid #eee',
    padding: '14px'
  },
  dnsSectionTitle: {
    fontSize: '15px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px'
  },
  dnsHelpText: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '10px',
    lineHeight: 1.4
  },
  dnsRecordList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  dnsRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 12px',
    backgroundColor: '#f7f7f7',
    borderRadius: '6px',
    border: '1px solid #eee',
    fontFamily: 'monospace',
    fontSize: '13px'
  },
  dnsType: {
    fontWeight: 'bold',
    color: '#555'
  },
  dnsHost: {
    fontWeight: 'bold',
    color: '#333'
  },
  dnsValue: {
    wordBreak: 'break-all',
    color: '#333'
  },
  comingSoon: {
    backgroundColor: '#f5f5f5',
    borderRadius: '8px',
    padding: '16px',
    fontSize: '14px',
    color: '#555',
    lineHeight: 1.5
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '28px',
    width: '90%',
    maxWidth: '420px',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
    boxShadow: '0 12px 40px rgba(0,0,0,0.2)'
  },
  modalTitle: {
    fontSize: '23px',
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center'
  },
  modalSubtitle: {
    fontSize: '14px',
    color: '#666',
    textAlign: 'center'
  },
  modalInput: {
    padding: '12px',
    fontSize: '16px',
    border: '2px solid #ddd',
    borderRadius: '8px',
    outline: 'none'
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px'
  }
};

if (typeof document !== 'undefined' && !document.querySelector('#tavari-inbox-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'tavari-inbox-styles';
  styleSheet.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .spin {
      animation: spin 1s linear infinite;
    }
  `;
  document.head.appendChild(styleSheet);
}

export default TavariInboxDashboard;
