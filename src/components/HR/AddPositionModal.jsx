// Create-only position modal (same fields as HR Position Management) for stacking over other modals.
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import toast from 'react-hot-toast';

const isMissingColumn = (err, col) => {
  if (!err || !col) return false;
  const m = String(err.message || err.details || err.hint || '');
  if (!m.includes(col)) return false;
  if (err.code === 'PGRST204' || err.code === '42703' || err.code === 'PGRST123') return true;
  return (
    m.includes('Could not find') ||
    m.includes('schema cache') ||
    /column .* does not exist/i.test(m)
  );
};

const colorOptions = [
  { name: 'Blue', value: '#4a90e2' },
  { name: 'Red', value: '#dc3545' },
  { name: 'Green', value: '#28a745' },
  { name: 'Orange', value: '#fd7e14' },
  { name: 'Purple', value: '#6610f2' },
  { name: 'Teal', value: '#20c997' },
  { name: 'Yellow', value: '#fbbf24' },
  { name: 'Pink', value: '#e91e63' },
];

async function getNextDisplayOrder(businessId) {
  const { data, error } = await supabase.from('positions').select('*').eq('business_id', businessId);
  if (error) throw error;
  if (!data?.length) return 0;
  const nums = data
    .map((p) => p.display_order)
    .filter((v) => v != null && v !== '')
    .map((v) => Number(v))
    .filter((n) => !Number.isNaN(n));
  if (nums.length) return Math.max(0, ...nums) + 1;
  return data.length;
}

/**
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {string} props.businessId
 * @param {() => void} props.onClose
 * @param {(positionName: string) => void} props.onCreated — called after successful insert
 * @param {number} [props.zIndex=1100] — above typical modals (e.g. Add Employee uses 1000)
 */
