import React, { useCallback, useEffect, useState } from 'react';
import { FiArrowLeft, FiEdit2, FiPlus, FiTrash2 } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import bookingTermsPackageService from '../../services/Bookings/BookingTermsPackageService';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';

const emptyStep = () => ({
  title: '',
  body: '',
  require_acknowledge: true,
});

/**
 * Builder for reusable booking Terms & Conditions packages + activity attachment.
 */
export default function BookingTermsPackagesManager({ businessId }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [packages, setPackages] = useState([]);
  const [activities, setActivities] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    is_active: true,
    steps: [emptyStep()],
  });

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    bookingTermsPackageService.setBusinessId(businessId);
    try {
      const [pkgRows, activityRows] = await Promise.all([
        bookingTermsPackageService.listPackages({ includeInactive: true }),
        supabase
          .from('booking_activities')
          .select('id, activity_name, terms_package_id, terms_show_on_confirmation, is_active')
          .eq('business_id', businessId)
          .order('activity_name'),
      ]);
      setPackages(pkgRows || []);
      setActivities(activityRows.data || []);
    } catch (error) {
      console.error('[BookingTermsPackagesManager] load failed:', error);
      toast.error('Could not load Terms & Conditions packages');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      name: '',
      description: '',
      is_active: true,
      steps: [emptyStep()],
    });
    setShowForm(true);
  };

  const openEdit = (pkg) => {
    setEditingId(pkg.id);
    setForm({
      name: pkg.name || '',
      description: pkg.description || '',
      is_active: pkg.is_active !== false,
      steps: (pkg.steps || []).length > 0
        ? pkg.steps.map((step) => ({
            title: step.title || '',
            body: step.body || '',
            require_acknowledge: step.require_acknowledge !== false,
          }))
        : [emptyStep()],
    });
    setShowForm(true);
  };

  const updateStep = (index, patch) => {
    setForm((prev) => {
      const steps = [...prev.steps];
      steps[index] = { ...steps[index], ...patch };
      return { ...prev, steps };
    });
  };

  const handleSave = async () => {
    if (!String(form.name || '').trim()) {
      toast.error('Package name is required');
      return;
    }
    if (!form.steps.some((step) => String(step.title || '').trim() && String(step.body || '').trim())) {
      toast.error('Add at least one step with a title and body');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await bookingTermsPackageService.updatePackage(editingId, form);
        toast.success('Terms package updated');
      } else {
        await bookingTermsPackageService.createPackage(form);
        toast.success('Terms package created');
      }
      setShowForm(false);
      await load();
    } catch (error) {
      toast.error(error?.message || 'Could not save package');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (packageId) => {
    if (!window.confirm('Delete this Terms & Conditions package?')) return;
    try {
      await bookingTermsPackageService.deletePackage(packageId);
      toast.success('Package deleted');
      await load();
    } catch (error) {
      toast.error(error?.message || 'Could not delete package');
    }
  };

  const handleAttachActivity = async (activityId, packageId) => {
    try {
      const updated = await bookingTermsPackageService.setActivityPackage(activityId, packageId || null);
      setActivities((prev) =>
        prev.map((row) =>
          row.id === activityId
            ? {
                ...row,
                terms_package_id: updated?.terms_package_id || null,
                terms_show_on_confirmation: updated?.terms_show_on_confirmation === true,
              }
            : row,
        ),
      );
      toast.success(packageId ? 'Terms package attached' : 'Terms package removed');
    } catch (error) {
      toast.error(error?.message || 'Could not update activity');
    }
  };

  const handleConfirmationSetting = async (activityId, value) => {
    const enabled = value === 'confirmation';
    try {
      const updated = await bookingTermsPackageService.setActivityTermsShowOnConfirmation(
        activityId,
        enabled,
      );
      setActivities((prev) =>
        prev.map((row) =>
          row.id === activityId
            ? {
                ...row,
                terms_show_on_confirmation: updated?.terms_show_on_confirmation === true,
              }
            : row,
        ),
      );
      toast.success(
        enabled
          ? 'T&Cs will show on the booking confirmation page'
          : 'T&Cs will not show on the booking confirmation page',
      );
    } catch (error) {
      toast.error(error?.message || 'Could not update confirmation setting');
    }
  };

  if (showForm) {
    return (
      <div style={styles.formWrap}>
        <button type="button" onClick={() => setShowForm(false)} style={styles.linkBtn}>
          <FiArrowLeft size={16} /> Back
        </button>
        <h3 style={styles.h3}>{editingId ? 'Edit Terms package' : 'New Terms package'}</h3>
        <p style={styles.help}>
          Customers acknowledge each step separately, then draw a signature at the end.
        </p>

        <label style={styles.field}>
          <span style={styles.fieldLabel}>Package name *</span>
          <input
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            style={styles.input}
            placeholder="Birthday Party Terms & Conditions"
          />
        </label>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>Description</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            style={styles.textarea}
            rows={3}
          />
        </label>
        <div style={{ marginBottom: 20 }}>
          <TavariCheckbox
            id="terms-pkg-active"
            checked={form.is_active}
            onChange={(checked) => setForm((prev) => ({ ...prev, is_active: checked }))}
            label="Active"
          />
        </div>

        <h4 style={styles.h4}>Steps</h4>
        <div style={styles.stepsList}>
          {form.steps.map((step, index) => (
            <div key={`step-${index}`} style={styles.stepCard}>
              <div style={styles.stepHeader}>
                <strong style={styles.stepHeaderTitle}>Step {index + 1}</strong>
                {form.steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({
                      ...prev,
                      steps: prev.steps.filter((_, i) => i !== index),
                    }))}
                    style={styles.iconBtn}
                    aria-label={`Delete step ${index + 1}`}
                  >
                    <FiTrash2 size={14} />
                  </button>
                )}
              </div>

              <label style={styles.field}>
                <span style={styles.fieldLabel}>Step title</span>
                <input
                  value={step.title}
                  onChange={(e) => updateStep(index, { title: e.target.value })}
                  placeholder="e.g. Outside food policy"
                  style={styles.input}
                />
              </label>

              <label style={styles.field}>
                <span style={styles.fieldLabel}>Terms text</span>
                <textarea
                  value={step.body}
                  onChange={(e) => updateStep(index, { body: e.target.value })}
                  placeholder="Terms text for this step…"
                  rows={6}
                  style={styles.textarea}
                />
              </label>

              <TavariCheckbox
                id={`terms-step-ack-${index}`}
                checked={step.require_acknowledge !== false}
                onChange={(checked) => updateStep(index, { require_acknowledge: checked })}
                label="Require acknowledgment checkbox on this step"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setForm((prev) => ({ ...prev, steps: [...prev.steps, emptyStep()] }))}
          style={{ ...styles.secondaryBtn, marginTop: 4 }}
        >
          <FiPlus size={14} /> Add step
        </button>

        <div style={styles.formFooter}>
          <button type="button" onClick={() => setShowForm(false)} style={styles.secondaryBtn}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving} style={styles.primaryBtn}>
            {saving ? 'Saving…' : 'Save package'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h3 style={styles.h3}>Acknowledgment packages</h3>
          <p style={styles.help}>
            Build step-by-step Terms & Conditions customers must acknowledge and sign.
            Attach a package to any activity, then choose whether it appears on the booking confirmation page.
          </p>
        </div>
        <button type="button" onClick={openCreate} style={styles.primaryBtn}>
          <FiPlus size={16} /> New package
        </button>
      </div>

      {loading ? (
        <div style={{ color: TavariStyles.colors.gray600 }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
            {packages.length === 0 ? (
              <div style={styles.empty}>No packages yet. Create one for birthday parties (or any activity).</div>
            ) : packages.map((pkg) => (
              <div key={pkg.id} style={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{pkg.name}</div>
                    <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
                      {(pkg.steps || []).length} step{(pkg.steps || []).length === 1 ? '' : 's'}
                      {' · '}
                      {pkg.is_active ? 'Active' : 'Inactive'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => openEdit(pkg)} style={styles.iconBtn}><FiEdit2 size={16} /></button>
                    <button type="button" onClick={() => handleDelete(pkg.id)} style={styles.iconBtn}><FiTrash2 size={16} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <h4 style={styles.h4}>Attach to activities</h4>
          <p style={styles.help}>
            Choose a Terms package for each activity, then decide whether the acknowledgment
            appears on the booking confirmation page (used for party / private facility approval).
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(activities || []).map((activity) => (
              <div key={activity.id} style={styles.attachRow}>
                <div style={{ flex: 1, fontWeight: 600, minWidth: 140 }}>{activity.activity_name}</div>
                <select
                  value={activity.terms_package_id || ''}
                  onChange={(e) => handleAttachActivity(activity.id, e.target.value || null)}
                  style={styles.select}
                  aria-label={`Terms package for ${activity.activity_name}`}
                >
                  <option value="">No Terms package</option>
                  {packages.filter((pkg) => pkg.is_active !== false).map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>{pkg.name}</option>
                  ))}
                </select>
                <select
                  value={activity.terms_show_on_confirmation ? 'confirmation' : 'off'}
                  onChange={(e) => handleConfirmationSetting(activity.id, e.target.value)}
                  style={styles.select}
                  disabled={!activity.terms_package_id}
                  aria-label={`Confirmation page T&Cs for ${activity.activity_name}`}
                  title={!activity.terms_package_id ? 'Attach a Terms package first' : undefined}
                >
                  <option value="off">Don&apos;t show on confirmation</option>
                  <option value="confirmation">Show on booking confirmation</option>
                </select>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  formWrap: {
    width: '100%',
    maxWidth: 720,
  },
  h3: { margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: TavariStyles.colors.gray900 },
  h4: { margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: TavariStyles.colors.gray900 },
  help: { margin: '0 0 16px', fontSize: 14, color: TavariStyles.colors.gray600, lineHeight: 1.5 },
  field: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6,
    width: '100%',
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: TavariStyles.colors.gray800,
  },
  input: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
    fontFamily: 'inherit',
    backgroundColor: '#fff',
  },
  textarea: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
    fontFamily: 'inherit',
    lineHeight: 1.5,
    resize: 'vertical',
    backgroundColor: '#fff',
  },
  select: {
    minWidth: 220,
    maxWidth: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
    backgroundColor: '#fff',
  },
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: 'none',
    borderRadius: 8,
    padding: '10px 14px',
    backgroundColor: TavariStyles.colors.primary,
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '10px 14px',
    backgroundColor: '#fff',
    color: '#111827',
    fontWeight: 600,
    cursor: 'pointer',
  },
  linkBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    border: 'none',
    background: 'transparent',
    color: TavariStyles.colors.gray600,
    cursor: 'pointer',
    padding: 0,
    marginBottom: 12,
  },
  iconBtn: {
    border: '1px solid #d1d5db',
    background: '#fff',
    borderRadius: 8,
    padding: 8,
    cursor: 'pointer',
    flexShrink: 0,
  },
  card: { border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, background: '#fff' },
  stepsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginBottom: 12,
  },
  stepCard: {
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: 16,
    background: '#fafafa',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    width: '100%',
    boxSizing: 'border-box',
  },
  stepHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  stepHeaderTitle: {
    fontSize: 14,
    color: TavariStyles.colors.gray900,
  },
  formFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 24,
    paddingTop: 16,
    borderTop: '1px solid #e5e7eb',
  },
  empty: { border: '1px dashed #d1d5db', borderRadius: 10, padding: 20, color: TavariStyles.colors.gray600 },
  attachRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: '12px 14px',
    background: '#fff',
    flexWrap: 'wrap',
  },
};
