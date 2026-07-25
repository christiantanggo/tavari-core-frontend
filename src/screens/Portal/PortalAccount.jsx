import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, Award, BookOpen, DollarSign, FileSignature, FileText, FileWarning, Lock, MessageSquareText, Receipt, User } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import { employeeAppPath } from '../../utils/employeeAppRouting';
import { supabase } from '../../supabaseClient';
import { getPublicUserId } from '../../utils/getPublicUserId';
import {
  getEmployeePortalProfiles,
  getEmployeePortalSelectedBusinessId,
  getEmployeePortalSelectedProfile,
  loadEmployeePortalBusinessProfiles,
  setEmployeePortalSelectedProfile,
} from '../../utils/employeeProfileSelection';
import { fetchSchedulingModuleEnabled } from '../../utils/employeePortalSchedulingModule';

const PortalAccount = () => {
  const navigate = useNavigate();
  const [counts, setCounts] = useState({
    pay: 0,
    policies: 0,
    training: 0,
    acknowledgements: 0,
    updates: 0,
  });
  const [payStatementIds, setPayStatementIds] = useState([]);
  const [availableProfiles, setAvailableProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [schedulingModuleEnabled, setSchedulingModuleEnabled] = useState(false);
  const [canUploadExpenseReceipts, setCanUploadExpenseReceipts] = useState(false);

  useEffect(() => {
    loadProfileSelection();
    loadAccountCounts();
    loadExpenseReceiptAccess();

    const refreshCounts = () => loadAccountCounts();
    const refreshProfiles = () => {
      loadProfileSelection();
      loadExpenseReceiptAccess();
    };
    window.addEventListener('employee-account-badge-refresh', refreshCounts);
    window.addEventListener('employee-profile-selection-changed', refreshProfiles);
    window.addEventListener('focus', refreshCounts);
    return () => {
      window.removeEventListener('employee-account-badge-refresh', refreshCounts);
      window.removeEventListener('employee-profile-selection-changed', refreshProfiles);
      window.removeEventListener('focus', refreshCounts);
    };
  }, []);

  useEffect(() => {
    const businessId = selectedProfile?.business_id ?? getEmployeePortalSelectedBusinessId();
    if (!businessId) {
      setSchedulingModuleEnabled(false);
      setCanUploadExpenseReceipts(false);
      return undefined;
    }
    let cancelled = false;
    fetchSchedulingModuleEnabled(supabase, businessId).then((enabled) => {
      if (!cancelled) setSchedulingModuleEnabled(enabled);
    });
    loadExpenseReceiptAccess();
    return () => {
      cancelled = true;
    };
  }, [selectedProfile?.business_id]);

  const loadExpenseReceiptAccess = async () => {
    try {
      const businessId = getEmployeePortalSelectedBusinessId() || selectedProfile?.business_id;
      const { data, error } = await supabase.functions.invoke('employee-expense-receipt-upload', {
        body: { action: 'check_access', business_id: businessId || undefined },
      });
      if (error || data?.error) {
        setCanUploadExpenseReceipts(false);
        return;
      }
      setCanUploadExpenseReceipts(!!data?.allowed);
    } catch (error) {
      console.warn('[PortalAccount] Expense receipt access check failed:', error);
      setCanUploadExpenseReceipts(false);
    }
  };

  const loadProfileSelection = async () => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const publicUserId = currentUser?.email ? await getPublicUserId(currentUser.email) : null;
      const profiles = publicUserId ? await loadEmployeePortalBusinessProfiles(supabase, publicUserId) : getEmployeePortalProfiles();
      setAvailableProfiles(profiles.length > 0 ? profiles : getEmployeePortalProfiles());
      setSelectedProfile(getEmployeePortalSelectedProfile());
    } catch (error) {
      console.warn('[PortalAccount] Could not load profile switcher:', error);
      setAvailableProfiles(getEmployeePortalProfiles());
      setSelectedProfile(getEmployeePortalSelectedProfile());
    }
  };

  const loadAccountCounts = async () => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) return;

      const publicUserId = await getPublicUserId(currentUser.email);
      const employeeIds = [...new Set([currentUser.id, publicUserId].filter(Boolean))];

      const { count: pendingPolicyCount } = await supabase
        .from('hr_policy_assignments')
        .select('id, hr_policies!inner(requires_acknowledgment)', { count: 'exact', head: true })
        .in('employee_id', employeeIds)
        .eq('acknowledged', false)
        .eq('hr_policies.requires_acknowledgment', true);

      let newPayStatementCount = 0;
      let currentPayStatementIds = [];
      let pendingTrainingCount = 0;
      let pendingAcknowledgementCount = 0;
      let pendingUpdateCount = 0;

      if (publicUserId) {
        const { data: businessUsers } = await supabase
          .from('business_users')
          .select('business_id')
          .eq('user_id', publicUserId)
          .limit(1);

        const selectedBusinessId = getEmployeePortalSelectedBusinessId();
        const businessId = selectedBusinessId || businessUsers?.[0]?.business_id;

        if (businessId) {
          const { data: businessRuns } = await supabase
            .from('hrpayroll_runs')
            .select('id')
            .eq('business_id', businessId)
            .order('pay_date', { ascending: false });

          const runIds = (businessRuns || []).map((run) => run.id);

          if (runIds.length > 0) {
            const { data: payEntries } = await supabase
              .from('hrpayroll_entries')
              .select('id')
              .eq('user_id', publicUserId)
              .in('payroll_run_id', runIds);

            currentPayStatementIds = (payEntries || []).map((entry) => entry.id);
            const seenKey = `employee_seen_pay_statements_${publicUserId}`;
            const seenIds = JSON.parse(localStorage.getItem(seenKey) || '[]');
            const seenSet = new Set(seenIds);
            newPayStatementCount = currentPayStatementIds.filter((id) => !seenSet.has(id)).length;
          }

          const { count: trainingCount } = await supabase
            .from('hr_training_assignments')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', businessId)
            .eq('employee_id', publicUserId)
            .in('status', ['assigned', 'in_progress', 'completed']);

          pendingTrainingCount = trainingCount || 0;

          const { count: acknowledgementCount } = await supabase
            .from('hr_employee_acknowledgements')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', businessId)
            .eq('employee_id', publicUserId)
            .is('acknowledged_at', null)
            .is('cancelled_at', null);

          pendingAcknowledgementCount = acknowledgementCount || 0;

          const { count: updateCount } = await supabase
            .from('hr_employee_updates')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', businessId)
            .eq('employee_id', publicUserId)
            .eq('requires_acknowledgement', true)
            .is('acknowledged_at', null)
            .is('cancelled_at', null);

          pendingUpdateCount = updateCount || 0;
        }
      }

      setPayStatementIds(currentPayStatementIds);
      setCounts({
        pay: newPayStatementCount,
        policies: pendingPolicyCount || 0,
        training: pendingTrainingCount,
        acknowledgements: pendingAcknowledgementCount,
        updates: pendingUpdateCount,
      });
    } catch (error) {
      console.warn('[PortalAccount] Could not load account counts:', error);
    }
  };

  const accountItems = [
    {
      title: 'Pay',
      description: 'View earnings and download pay statements.',
      path: employeeAppPath('/portal/pay-statements'),
      icon: DollarSign,
      badgeCount: counts.pay,
    },
    {
      title: 'Contract',
      description: 'View your employment contract documents.',
      path: employeeAppPath('/portal/contract'),
      icon: FileSignature,
    },
    {
      title: 'Certificates',
      description: 'Upload and manage required certificates.',
      path: employeeAppPath('/portal/certificates'),
      icon: Award,
    },
    {
      title: 'Training',
      description: 'See assigned training and completion status.',
      path: employeeAppPath('/portal/training'),
      icon: BookOpen,
      badgeCount: counts.training,
    },
    {
      title: 'Policies',
      description: 'Review assigned policies and acknowledgements.',
      path: employeeAppPath('/portal/policies'),
      icon: FileText,
      badgeCount: counts.policies,
    },
    {
      title: 'Acknowledgements',
      description: 'Review required HR notices and disciplinary acknowledgements.',
      path: employeeAppPath('/portal/acknowledgements'),
      icon: FileWarning,
      badgeCount: counts.acknowledgements,
    },
    {
      title: 'Incidents',
      description: 'Report incidents and review visible incident records.',
      path: employeeAppPath('/portal/incidents'),
      icon: AlertTriangle,
    },
    {
      title: 'Updates',
      description: 'Review staff-specific notes, updates, and announcements.',
      path: employeeAppPath('/portal/staff-updates'),
      icon: MessageSquareText,
      badgeCount: counts.updates,
    },
  ];

  const secondaryItems = [
    {
      title: 'Profile',
      description: 'Update your employee profile and contact details.',
      path: employeeAppPath('/portal/profile'),
      icon: User,
    },
    {
      title: 'Password & PIN',
      description: 'Manage your login password and employee PIN.',
      path: employeeAppPath('/portal/password-pin'),
      icon: Lock,
    },
  ];

  const styles = {
    page: {
      width: '100%',
      maxWidth: '100%',
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.lg,
      boxSizing: 'border-box',
      overflowX: 'hidden',
    },
    hero: {
      background: `linear-gradient(135deg, ${TavariStyles.colors.primary}, #0f766e)`,
      color: TavariStyles.colors.white,
      borderRadius: '24px',
      padding: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows?.lg || '0 10px 20px rgba(0,0,0,0.15)',
      boxSizing: 'border-box',
      overflowWrap: 'anywhere',
    },
    eyebrow: {
      fontSize: TavariStyles.typography.fontSize.sm,
      opacity: 0.85,
      marginBottom: TavariStyles.spacing.xs,
    },
    title: {
      margin: 0,
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
    },
    subtitle: {
      marginTop: TavariStyles.spacing.sm,
      opacity: 0.9,
      lineHeight: 1.5,
    },
    sectionTitle: {
      margin: 0,
      color: TavariStyles.colors.gray900,
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
      gap: TavariStyles.spacing.md,
      minWidth: 0,
    },
    card: {
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: '18px',
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.lg,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      cursor: 'pointer',
      display: 'flex',
      gap: TavariStyles.spacing.md,
      alignItems: 'flex-start',
      minWidth: 0,
      boxSizing: 'border-box',
      textAlign: 'left',
      position: 'relative',
    },
    activeProfileCard: {
      borderColor: TavariStyles.colors.primary,
      backgroundColor: TavariStyles.colors.primary + '08',
    },
    iconWrap: {
      width: '42px',
      height: '42px',
      borderRadius: '14px',
      backgroundColor: TavariStyles.colors.primary + '15',
      color: TavariStyles.colors.primary,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    cardTitle: {
      margin: 0,
      color: TavariStyles.colors.gray900,
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.bold,
    },
    cardDescription: {
      marginTop: TavariStyles.spacing.xs,
      color: TavariStyles.colors.gray600,
      lineHeight: 1.45,
      fontSize: TavariStyles.typography.fontSize.sm,
    },
    badge: {
      position: 'absolute',
      top: '-8px',
      right: '-8px',
      minWidth: '24px',
      height: '24px',
      padding: '0 7px',
      borderRadius: '999px',
      backgroundColor: '#dc2626',
      color: TavariStyles.colors.white,
      border: `2px solid ${TavariStyles.colors.white}`,
      fontSize: '13px',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box',
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
    },
  };

  const handleCardClick = async (item) => {
    if (item.title === 'Pay') {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        const publicUserId = currentUser?.email ? await getPublicUserId(currentUser.email) : null;
        if (publicUserId) {
          localStorage.setItem(`employee_seen_pay_statements_${publicUserId}`, JSON.stringify(payStatementIds));
          setCounts((current) => ({ ...current, pay: 0 }));
        }
      } catch (error) {
        console.warn('[PortalAccount] Could not mark pay statements as seen:', error);
      }
    }

    navigate(item.path);
  };

  const switchProfile = (profile) => {
    setEmployeePortalSelectedProfile(profile);
    setSelectedProfile(profile);
    window.dispatchEvent(new Event('employee-account-badge-refresh'));
    navigate(employeeAppPath('/portal'));
  };

  const renderCard = (item) => {
    const Icon = item.icon;
    const badgeCount = item.badgeCount || 0;
    return (
      <button
        key={item.path}
        type="button"
        onClick={() => handleCardClick(item)}
        style={styles.card}
      >
        {badgeCount > 0 && (
          <span style={styles.badge}>{badgeCount > 99 ? '99+' : badgeCount}</span>
        )}
        <span style={styles.iconWrap}>
          <Icon size={22} />
        </span>
        <span style={{ minWidth: 0 }}>
          <h3 style={styles.cardTitle}>{item.title}</h3>
          <span style={styles.cardDescription}>{item.description}</span>
        </span>
      </button>
    );
  };

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>Tavari Employee App</div>
        <h1 style={styles.title}>Account</h1>
        <div style={styles.subtitle}>Your pay, documents, certificates, training, and account settings.</div>
      </section>

      {canUploadExpenseReceipts && (
        <>
          <h2 style={styles.sectionTitle}>Business Accounting</h2>
          <section style={styles.grid}>
            <button
              type="button"
              onClick={() => navigate(employeeAppPath('/portal/expense-receipts'))}
              style={styles.card}
            >
              <span style={styles.iconWrap}>
                <Receipt size={22} />
              </span>
              <span style={{ minWidth: 0 }}>
                <h3 style={styles.cardTitle}>Upload receipts</h3>
                <span style={styles.cardDescription}>
                  Photo or PDF receipts go straight to the Accounting expense queue for review.
                </span>
              </span>
            </button>
          </section>
        </>
      )}

      <h2 style={styles.sectionTitle}>Work Documents</h2>
      <section style={styles.grid}>
        {accountItems.map(renderCard)}
      </section>

      <h2 style={styles.sectionTitle}>Account Settings</h2>
      {schedulingModuleEnabled ? (
        <button
          type="button"
          onClick={() => navigate({ pathname: employeeAppPath('/portal/schedule'), search: '?tab=activity' })}
          style={{ ...styles.card, width: '100%', marginBottom: TavariStyles.spacing.md }}
        >
          <span style={styles.iconWrap}>
            <Activity size={22} />
          </span>
          <span style={{ minWidth: 0 }}>
            <h3 style={styles.cardTitle}>Scheduling activity</h3>
            <span style={styles.cardDescription}>Recent shifts, availability, and time off requests.</span>
          </span>
        </button>
      ) : null}
      <section style={styles.grid}>
        {secondaryItems.map(renderCard)}
      </section>

      {availableProfiles.length > 1 && (
        <>
          <h2 style={styles.sectionTitle}>Switch Profile</h2>
          <section style={styles.grid}>
            {availableProfiles.map((profile) => {
              const active = selectedProfile?.employee_id === profile.employee_id && selectedProfile?.business_id === profile.business_id;
              return (
                <button
                  key={`${profile.employee_id}-${profile.business_id}`}
                  type="button"
                  onClick={() => switchProfile(profile)}
                  style={{
                    ...styles.card,
                    ...(active ? styles.activeProfileCard : {})
                  }}
                >
                  <span style={styles.iconWrap}>
                    <User size={22} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <h3 style={styles.cardTitle}>{profile.business_name || 'Business'}</h3>
                    <span style={styles.cardDescription}>
                      {profile.employee_name || profile.email}
                      {active ? ' - Current profile' : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
};

export default PortalAccount;