export default function AddPositionModal({ isOpen, businessId, onClose, onCreated, zIndex = 1100 }) {
  const [availablePremiums, setAvailablePremiums] = useState([]);
  const [formData, setFormData] = useState({
    position_name: '',
    description: '',
    color: '#4a90e2',
    shift_premium_id: '',
    is_management: false,
    shift_lead_eligible: false,
  });
  const [validationErrors, setValidationErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const activePremiums = useMemo(
    () => (availablePremiums || []).filter((p) => p.is_active !== false),
    [availablePremiums]
  );

  const selectPremiums = useMemo(() => {
    const id = formData.shift_premium_id;
    if (!id) return activePremiums;
    if (activePremiums.some((p) => p.id === id)) return activePremiums;
    const current = (availablePremiums || []).find((p) => p.id === id);
    return current ? [...activePremiums, current] : activePremiums;
  }, [formData.shift_premium_id, activePremiums, availablePremiums]);

  useEffect(() => {
    if (!isOpen || !businessId) return;
    setFormData({
      position_name: '',
      description: '',
      color: '#4a90e2',
      shift_premium_id: '',
      is_management: false,
      shift_lead_eligible: false,
    });
    setValidationErrors({});
    (async () => {
      try {
        const { data, error } = await supabase
          .from('hr_shift_premiums')
          .select('*')
          .eq('business_id', businessId)
          .order('name');
        if (error) throw error;
        setAvailablePremiums(data || []);
      } catch (e) {
        console.error('[AddPositionModal] premiums', e);
        toast.error('Failed to load shift premiums');
        setAvailablePremiums([]);
      }
    })();
  }, [isOpen, businessId]);

  const validateForm = () => {
    const errors = {};
    if (!formData.position_name.trim()) {
      errors.position_name = 'Position name is required';
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!businessId || !validateForm()) return;

    const shiftPremiumId = formData.shift_premium_id ? String(formData.shift_premium_id).trim() : '';
    const payload = {
      position_name: formData.position_name.trim(),
      description: formData.description.trim() || null,
      color: formData.color,
      shift_premium_id: shiftPremiumId || null,
      is_management: !!formData.is_management,
      shift_lead_eligible: !!formData.shift_lead_eligible,
    };

    setSaving(true);
    try {
      const nextOrder = await getNextDisplayOrder(businessId);
      let ins = {
        business_id: businessId,
        ...payload,
        is_active: true,
        display_order: nextOrder,
      };
      let insError;
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = await supabase.from('positions').insert(ins);
        insError = r.error;
        if (!insError) break;
        if (isMissingColumn(insError, 'display_order')) {
          const { display_order: _d, ...rest } = ins;
          ins = rest;
          continue;
        }
        if (isMissingColumn(insError, 'shift_premium_id')) {
          const { shift_premium_id: _s, ...rest } = ins;
          ins = rest;
          continue;
        }
        if (isMissingColumn(insError, 'is_management') || isMissingColumn(insError, 'shift_lead_eligible')) {
          const { is_management: _m, shift_lead_eligible: _k, ...rest } = ins;
          ins = rest;
          continue;
        }
        break;
      }
      if (insError) throw insError;
      toast.success('Position created successfully');
      onCreated?.(payload.position_name);
      onClose();
    } catch (error) {
      console.error('[AddPositionModal]', error);
      toast.error(error.message || 'Failed to save position');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !businessId) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex,
        padding: '16px',
      }}
      onClick={onClose}
      role="presentation"
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          width: '100%',
          maxWidth: '500px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-position-modal-title"
      >
        <h3
          id="add-position-modal-title"
          style={{
            fontSize: '20px',
            fontWeight: '600',
            marginBottom: '20px',
            color: TavariStyles.colors.gray800,
          }}
        >
          Add New Position
        </h3>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '14px',
                fontWeight: '600',
                color: TavariStyles.colors.gray700,
              }}
            >
              Position Name *
            </label>
            <input
              type="text"
              value={formData.position_name}
              onChange={(e) => setFormData({ ...formData, position_name: e.target.value })}
              placeholder="e.g., Manager, Cashier, Server"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                border: `1px solid ${
                  validationErrors.position_name ? TavariStyles.colors.danger : TavariStyles.colors.gray300
                }`,
                borderRadius: '6px',
                fontSize: '14px',
              }}
              autoFocus
            />
            {validationErrors.position_name && (
              <p style={{ color: TavariStyles.colors.danger, fontSize: '13px', marginTop: '4px' }}>
                {validationErrors.position_name}
              </p>
            )}
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '14px',
                fontWeight: '600',
                color: TavariStyles.colors.gray700,
              }}
            >
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional description"
              rows={3}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: '6px',
                fontSize: '14px',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div
            style={{
              marginBottom: '16px',
              padding: '12px',
              backgroundColor: TavariStyles.colors.gray50,
              borderRadius: '8px',
              border: `1px solid ${TavariStyles.colors.gray200}`,
            }}
          >
            <p
              style={{
                fontSize: '13px',
                color: TavariStyles.colors.gray600,
                margin: '0 0 10px 0',
                lineHeight: 1.45,
              }}
            >
              List order in Position Management sets priority. Scheduling uses the position on each shift (or default
              job if blank).
            </p>
            <TavariCheckbox
              id="add-position-is-management"
              appearance="native"
              checked={formData.is_management}
              onChange={(checked) => setFormData((prev) => ({ ...prev, is_management: checked }))}
              label="Counts as management when someone is working this position"
              size="md"
              style={{ alignItems: 'flex-start', marginBottom: '10px' }}
              labelStyle={{ fontWeight: 600 }}
            />
            <TavariCheckbox
              id="add-position-shift-lead"
              appearance="native"
              checked={formData.shift_lead_eligible}
              onChange={(checked) => setFormData((prev) => ({ ...prev, shift_lead_eligible: checked }))}
              label="Eligible for shift lead premium (key holder — priority by list order)"
              size="md"
              style={{ alignItems: 'flex-start' }}
              labelStyle={{ fontWeight: 600 }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '14px',
                fontWeight: '600',
                color: TavariStyles.colors.gray700,
              }}
            >
              Shift Premium
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
              <select
                value={formData.shift_premium_id}
                onChange={(e) => setFormData({ ...formData, shift_premium_id: e.target.value })}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '10px 12px',
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              >
                <option value="">None</option>
                {selectPremiums.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.rate != null && p.rate !== '' ? ` ($${Number(p.rate).toFixed(2)}/hr)` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => window.open('/dashboard/hr/employee-management?tab=shift-premiums', '_blank')}
                style={{
                  padding: '10px 16px',
                  border: `2px solid ${TavariStyles.colors.primary}`,
                  borderRadius: '6px',
                  backgroundColor: 'white',
                  color: TavariStyles.colors.primary,
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap',
                }}
                title="Open Shift Premiums in a new tab"
              >
                <Plus size={16} />
                Manage
              </button>
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '600',
                color: TavariStyles.colors.gray700,
              }}
            >
              Color
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {colorOptions.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, color: color.value })}
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '8px',
                    border: `3px solid ${
                      formData.color === color.value ? TavariStyles.colors.primary : 'transparent'
                    }`,
                    backgroundColor: color.value,
                    cursor: 'pointer',
                    boxShadow:
                      formData.color === color.value
                        ? '0 0 0 2px white, 0 0 0 4px ' + TavariStyles.colors.primary
                        : '0 2px 4px rgba(0,0,0,0.1)',
                  }}
                  title={color.name}
                />
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                padding: '10px 20px',
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: '6px',
                backgroundColor: 'white',
                color: TavariStyles.colors.gray700,
                cursor: saving ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '14px',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '10px 20px',
                border: 'none',
                borderRadius: '6px',
                backgroundColor: TavariStyles.colors.primary,
                color: 'white',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                opacity: saving ? 0.7 : 1,
              }}
            >
              <Save size={16} />
              {saving ? 'Saving…' : 'Create Position'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
