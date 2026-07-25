import React, { useState, useEffect } from 'react';
import { FiX, FiSave } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

const TOSABusinessModuleSeatAccessModal = ({
  businessId,
  businessName,
  moduleKey,
  moduleName,
  stripeSubscriptionId,
  onClose,
  onSaved,
}) => {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { data: bu, error: buErr } = await supabase
          .from('business_users')
          .select('user_id')
          .eq('business_id', businessId);
        if (buErr) throw buErr;
        const ids = [...new Set((bu || []).map((b) => b.user_id).filter(Boolean))];
        let users = [];
        if (ids.length) {
          const { data: urows, error: uErr } = await supabase
            .from('users')
            .select('id, full_name, email')
            .in('id', ids);
          if (uErr) throw uErr;
          users = urows || [];
        }

        const { data: access, error: aErr } = await supabase
          .from('business_module_user_access')
          .select('user_id')
          .eq('business_id', businessId)
          .eq('module_key', moduleKey);
        if (aErr) throw aErr;
        const have = new Set((access || []).map((a) => a.user_id));

        if (!cancelled) {
          setRows(users);
          setSelected(have);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.error(e.message || 'Failed to load users');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, moduleKey]);

  const toggle = (userId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const { error: delErr } = await supabase
        .from('business_module_user_access')
        .delete()
        .eq('business_id', businessId)
        .eq('module_key', moduleKey);
      if (delErr) throw delErr;

      const toInsert = [...selected].map((user_id) => ({
        business_id: businessId,
        module_key: moduleKey,
        user_id,
      }));
      if (toInsert.length) {
        const { error: insErr } = await supabase.from('business_module_user_access').insert(toInsert);
        if (insErr) throw insErr;
      }

      if (stripeSubscriptionId) {
        const { data, error } = await supabase.functions.invoke('stripe-update-subscription-seats', {
          body: { business_id: businessId },
        });
        if (error) console.warn('Seat Stripe sync:', error);
        if (data?.error) console.warn('Seat Stripe sync:', data.error);
      }

      toast.success('Module seat access saved');
      onSaved?.();
      onClose?.();
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={header}>
          <div>
            <h2 style={title}>Module access (billing seats)</h2>
            <p style={sub}>
              {businessName} — <strong>{moduleName}</strong> <code style={code}>{moduleKey}</code>
            </p>
          </div>
          <button type="button" style={iconBtn} onClick={onClose} aria-label="Close">
            <FiX size={22} />
          </button>
        </div>
        <p style={hint}>
          Only users checked here count toward module access for billing. Owners should assign module access
          explicitly so admins without the module are not charged a seat.
        </p>
        {loading ? (
          <p style={{ color: TavariStyles.colors.gray600 }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: TavariStyles.colors.gray600 }}>No business_users linked to this business.</p>
        ) : (
          <ul style={list}>
            {rows.map((u) => (
              <li key={u.id} style={li}>
                <label style={rowLabel}>
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() => toggle(u.id)}
                  />
                  <span>
                    <strong>{u.full_name || 'Unnamed'}</strong>
                    <span style={email}> {u.email || ''}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div style={actions}>
          <button type="button" style={secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="button" style={primary} onClick={handleSave} disabled={saving || loading}>
            <FiSave style={{ marginRight: 6 }} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

const overlay = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(15, 23, 42, 0.45)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const modal = {
  backgroundColor: '#fff',
  borderRadius: TavariStyles.borderRadius.lg,
  maxWidth: 560,
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
  padding: TavariStyles.spacing.xl,
  boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
};

const header = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: TavariStyles.spacing.md,
};

const title = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  color: TavariStyles.colors.gray900,
};

const sub = {
  margin: '6px 0 0',
  fontSize: 13,
  color: TavariStyles.colors.gray600,
};

const code = {
  fontSize: 13,
  backgroundColor: TavariStyles.colors.gray100,
  padding: '2px 6px',
  borderRadius: 4,
};

const iconBtn = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: TavariStyles.colors.gray500,
};

const hint = {
  fontSize: 13,
  color: TavariStyles.colors.gray600,
  lineHeight: 1.5,
  marginBottom: TavariStyles.spacing.md,
};

const list = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  maxHeight: 360,
  overflowY: 'auto',
  border: `1px solid ${TavariStyles.colors.border}`,
  borderRadius: TavariStyles.borderRadius.md,
};

const li = {
  borderBottom: `1px solid ${TavariStyles.colors.border}`,
};

const rowLabel = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  cursor: 'pointer',
  fontSize: 14,
};

const email = {
  color: TavariStyles.colors.gray500,
  fontWeight: 400,
};

const actions = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: TavariStyles.spacing.lg,
};

const primary = {
  padding: '10px 16px',
  borderRadius: TavariStyles.borderRadius.md,
  border: 'none',
  backgroundColor: TavariStyles.colors.primary,
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
};

const secondary = {
  padding: '10px 16px',
  borderRadius: TavariStyles.borderRadius.md,
  border: `1px solid ${TavariStyles.colors.border}`,
  backgroundColor: '#fff',
  color: TavariStyles.colors.gray800,
  fontWeight: 500,
  cursor: 'pointer',
};

export default TOSABusinessModuleSeatAccessModal;
