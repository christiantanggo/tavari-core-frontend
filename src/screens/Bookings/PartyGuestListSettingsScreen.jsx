import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import partyGuestListService from '../../services/Bookings/PartyGuestListService';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';

export default function PartyGuestListSettingsScreen() {
  const auth = usePOSAuth();
  const businessId = auth.selectedBusinessId;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    edit_deadline_days_before_party: 7,
    default_included_kids: 12,
    default_included_adults: 12,
    kids_chair_limit_per_room: 18,
    one_adult_per_child_enabled: false,
    post_deadline_contact_text: '',
    staff_notification_emails: '',
    host_portal_intro: '',
  });

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      partyGuestListService.setBusinessId(businessId);
      const data = await partyGuestListService.loadSettings();
      if (data) {
        setForm({
          edit_deadline_days_before_party: data.edit_deadline_days_before_party ?? 7,
          default_included_kids: data.default_included_kids ?? 12,
          default_included_adults: data.default_included_adults ?? 12,
          kids_chair_limit_per_room: data.kids_chair_limit_per_room ?? 18,
          one_adult_per_child_enabled: data.one_adult_per_child_enabled === true,
          post_deadline_contact_text: data.post_deadline_contact_text || '',
          staff_notification_emails: (data.staff_notification_emails || []).join(', '),
          host_portal_intro: data.host_portal_intro || '',
        });
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      partyGuestListService.setBusinessId(businessId);
      await partyGuestListService.saveSettings({
        edit_deadline_days_before_party: Number(form.edit_deadline_days_before_party) || 7,
        default_included_kids: Number(form.default_included_kids) || 12,
        default_included_adults: Number(form.default_included_adults) || 12,
        kids_chair_limit_per_room: Number(form.kids_chair_limit_per_room) || 18,
        one_adult_per_child_enabled: !!form.one_adult_per_child_enabled,
        post_deadline_contact_text: form.post_deadline_contact_text,
        staff_notification_emails: form.staff_notification_emails
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        host_portal_intro: form.host_portal_intro,
      });
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const field = (label, key, type = 'number') => (
    <label style={{ display: 'block', marginBottom: 16 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>{label}</div>
      {type === 'textarea' ? (
        <textarea
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          rows={3}
          style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #d1d5db', boxSizing: 'border-box' }}
        />
      ) : (
        <input
          type={type}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          style={{ width: '100%', maxWidth: 320, padding: 10, borderRadius: 8, border: '1px solid #d1d5db', boxSizing: 'border-box' }}
        />
      )}
    </label>
  );

  return (
    <POSAuthWrapper componentName="PartyGuestListSettingsScreen">
      <div style={{ padding: 24, maxWidth: 640 }}>
        <Link to="/dashboard/bookings/parties" style={{ color: TavariStyles.colors.primary }}>← Parties</Link>
        <h1 style={{ margin: '16px 0 8px' }}>Party guest list settings</h1>
        <p style={{ color: '#6b7280', marginBottom: 24 }}>
          Configure deadlines, package guest counts, chair warnings, and staff notifications.
        </p>

        {loading ? (
          <p>Loading…</p>
        ) : (
          <>
            {field('Edit deadline (days before party)', 'edit_deadline_days_before_party')}
            {field('Included kids (default package)', 'default_included_kids')}
            {field('Included adults / non-moving babies', 'default_included_adults')}
            {field('Kid chair limit per room', 'kids_chair_limit_per_room')}
            <div style={{ marginBottom: 16 }}>
              <TavariCheckbox
                checked={!!form.one_adult_per_child_enabled}
                onChange={(checked) => setForm((prev) => ({ ...prev, one_adult_per_child_enabled: !!checked }))}
                label="1 free adult per child on guest list"
                size="md"
              />
              <p style={{ fontSize: 13, color: '#6b7280', marginTop: 8, marginLeft: 28 }}>
                When enabled, each child on the guest list includes one free adult. Included adults are the higher of the default included adults above or the number of children on the list.
              </p>
            </div>
            {field('Post-deadline contact message (shown to hosts)', 'post_deadline_contact_text', 'textarea')}
            {field('Staff notification emails (comma-separated)', 'staff_notification_emails', 'text')}
            {field('Host portal intro (optional)', 'host_portal_intro', 'textarea')}

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{ padding: '12px 18px', borderRadius: 8, border: 'none', background: TavariStyles.colors.primary, color: '#fff', fontWeight: 600, cursor: 'pointer' }}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </>
        )}
      </div>
    </POSAuthWrapper>
  );
}
