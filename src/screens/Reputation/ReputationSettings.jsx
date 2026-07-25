import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import ModuleDeactivationPanel from '../../components/Modules/ModuleDeactivationPanel';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../../components/UI/TavariCheckbox';

const card = {
  background: '#fff',
  borderRadius: TavariStyles.borderRadius.lg,
  padding: TavariStyles.spacing.xl,
  boxShadow: TavariStyles.shadows.sm,
  marginBottom: TavariStyles.spacing.lg,
};

const labelStyle = { display: 'block', fontWeight: 600, marginBottom: 6, fontSize: TavariStyles.typography.fontSize.sm };
const inputStyle = {
  width: '100%',
  maxWidth: 480,
  padding: '10px 12px',
  borderRadius: TavariStyles.borderRadius.md,
  border: `1px solid ${TavariStyles.colors.gray300}`,
  boxSizing: 'border-box',
  marginBottom: TavariStyles.spacing.md,
};

export default function ReputationSettings() {
  const { selectedBusinessId } = useBusinessContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [minStars, setMinStars] = useState(4);
  const [delayHours, setDelayHours] = useState(24);
  const [googleReviewUrl, setGoogleReviewUrl] = useState('');
  const [managerEmails, setManagerEmails] = useState('');
  const [retentionDays, setRetentionDays] = useState(365);
  const [privacyUrl, setPrivacyUrl] = useState('');
  const [termsUrl, setTermsUrl] = useState('');
  const [aiGuidelines, setAiGuidelines] = useState('');

  const [waiverCheckInReviewEnabled, setWaiverCheckInReviewEnabled] = useState(true);
  const [waiverCheckInDelayMinutes, setWaiverCheckInDelayMinutes] = useState(0);
  const [waiverCheckInAdultsOnly, setWaiverCheckInAdultsOnly] = useState(true);

  const [testEmail, setTestEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!selectedBusinessId) return;
      setLoading(true);
      const { data, error } = await supabase
        .from('reputation_settings')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .maybeSingle();

      if (error) {
        console.error(error);
        toast.error('Could not load settings');
      } else if (data) {
        setEnabled(!!data.enabled);
        setMinStars(data.min_stars_redirect_google ?? 4);
        setDelayHours(data.invite_delay_hours ?? 24);
        setGoogleReviewUrl(data.google_review_url || '');
        setManagerEmails((data.manager_notification_emails || []).join(', '));
        setRetentionDays(data.retention_days_internal_feedback ?? 365);
        setPrivacyUrl(data.privacy_policy_url || '');
        setTermsUrl(data.terms_url || '');
        setAiGuidelines(data.ai_reply_guidelines || '');
        setWaiverCheckInReviewEnabled(
          data.waiver_check_in_review_email_enabled === undefined ? true : !!data.waiver_check_in_review_email_enabled,
        );
        setWaiverCheckInDelayMinutes(
          data.waiver_check_in_review_delay_minutes != null ? Number(data.waiver_check_in_review_delay_minutes) : 0,
        );
        setWaiverCheckInAdultsOnly(
          data.waiver_check_in_review_adults_only === undefined ? true : !!data.waiver_check_in_review_adults_only,
        );
      }

      setLoading(false);
    };
    load();
  }, [selectedBusinessId]);

  const save = async () => {
    if (!selectedBusinessId) return;
    setSaving(true);
    const emails = managerEmails
      .split(/[,;\n]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const { error } = await supabase.from('reputation_settings').upsert(
      {
        business_id: selectedBusinessId,
        enabled,
        min_stars_redirect_google: minStars,
        invite_delay_hours: delayHours,
        google_review_url: googleReviewUrl.trim() || null,
        manager_notification_emails: emails,
        retention_days_internal_feedback: retentionDays,
        privacy_policy_url: privacyUrl.trim() || null,
        terms_url: termsUrl.trim() || null,
        ai_reply_guidelines: aiGuidelines.trim() || null,
        waiver_check_in_review_email_enabled: waiverCheckInReviewEnabled,
        waiver_check_in_review_delay_minutes: Math.max(
          0,
          Math.min(10080, Math.round(Number(waiverCheckInDelayMinutes) || 0)),
        ),
        waiver_check_in_review_adults_only: waiverCheckInAdultsOnly,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'business_id' },
    );

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Saved');
    }
    setSaving(false);
  };

  const fillBuiltInLegalUrls = () => {
    const o = typeof window !== 'undefined' ? window.location.origin : '';
    setPrivacyUrl(`${o}/reputation/legal/privacy`);
    setTermsUrl(`${o}/reputation/legal/terms`);
    toast.success('Filled default URLs — click Save settings to store them.');
  };

  const createTestInvite = async () => {
    if (!selectedBusinessId || !testEmail.trim()) {
      toast.error('Enter an email');
      return;
    }
    const { data, error } = await supabase.rpc('reputation_create_invite_token', {
      p_business_id: selectedBusinessId,
      p_contact_normalized: testEmail.trim(),
      p_channel: 'email',
      p_source: 'manual',
      p_ttl_days: 30,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data?.ok) {
      toast.error(data?.error || 'Could not create invite');
      return;
    }
    const link = `${window.location.origin}/reputation/i/${data.secret}`;
    setInviteLink(link);
    toast.success('Invite token created');
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  /** One link for every thank-you email / campaign — same URL for all recipients (anonymous flow). */
  const publicReviewUrl = selectedBusinessId ? `${baseUrl}/reputation/review/${selectedBusinessId}` : '';
  const qrUrl = publicReviewUrl;

  if (loading) {
    return <p>Loading settings…</p>;
  }

  return (
    <div>
      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Core</h3>
        <div style={{ marginBottom: TavariStyles.spacing.lg }}>
          <TavariCheckbox
            id="reputation-enabled"
            checked={enabled}
            onChange={(v) => setEnabled(v)}
            label="Enable reputation collection"
            appearance="native"
            size="lg"
          />
        </div>
        <label style={labelStyle}>Minimum stars to open public review URL</label>
        <select
          value={minStars}
          onChange={(e) => setMinStars(Number(e.target.value))}
          style={inputStyle}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}+
            </option>
          ))}
        </select>
        <label style={labelStyle}>Invite delay (hours, for future automation)</label>
        <input
          type="number"
          min={0}
          value={delayHours}
          onChange={(e) => setDelayHours(Number(e.target.value))}
          style={inputStyle}
        />
        <label style={labelStyle}>Public review URL (e.g. your Maps / review link for happy customers)</label>
        <input
          value={googleReviewUrl}
          onChange={(e) => setGoogleReviewUrl(e.target.value)}
          placeholder="https://g.page/.../review"
          style={inputStyle}
        />
        <label style={labelStyle}>Manager notification emails (comma-separated)</label>
        <textarea
          value={managerEmails}
          onChange={(e) => setManagerEmails(e.target.value)}
          rows={2}
          style={{ ...inputStyle, maxWidth: '100%' }}
        />
        <label style={labelStyle}>Retention (days) for internal feedback records</label>
        <input
          type="number"
          min={1}
          value={retentionDays}
          onChange={(e) => setRetentionDays(Number(e.target.value))}
          style={inputStyle}
        />
        <label style={labelStyle}>Privacy policy URL (shown on public page)</label>
        <input value={privacyUrl} onChange={(e) => setPrivacyUrl(e.target.value)} style={inputStyle} />
        <label style={labelStyle}>Terms URL</label>
        <input value={termsUrl} onChange={(e) => setTermsUrl(e.target.value)} style={inputStyle} />
        <button
          type="button"
          onClick={fillBuiltInLegalUrls}
          style={{
            padding: '8px 14px',
            marginBottom: TavariStyles.spacing.md,
            borderRadius: TavariStyles.borderRadius.md,
            border: `1px solid ${TavariStyles.colors.gray300}`,
            background: TavariStyles.colors.gray50,
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: TavariStyles.typography.fontSize.sm,
          }}
        >
          Use Tavari default privacy &amp; terms URLs
        </button>
        <label style={labelStyle}>AI reply guidelines (for future auto-drafts)</label>
        <textarea
          value={aiGuidelines}
          onChange={(e) => setAiGuidelines(e.target.value)}
          rows={3}
          style={{ ...inputStyle, maxWidth: '100%' }}
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            padding: '10px 22px',
            borderRadius: TavariStyles.borderRadius.lg,
            border: 'none',
            background: TavariStyles.colors.primary,
            color: '#fff',
            fontWeight: 600,
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Waiver check-in → review email</h3>
        <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginTop: 0 }}>
          When staff checks someone in on a waiver, Tavari can email them a thank-you and link to your{' '}
          <strong>public review page</strong> (below). This uses your Mail module: create an{' '}
          <strong>automation</strong> with trigger <code>waiver_check_in_review</code> — see{' '}
          <Link to="/dashboard/mail/builder" style={{ color: TavariStyles.colors.primary }}>
            Mail → Builder
          </Link>{' '}
          or{' '}
          <Link to="/dashboard/mail/automations" style={{ color: TavariStyles.colors.primary }}>
            Automations
          </Link>
          . Merge tags: <code>{'{{ReviewLink}}'}</code>, <code>{'{{CheckedInName}}'}</code>.
        </p>
        <div style={{ marginBottom: TavariStyles.spacing.lg }}>
          <TavariCheckbox
            id="waiver-checkin-review-enabled"
            checked={waiverCheckInReviewEnabled}
            onChange={(v) => setWaiverCheckInReviewEnabled(v)}
            label="Send review request after waiver check-in (when a Mail automation is set up)"
            appearance="native"
            size="lg"
          />
        </div>
        <div style={{ marginBottom: TavariStyles.spacing.lg }}>
          <TavariCheckbox
            id="waiver-checkin-adults-only"
            checked={waiverCheckInAdultsOnly}
            onChange={(v) => setWaiverCheckInAdultsOnly(v)}
            label="Adults only (skip when the checked-in person is a minor)"
            appearance="native"
            size="lg"
          />
        </div>
        <label style={labelStyle}>Delay after check-in (minutes)</label>
        <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray500, marginTop: 0 }}>
          <strong>0</strong> = send as soon as the check-in is saved. Otherwise the email is queued and sent after this
          many minutes (max 7 days = 10080). Each adult check-in gets one email; delayed sends are processed every few
          minutes.
        </p>
        <input
          type="number"
          min={0}
          max={10080}
          value={waiverCheckInDelayMinutes}
          onChange={(e) => setWaiverCheckInDelayMinutes(Number(e.target.value))}
          style={inputStyle}
        />
        <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray500 }}>
          Use <strong>Save settings</strong> in the Core section above to store these options.
        </p>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Public review link (same for everyone)</h3>
        <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
          Put this in thank-you emails, Bookeo, Mailchimp, etc. One URL for all customers — no per-person link. Each person
          submits from their own phone or computer.
        </p>
        <p
          style={{
            fontSize: TavariStyles.typography.fontSize.sm,
            fontWeight: 600,
            color: TavariStyles.colors.gray800,
            marginBottom: TavariStyles.spacing.sm,
          }}
        >
          This URL contains <code>/reputation/review/</code>. Do not paste <code>/reputation/i/</code> links into
          mass campaigns — those are single-use. <strong>Waiver check-in review emails</strong> automatically use a
          personal <code>/reputation/i/…</code> link per guest so you can follow up on low ratings.
        </p>
        {publicReviewUrl ? (
          <div style={{ marginBottom: TavariStyles.spacing.md }}>
            <code style={{ display: 'block', wordBreak: 'break-all', marginBottom: 8 }}>{publicReviewUrl}</code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(publicReviewUrl).then(
                  () => toast.success('Link copied'),
                  () => toast.error('Could not copy'),
                );
              }}
              style={{
                padding: '8px 16px',
                borderRadius: TavariStyles.borderRadius.md,
                fontWeight: 600,
                border: `1px solid ${TavariStyles.colors.gray300}`,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              Copy link
            </button>
          </div>
        ) : null}
        <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray500 }}>
          Alternate paths (same page): <code>/reputation/b/…</code> and <code>/reputation/qr/…</code>
        </p>
        <p style={{ fontSize: TavariStyles.typography.fontSize.sm, marginTop: TavariStyles.spacing.md }}>
          <strong>QR code</strong> (optional — encodes the same kind of public link):
        </p>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {qrUrl ? <QRCodeSVG value={qrUrl} size={160} level="M" includeMargin /> : null}
          <code style={{ wordBreak: 'break-all' }}>{qrUrl}</code>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Single-use test invite (not for campaigns)</h3>
        <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
          For testing only. The link expires after use — do <strong>not</strong> paste it into Mailchimp or thank-you
          emails. For everyone, use <strong>Public review link</strong> above.
        </p>
        <input
          placeholder="customer@example.com"
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
          style={inputStyle}
        />
        <button type="button" onClick={createTestInvite} style={{ padding: '8px 16px', borderRadius: 8, fontWeight: 600 }}>
          Generate link
        </button>
        {inviteLink ? (
          <p style={{ marginTop: 12 }}>
            <a href={inviteLink} target="_blank" rel="noreferrer">
              {inviteLink}
            </a>
          </p>
        ) : null}
      </div>

      <ModuleDeactivationPanel moduleKey="reputation" />
    </div>
  );
}
