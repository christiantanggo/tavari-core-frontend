import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import EmailPauseBanner from '../../components/EmailPauseBanner';
import MailModuleHeader from '../../components/Mail/MailModuleHeader';
import { MAIL_USAGE_TABS, MailUsageTabs } from '../../components/Mail/MailModuleNavigation';
import { usePermissions } from '../../hooks/usePermissions';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import toast from 'react-hot-toast';
import {
  FiAlertCircle,
  FiAlertTriangle,
  FiCheckCircle,
  FiClock,
  FiFileText,
  FiMail,
  FiMapPin,
  FiRefreshCw,
  FiSettings,
  FiShield,
  FiUsers
} from 'react-icons/fi';

const MailComplianceDashboard = () => {
  const navigate = useNavigate();
  const {
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'MailComplianceDashboard',
    sensitiveComponent: false,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'medium'
  });

  const {
    selectedBusinessId,
    authUser,
    businessData,
    authLoading,
    authError
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'MailComplianceDashboard'
  });

  const {
    hasPermission,
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading
  } = usePermissions();

  const businessId =
    selectedBusinessId ||
    businessData?.id ||
    localStorage.getItem('currentBusinessId') ||
    localStorage.getItem('businessId');

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    totalContacts: 0,
    subscribedContacts: 0,
    missingConsentContacts: 0,
    protectedSuppressions: 0,
    consentEvents: 0
  });
  const [settingsHealth, setSettingsHealth] = useState({
    fromName: '',
    fromEmail: '',
    businessAddress: '',
    replyTo: ''
  });
  const [recentEvents, setRecentEvents] = useState([]);

  const canViewCompliance = hasAnyPermission([
    'mail.compliance.view',
    'mail.contacts.view',
    'mail.campaigns.view'
  ]) || hasElevatedPrivileges();
  const usageTabs = MAIL_USAGE_TABS.filter((tab) => (
    !tab.requiresElevated || hasElevatedPrivileges()
  ));
  const handleUsageTabChange = (tabId) => {
    if (tabId === 'overview' || tabId === 'history' || tabId === 'settings') {
      navigate('/dashboard/mail/billing');
      return;
    }
    if (tabId === 'monitor-logs') {
      navigate('/dashboard/mail/performance');
    }
  };
  const canEditCompliance = hasAnyPermission([
    'mail.compliance.edit',
    'mail.settings.edit'
  ]) || hasElevatedPrivileges();

  const loadComplianceData = useCallback(async () => {
    if (!businessId || !canViewCompliance) return;

    if (!checkRateLimit('load_mail_compliance', 10, 60000)) {
      toast.error('Too many requests. Please wait a moment.');
      return;
    }

    try {
      setLoading(true);

      await logSecurityEvent('mail_compliance_dashboard_access', {
        action: 'load_mail_compliance',
        business_id: businessId,
        user_id: authUser?.id
      }, 'low');

      const [
        totalContactsResult,
        subscribedContactsResult,
        missingConsentResult,
        protectedSuppressionsResult,
        consentEventsResult,
        settingsResult,
        recentConsentEventsResult,
        recentBounceEventsResult
      ] = await Promise.all([
        supabase
          .from('mail_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId),
        supabase
          .from('mail_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('subscribed', true),
        supabase
          .from('mail_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('subscribed', true)
          .or('consent_method.is.null,consent_timestamp.is.null'),
        supabase
          .from('mail_bounces')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .in('bounce_type', ['hard', 'complaint', 'suppression']),
        supabase
          .from('mail_consent_log')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId),
        supabase
          .from('mail_settings')
          .select('from_name, from_email, business_address, reply_to')
          .eq('business_id', businessId)
          .maybeSingle(),
        supabase
          .from('mail_consent_log')
          .select('id, action, consent_source, email_address, timestamp')
          .eq('business_id', businessId)
          .order('timestamp', { ascending: false })
          .limit(4),
        supabase
          .from('mail_bounces')
          .select('id, bounce_type, email_address, bounce_reason, bounced_at')
          .eq('business_id', businessId)
          .order('bounced_at', { ascending: false })
          .limit(4)
      ]);

      const errors = [
        totalContactsResult.error,
        subscribedContactsResult.error,
        missingConsentResult.error,
        protectedSuppressionsResult.error,
        consentEventsResult.error,
        settingsResult.error,
        recentConsentEventsResult.error,
        recentBounceEventsResult.error
      ].filter(Boolean);

      if (errors.length > 0) {
        throw errors[0];
      }

      const nextSummary = {
        totalContacts: totalContactsResult.count || 0,
        subscribedContacts: subscribedContactsResult.count || 0,
        missingConsentContacts: missingConsentResult.count || 0,
        protectedSuppressions: protectedSuppressionsResult.count || 0,
        consentEvents: consentEventsResult.count || 0
      };

      setSummary(nextSummary);
      setSettingsHealth({
        fromName: settingsResult.data?.from_name || '',
        fromEmail: settingsResult.data?.from_email || '',
        businessAddress: settingsResult.data?.business_address || '',
        replyTo: settingsResult.data?.reply_to || ''
      });

      const consentEvents = (recentConsentEventsResult.data || []).map((event) => ({
        id: `consent-${event.id}`,
        type: 'consent',
        title: `${event.action} recorded`,
        detail: `${event.email_address} via ${event.consent_source || 'unknown source'}`,
        timestamp: event.timestamp
      }));

      const bounceEvents = (recentBounceEventsResult.data || []).map((event) => ({
        id: `bounce-${event.id}`,
        type: 'suppression',
        title: `${event.bounce_type} protection applied`,
        detail: `${event.email_address}${event.bounce_reason ? ` - ${event.bounce_reason}` : ''}`,
        timestamp: event.bounced_at
      }));

      setRecentEvents(
        [...consentEvents, ...bounceEvents]
          .filter((event) => event.timestamp)
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, 6)
      );

      await recordAction('mail_compliance_loaded', true, businessId);
    } catch (error) {
      console.error('Error loading mail compliance data:', error);
      toast.error('Failed to load compliance data');
      await recordAction('mail_compliance_loaded', false, businessId);
    } finally {
      setLoading(false);
    }
  }, [authUser?.id, businessId, canViewCompliance, checkRateLimit, logSecurityEvent, recordAction]);

  useEffect(() => {
    if (!permissionsLoading && !authLoading && !canViewCompliance) {
      toast.error('You do not have permission to view the compliance center');
      navigate('/dashboard/mail/dashboard');
    }
  }, [authLoading, canViewCompliance, navigate, permissionsLoading]);

  useEffect(() => {
    if (!authLoading && !permissionsLoading && canViewCompliance) {
      loadComplianceData();
    }
  }, [authLoading, permissionsLoading, canViewCompliance, loadComplianceData]);

  const consentCoverage = useMemo(() => {
    if (summary.subscribedContacts === 0) return 100;
    const compliantContacts = Math.max(summary.subscribedContacts - summary.missingConsentContacts, 0);
    return Math.round((compliantContacts / summary.subscribedContacts) * 100);
  }, [summary.missingConsentContacts, summary.subscribedContacts]);

  const complianceChecks = [
    {
      label: 'Sender identity configured',
      passed: Boolean(settingsHealth.fromName && settingsHealth.fromEmail),
      detail: settingsHealth.fromEmail
        ? `${settingsHealth.fromName || 'Sender'} <${settingsHealth.fromEmail}>`
        : 'Set a business sender name and from email in Mail Settings.'
    },
    {
      label: 'Physical business address present',
      passed: Boolean(settingsHealth.businessAddress),
      detail: settingsHealth.businessAddress || 'Required for CASL footer compliance.'
    },
    {
      label: 'Consent coverage for subscribed contacts',
      passed: summary.missingConsentContacts === 0,
      detail: `${consentCoverage}% of subscribed contacts have recorded consent.`
    },
    {
      label: 'Suppression protection active',
      passed: true,
      detail: `${summary.protectedSuppressions} bounced, complained, or suppressed address(es) are protected from marketing sends.`
    }
  ];

  const formatDate = (value) => {
    if (!value) return 'N/A';
    return new Date(value).toLocaleString();
  };

  if (authLoading || permissionsLoading || loading) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          <MailModuleHeader />
          <MailUsageTabs tabs={usageTabs} activeTab="compliance" onTabChange={handleUsageTabChange} />
          <div style={styles.loadingState}>
            <FiRefreshCw style={{ ...styles.loadingIcon, animation: 'spin 1s linear infinite' }} />
            <p>Loading compliance center...</p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  if (authError) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          <MailModuleHeader />
          <MailUsageTabs tabs={usageTabs} activeTab="compliance" onTabChange={handleUsageTabChange} />
          <div style={styles.errorState}>
            <FiAlertCircle style={styles.errorIcon} />
            <h2>Authentication Error</h2>
            <p>{authError}</p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper>
      <SecurityWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          <MailModuleHeader />
          <MailUsageTabs tabs={usageTabs} activeTab="compliance" onTabChange={handleUsageTabChange} />

          <div style={styles.heroCard}>
            <div>
              <h1 style={styles.pageTitle}>Compliance Center</h1>
              <p style={styles.pageSubtitle}>
                Review consent coverage, sender requirements, and suppression protection before sending marketing email.
              </p>
            </div>
            <div style={styles.heroActions}>
              <button style={styles.secondaryButton} onClick={() => navigate('/dashboard/mail/logs')}>
                <FiFileText style={styles.buttonIcon} />
                View Send Logs
              </button>
              <button
                style={{
                  ...styles.primaryButton,
                  ...(canEditCompliance ? {} : styles.disabledButton)
                }}
                onClick={() => navigate('/dashboard/mail/settings')}
                disabled={!canEditCompliance}
                title={canEditCompliance ? 'Open mail settings' : 'You do not have permission to edit compliance settings'}
              >
                <FiSettings style={styles.buttonIcon} />
                Fix Compliance Settings
              </button>
            </div>
          </div>

          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <FiUsers style={styles.statIcon} />
              <div>
                <div style={styles.statValue}>{summary.subscribedContacts.toLocaleString()}</div>
                <div style={styles.statLabel}>Subscribed Contacts</div>
              </div>
            </div>
            <div style={styles.statCard}>
              <FiShield style={styles.statIcon} />
              <div>
                <div style={styles.statValue}>{consentCoverage}%</div>
                <div style={styles.statLabel}>Consent Coverage</div>
              </div>
            </div>
            <div style={styles.statCard}>
              <FiAlertTriangle style={{ ...styles.statIcon, color: '#d97706' }} />
              <div>
                <div style={styles.statValue}>{summary.missingConsentContacts.toLocaleString()}</div>
                <div style={styles.statLabel}>Missing Consent</div>
              </div>
            </div>
            <div style={styles.statCard}>
              <FiMail style={styles.statIcon} />
              <div>
                <div style={styles.statValue}>{summary.protectedSuppressions.toLocaleString()}</div>
                <div style={styles.statLabel}>Protected Suppressions</div>
              </div>
            </div>
          </div>

          <div style={styles.contentGrid}>
            <div style={styles.panel}>
              <h2 style={styles.sectionTitle}>Compliance Checks</h2>
              <div style={styles.checkList}>
                {complianceChecks.map((check) => (
                  <div key={check.label} style={styles.checkItem}>
                    <div style={styles.checkHeading}>
                      {check.passed ? (
                        <FiCheckCircle style={{ ...styles.checkIcon, color: '#16a34a' }} />
                      ) : (
                        <FiAlertTriangle style={{ ...styles.checkIcon, color: '#d97706' }} />
                      )}
                      <span style={styles.checkLabel}>{check.label}</span>
                    </div>
                    <div style={styles.checkDetail}>{check.detail}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={styles.panel}>
              <h2 style={styles.sectionTitle}>Compliance Snapshot</h2>
              <div style={styles.snapshotRow}>
                <span style={styles.snapshotLabel}>Total contacts</span>
                <span style={styles.snapshotValue}>{summary.totalContacts.toLocaleString()}</span>
              </div>
              <div style={styles.snapshotRow}>
                <span style={styles.snapshotLabel}>Consent log entries</span>
                <span style={styles.snapshotValue}>{summary.consentEvents.toLocaleString()}</span>
              </div>
              <div style={styles.snapshotRow}>
                <span style={styles.snapshotLabel}>Sender email</span>
                <span style={styles.snapshotValue}>{settingsHealth.fromEmail || 'Missing'}</span>
              </div>
              <div style={styles.snapshotRow}>
                <span style={styles.snapshotLabel}>Reply-to</span>
                <span style={styles.snapshotValue}>{settingsHealth.replyTo || 'Not set'}</span>
              </div>
              <div style={styles.snapshotRow}>
                <span style={styles.snapshotLabel}>Business address</span>
                <span style={styles.snapshotValue}>{settingsHealth.businessAddress || 'Missing'}</span>
              </div>
            </div>

            <div style={styles.panel}>
              <h2 style={styles.sectionTitle}>Next Recommended Actions</h2>
              <div style={styles.actionList}>
                <button style={styles.linkCard} onClick={() => navigate('/dashboard/mail/contacts')}>
                  <FiUsers style={styles.linkIcon} />
                  <div>
                    <div style={styles.linkTitle}>Review contact records</div>
                    <div style={styles.linkText}>Clean up contacts missing consent or unsubscribe data.</div>
                  </div>
                </button>
                <button style={styles.linkCard} onClick={() => navigate('/dashboard/mail/settings')}>
                  <FiMapPin style={styles.linkIcon} />
                  <div>
                    <div style={styles.linkTitle}>Verify sender footer details</div>
                    <div style={styles.linkText}>Confirm from name, from email, and business address.</div>
                  </div>
                </button>
                <button style={styles.linkCard} onClick={() => navigate('/dashboard/mail/logs')}>
                  <FiMail style={styles.linkIcon} />
                  <div>
                    <div style={styles.linkTitle}>Monitor send protections</div>
                    <div style={styles.linkText}>Use send logs to confirm failures, bounces, and suppressions are handled.</div>
                  </div>
                </button>
              </div>
            </div>

            <div style={styles.panel}>
              <h2 style={styles.sectionTitle}>Recent Compliance Events</h2>
              {recentEvents.length === 0 ? (
                <div style={styles.emptyState}>No recent compliance events recorded yet.</div>
              ) : (
                <div style={styles.eventsList}>
                  {recentEvents.map((event) => (
                    <div key={event.id} style={styles.eventItem}>
                      <div style={styles.eventTitle}>{event.title}</div>
                      <div style={styles.eventDetail}>{event.detail}</div>
                      <div style={styles.eventTime}>
                        <FiClock style={styles.eventTimeIcon} />
                        {formatDate(event.timestamp)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    padding: '20px',
    maxWidth: '1400px',
    margin: '0 auto'
  },
  loadingState: {
    backgroundColor: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '40px',
    textAlign: 'center',
    color: '#4b5563'
  },
  loadingIcon: {
    fontSize: '33px',
    color: 'teal',
    marginBottom: '12px'
  },
  errorState: {
    backgroundColor: '#fff7ed',
    border: '1px solid #fdba74',
    borderRadius: '12px',
    padding: '24px',
    textAlign: 'center',
    color: '#9a3412'
  },
  errorIcon: {
    fontSize: '33px',
    marginBottom: '12px'
  },
  heroCard: {
    backgroundColor: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    padding: '24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
    flexWrap: 'wrap',
    marginBottom: '20px'
  },
  pageTitle: {
    margin: 0,
    fontSize: '28px',
    fontWeight: '700',
    color: '#111827'
  },
  pageSubtitle: {
    margin: '8px 0 0 0',
    color: '#4b5563',
    maxWidth: '720px',
    lineHeight: 1.5
  },
  heroActions: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap'
  },
  primaryButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    padding: '12px 16px',
    fontWeight: '700',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px'
  },
  secondaryButton: {
    backgroundColor: 'white',
    color: '#0f172a',
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    padding: '12px 16px',
    fontWeight: '700',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px'
  },
  disabledButton: {
    opacity: 0.55,
    cursor: 'not-allowed'
  },
  buttonIcon: {
    fontSize: '16px'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '16px',
    marginBottom: '20px'
  },
  statCard: {
    backgroundColor: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '14px',
    padding: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '14px'
  },
  statIcon: {
    fontSize: '24px',
    color: 'teal'
  },
  statValue: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#111827'
  },
  statLabel: {
    fontSize: '13px',
    color: '#6b7280'
  },
  contentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '16px'
  },
  panel: {
    backgroundColor: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '14px',
    padding: '20px'
  },
  sectionTitle: {
    margin: '0 0 16px 0',
    fontSize: '18px',
    fontWeight: '700',
    color: '#111827'
  },
  checkList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px'
  },
  checkItem: {
    border: '1px solid #eef2f7',
    borderRadius: '12px',
    padding: '14px'
  },
  checkHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '6px'
  },
  checkIcon: {
    fontSize: '18px',
    flexShrink: 0
  },
  checkLabel: {
    fontWeight: '700',
    color: '#111827'
  },
  checkDetail: {
    color: '#4b5563',
    lineHeight: 1.5
  },
  snapshotRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
    padding: '12px 0',
    borderBottom: '1px solid #f1f5f9'
  },
  snapshotLabel: {
    color: '#64748b'
  },
  snapshotValue: {
    color: '#0f172a',
    fontWeight: '600',
    textAlign: 'right'
  },
  actionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  linkCard: {
    width: '100%',
    border: '1px solid #e5e7eb',
    backgroundColor: '#f8fafc',
    borderRadius: '12px',
    padding: '14px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    textAlign: 'left',
    cursor: 'pointer'
  },
  linkIcon: {
    fontSize: '18px',
    color: 'teal',
    marginTop: '2px',
    flexShrink: 0
  },
  linkTitle: {
    fontWeight: '700',
    color: '#111827',
    marginBottom: '4px'
  },
  linkText: {
    color: '#475569',
    lineHeight: 1.4
  },
  eventsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  eventItem: {
    border: '1px solid #eef2f7',
    borderRadius: '12px',
    padding: '14px'
  },
  eventTitle: {
    fontWeight: '700',
    color: '#111827',
    marginBottom: '4px'
  },
  eventDetail: {
    color: '#475569',
    lineHeight: 1.45,
    marginBottom: '8px'
  },
  eventTime: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: '#64748b'
  },
  eventTimeIcon: {
    fontSize: '13px'
  },
  emptyState: {
    color: '#64748b',
    backgroundColor: '#f8fafc',
    borderRadius: '12px',
    padding: '16px'
  }
};

export default MailComplianceDashboard;
