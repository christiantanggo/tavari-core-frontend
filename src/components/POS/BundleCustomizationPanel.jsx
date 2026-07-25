import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';

/**
 * All balloon / bundle slots on one screen — one pick-list per slot.
 */
export default function BundleCustomizationPanel({
  title,
  subtitle,
  slots = [],
  slotModifierGroups = {},
  slotSelections = {},
  onSlotSelectionChange,
  loading = false,
  error = null,
}) {
  const handleSelectChange = (slot, group, modifierId) => {
    const modifier = (group.modifiers || []).find((row) => row.id === modifierId);
    if (!modifier) return;
    onSlotSelectionChange(slot.slot_key, [
      {
        ...modifier,
        group_id: group.id,
        group_name: group.name,
      },
    ]);
  };

  const getSelectedModifierId = (slotKey) => {
    const selected = slotSelections[slotKey] || [];
    return selected[0]?.id || '';
  };

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: TavariStyles.colors.gray600 }}>
        Loading customization options…
      </div>
    );
  }

  return (
    <div>
      {(title || subtitle) && (
        <div style={{ marginBottom: 16 }}>
          {title && (
            <div style={{ fontWeight: 700, fontSize: 16, color: TavariStyles.colors.gray900 }}>
              {title}
            </div>
          )}
          {subtitle && (
            <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
              {subtitle}
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 8,
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {slots.length === 0 ? (
        <div style={{ fontSize: 14, color: TavariStyles.colors.gray600 }}>
          No customization needed for this item.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {slots.map((slot) => {
            const groups = slotModifierGroups[slot.slot_key] || [];
            const primaryGroup = groups[0] || null;
            const modifiers = primaryGroup?.modifiers || [];

            return (
              <div
                key={slot.slot_key}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '12px 14px',
                  border: `1px solid ${TavariStyles.colors.gray200}`,
                  borderRadius: 8,
                  backgroundColor: '#fff',
                }}
              >
                <label
                  htmlFor={`bundle-slot-${slot.slot_key}`}
                  style={{ fontWeight: 600, fontSize: 14, color: TavariStyles.colors.gray900 }}
                >
                  {slot.slot_label}
                </label>
                {primaryGroup ? (
                  <select
                    id={`bundle-slot-${slot.slot_key}`}
                    value={getSelectedModifierId(slot.slot_key)}
                    onChange={(e) => handleSelectChange(slot, primaryGroup, e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: `1px solid ${TavariStyles.colors.gray300}`,
                      fontSize: 14,
                      backgroundColor: '#fff',
                    }}
                  >
                    <option value="">Choose {primaryGroup.name || 'style'}…</option>
                    {modifiers.map((modifier) => (
                      <option key={modifier.id} value={modifier.id}>
                        {modifier.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div style={{ fontSize: 13, color: TavariStyles.colors.gray500 }}>
                    No style options available.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
