// Waivers module: CSV reports (check-ins, marketing opt-in, minor first-name popularity).
import React, { useState, useEffect } from 'react';
import { FiCalendar, FiMail, FiUsers, FiShield } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useWaiversShellStyle } from '../../contexts/WaiversShellContext';
import toast from 'react-hot-toast';
import {
  buildCsv,
  triggerCsvDownload,
  fetchBusinessTimezone,
  fetchCheckInsForLocalDay,
  fetchMarketingOptInRows,
  fetchMarketingOptOutRows,
  fetchMinorParticipantReportRows,
  fetchWaiverConsentAuditRows,
  waiverConsentAuditCsvColumns
} from '../../services/Waivers/WaiverReportsService';
import { getCurrentBusinessDate } from '../../utils/businessDateFormat';

const WaiverReportsScreen = () => {
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'WaiverReportsScreen'
  });

  const security = useSecurityContext({
    enableRateLimiting: true,
    enableAuditLogging: true,
    componentName: 'WaiverReportsScreen'
  });

  const { hasElevatedPrivileges } = usePermissions();
  const pageStyle = useWaiversShellStyle(styles.page);

  const [businessTimezone, setBusinessTimezone] = useState('America/Toronto');
  const [checkInDate, setCheckInDate] = useState(() => getCurrentBusinessDate('America/Toronto'));
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [marketingLoading, setMarketingLoading] = useState(false);
  const [marketingOptOutLoading, setMarketingOptOutLoading] = useState(false);
  const [minorsLoading, setMinorsLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  const elevated =
    auth.userRole === 'manager' ||
    auth.userRole === 'owner' ||
    auth.userRole === 'admin' ||
    hasElevatedPrivileges();

  useEffect(() => {
    if (!auth.selectedBusinessId) return;
    security
      .logSecurityEvent('waiver_reports_page_accessed', { business_id: auth.selectedBusinessId }, 'low')
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.selectedBusinessId]);

  useEffect(() => {
    if (!auth.selectedBusinessId) return;
    let mounted = true;
    fetchBusinessTimezone(auth.selectedBusinessId)
      .then((tz) => {
        if (!mounted) return;
        const resolved = tz || 'America/Toronto';
        setBusinessTimezone(resolved);
        setCheckInDate(getCurrentBusinessDate(resolved));
      })
      .catch((error) => {
        console.error('Error loading business timezone for waiver reports:', error);
      });
    return () => {
      mounted = false;
    };
  }, [auth.selectedBusinessId]);

  const runCheckInReport = async () => {
    const bid = auth.selectedBusinessId;
    if (!bid) {
      toast.error('No business selected');
      return;
    }
    setCheckInLoading(true);
    try {
      const rows = await fetchCheckInsForLocalDay(bid, checkInDate, businessTimezone);
      const csv = buildCsv(
        [
          { key: 'checked_in_at', header: 'Checked in at' },
          { key: 'display_name', header: 'Name' },
          { key: 'subject_type', header: 'Role' },
          { key: 'email', header: 'Email (person checked in)' },
          { key: 'phone', header: 'Phone (person checked in)' },
          { key: 'linked_to', header: 'Linked to (primary adult on waiver)' },
          { key: 'linked_email', header: 'Linked to email' },
          { key: 'linked_phone', header: 'Linked to phone' },
          { key: 'waiver_id', header: 'Waiver ID' },
          { key: 'waiver_participant_id', header: 'Participant ID' },
          { key: 'checked_in_by_user_id', header: 'Staff user ID' }
        ],
        rows.map((r) => ({
          ...r,
          email: r.email ?? '',
          phone: r.phone ?? '',
          linked_to: r.linked_to ?? '',
          linked_email: r.linked_email ?? '',
          linked_phone: r.linked_phone ?? '',
          waiver_participant_id: r.waiver_participant_id ?? '',
          checked_in_by_user_id: r.checked_in_by_user_id ?? ''
        }))
      );
      triggerCsvDownload(`waiver-check-ins-${checkInDate}.csv`, csv);
      toast.success(rows.length ? `Downloaded ${rows.length} row(s)` : 'No check-ins for that day');
    } catch (e) {
      console.error(e);
      toast.error(e?.message || 'Check-in report failed');
    } finally {
      setCheckInLoading(false);
    }
  };

  const runMarketingReport = async () => {
    const bid = auth.selectedBusinessId;
    if (!bid) {
      toast.error('No business selected');
      return;
    }
    setMarketingLoading(true);
    try {
      const rows = await fetchMarketingOptInRows(bid, businessTimezone);
      const csv = buildCsv(
        [
          { key: 'first_name', header: 'First name' },
          { key: 'last_name', header: 'Last name' },
          { key: 'email', header: 'Email' },
          { key: 'phone_number', header: 'Phone' },
          { key: 'signed_at', header: 'Signed at' },
          { key: 'waiver_id', header: 'Waiver ID' }
        ],
        rows.map((r) => ({ ...r, phone_number: r.phone_number ?? '' }))
      );
      triggerCsvDownload('waiver-marketing-opt-in.csv', csv);
      toast.success(rows.length ? `Downloaded ${rows.length} contact(s)` : 'No marketing opt-ins found');
    } catch (e) {
      console.error(e);
      toast.error(e?.message || 'Marketing report failed');
    } finally {
      setMarketingLoading(false);
    }
  };

  const runMarketingOptOutReport = async () => {
    const bid = auth.selectedBusinessId;
    if (!bid) {
      toast.error('No business selected');
      return;
    }
    setMarketingOptOutLoading(true);
    try {
      const rows = await fetchMarketingOptOutRows(bid, businessTimezone);
      const csv = buildCsv(
        [
          { key: 'first_name', header: 'First name' },
          { key: 'last_name', header: 'Last name' },
          { key: 'email', header: 'Email' },
          { key: 'phone_number', header: 'Phone' },
          { key: 'signed_at', header: 'Signed at' },
          { key: 'waiver_id', header: 'Waiver ID' }
        ],
        rows.map((r) => ({ ...r, phone_number: r.phone_number ?? '' }))
      );
      triggerCsvDownload('waiver-marketing-opt-out.csv', csv);
      toast.success(rows.length ? `Downloaded ${rows.length} contact(s)` : 'No marketing opt-outs found');
    } catch (e) {
      console.error(e);
      toast.error(e?.message || 'Marketing opt-out report failed');
    } finally {
      setMarketingOptOutLoading(false);
    }
  };

  const runMinorNamesReport = async () => {
    const bid = auth.selectedBusinessId;
    if (!bid) {
      toast.error('No business selected');
      return;
    }
    setMinorsLoading(true);
    try {
      const rows = await fetchMinorParticipantReportRows(bid);
      const csv = buildCsv(
        [
          { key: 'first_name_popularity_count', header: 'First name popularity (count)' },
          { key: 'minor_first_name', header: 'Minor first name' },
          { key: 'minor_last_name', header: 'Minor last name' },
          { key: 'linked_to', header: 'Linked to (primary adult)' },
          { key: 'linked_email', header: 'Linked to email' },
          { key: 'linked_phone', header: 'Linked to phone' },
          { key: 'waiver_id', header: 'Waiver ID' }
        ],
        rows.map((r) => ({
          first_name_popularity_count: r.first_name_popularity_count,
          minor_first_name: r.minor_first_name,
          minor_last_name: r.minor_last_name,
          linked_to: r.linked_to ?? '',
          linked_email: r.linked_email ?? '',
          linked_phone: r.linked_phone ?? '',
          waiver_id: r.waiver_id
        }))
      );
      triggerCsvDownload('waiver-minors-with-linked-adult.csv', csv);
      toast.success(
        rows.length ? `Downloaded ${rows.length} minor row(s) (sorted by name popularity)` : 'No minors found'
      );
    } catch (e) {
      console.error(e);
      toast.error(e?.message || 'Minor names report failed');
    } finally {
      setMinorsLoading(false);
    }
  };

  const runConsentAuditReport = async () => {
    const bid = auth.selectedBusinessId;
    if (!bid) {
      toast.error('No business selected');
      return;
    }
    setAuditLoading(true);
    try {
      const rows = await fetchWaiverConsentAuditRows(bid, businessTimezone);
      const csv = buildCsv(waiverConsentAuditCsvColumns(), rows);
      triggerCsvDownload('waiver-consent-audit.csv', csv);
      toast.success(rows.length ? `Downloaded ${rows.length} waiver row(s)` : 'No signed waivers found');
    } catch (e) {
      console.error(e);
      toast.error(e?.message || 'Consent audit export failed');
    } finally {
      setAuditLoading(false);
    }
  };

  if (auth.authLoading) {
    return (
      <POSAuthWrapper componentName="WaiverReportsScreen">
        <div style={styles.loadingBox}>
          <p>Loading...</p>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!elevated) {
    return (
      <POSAuthWrapper componentName="WaiverReportsScreen">
        <div style={styles.loadingBox}>
          <h2>Access denied</h2>
          <p>Reports are available to managers and owners.</p>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper componentName="WaiverReportsScreen">
      <SecurityWrapper componentName="WaiverReportsScreen" sensitiveComponent>
        <div style={pageStyle}>
          <h1 style={styles.title}>Reports</h1>
          <p style={styles.lead}>
            Export waiver data as CSV. To open the kiosk in a browser or download the desktop app, use the{' '}
            <strong>Download</strong> tab.
          </p>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>CSV exports</h2>

            <div style={styles.reportCard}>
              <div style={styles.reportIcon}>
                <FiCalendar size={22} />
              </div>
              <div style={styles.reportBody}>
                <h3 style={styles.reportTitle}>Check-ins for a day</h3>
                <p style={styles.reportDesc}>
                  Everyone checked in via the dashboard for the selected calendar day (local time). Minors include
                  columns for the primary adult on the waiver (linked name, email, phone); adults include their own
                  email and phone when on file.
                </p>
                <div style={styles.reportActions}>
                  <input
                    type="date"
                    value={checkInDate}
                    onChange={(e) => setCheckInDate(e.target.value)}
                    style={styles.dateInput}
                  />
                  <button
                    type="button"
                    style={styles.secondaryBtn}
                    disabled={checkInLoading || !checkInDate}
                    onClick={runCheckInReport}
                  >
                    {checkInLoading ? 'Working…' : 'Download CSV'}
                  </button>
                </div>
              </div>
            </div>

            <div style={styles.reportCard}>
              <div style={styles.reportIcon}>
                <FiMail size={22} />
              </div>
              <div style={styles.reportBody}>
                <h3 style={styles.reportTitle}>Marketing opt-in</h3>
                <p style={styles.reportDesc}>
                  Primary signers who selected Yes for marketing consent: name, email, and phone.
                </p>
                <div style={styles.reportActions}>
                  <button
                    type="button"
                    style={styles.secondaryBtn}
                    disabled={marketingLoading}
                    onClick={runMarketingReport}
                  >
                    {marketingLoading ? 'Working…' : 'Download Opt-In CSV'}
                  </button>
                  <button
                    type="button"
                    style={styles.secondaryBtn}
                    disabled={marketingOptOutLoading}
                    onClick={runMarketingOptOutReport}
                  >
                    {marketingOptOutLoading ? 'Working…' : 'Download Opt-Out CSV'}
                  </button>
                </div>
              </div>
            </div>

            <div style={styles.reportCard}>
              <div style={styles.reportIcon}>
                <FiShield size={22} />
              </div>
              <div style={styles.reportBody}>
                <h3 style={styles.reportTitle}>Consent &amp; acknowledgement audit</h3>
                <p style={styles.reportDesc}>
                  One row per signed waiver: marketing/medical/other consents, waiver terms read,
                  electronic-signature acknowledgement, additional-adult intent (plus JSON detail when recorded).
                </p>
                <button
                  type="button"
                  style={styles.secondaryBtn}
                  disabled={auditLoading}
                  onClick={runConsentAuditReport}
                >
                  {auditLoading ? 'Working…' : 'Download CSV'}
                </button>
              </div>
            </div>

            <div style={styles.reportCard}>
              <div style={styles.reportIcon}>
                <FiUsers size={22} />
              </div>
              <div style={styles.reportBody}>
                <h3 style={styles.reportTitle}>Minors (with linked adult)</h3>
                <p style={styles.reportDesc}>
                  One row per minor: first and last name, primary adult on the waiver (&quot;Linked to&quot;), that
                  adult&apos;s email and phone, waiver id, plus a first-name popularity count. Sorted by popularity
                  (highest first).
                </p>
                <button
                  type="button"
                  style={styles.secondaryBtn}
                  disabled={minorsLoading}
                  onClick={runMinorNamesReport}
                >
                  {minorsLoading ? 'Working…' : 'Download CSV'}
                </button>
              </div>
            </div>
          </section>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  page: {
    maxWidth: '900px',
    margin: '0 auto',
    paddingBottom: TavariStyles.spacing.xl
  },
  title: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: 700,
    color: TavariStyles.colors.text,
    margin: 0,
    marginBottom: TavariStyles.spacing.sm
  },
  lead: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: TavariStyles.spacing.xl,
    lineHeight: 1.5
  },
  section: {
    marginBottom: TavariStyles.spacing['2xl'] || '32px',
    padding: TavariStyles.spacing.xl,
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.06)'
  },
  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: 700,
    color: TavariStyles.colors.text,
    margin: 0,
    marginBottom: TavariStyles.spacing.md
  },
  reportCard: {
    display: 'flex',
    gap: TavariStyles.spacing.md,
    padding: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  reportIcon: {
    flexShrink: 0,
    color: TavariStyles.colors.primary,
    paddingTop: 4
  },
  reportBody: { flex: 1, minWidth: 0 },
  reportTitle: {
    margin: 0,
    marginBottom: 6,
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: 600,
    color: TavariStyles.colors.text
  },
  reportDesc: {
    margin: 0,
    marginBottom: TavariStyles.spacing.md,
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    lineHeight: 1.45
  },
  reportActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: TavariStyles.spacing.sm,
    alignItems: 'center'
  },
  dateInput: {
    padding: '8px 12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.sm,
    fontFamily: 'inherit'
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.primary,
    border: `2px solid ${TavariStyles.colors.primary}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm
  },
  loadingBox: { padding: TavariStyles.spacing.xl, textAlign: 'center', color: TavariStyles.colors.gray600 }
};

export default WaiverReportsScreen;
