import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { TavariStyles } from '../../utils/TavariStyles';
import { HR_POSITION_MANAGEMENT_PATH } from '../../utils/positionCatalog';
import { useBusinessPositions } from '../../hooks/useBusinessPositions';

const LEGACY_SENTINEL = '__tavari_position_unknown__';

/**
 * Dropdown of HR-managed positions + "+ New Position" → Position Management tab
 * (or `onRequestNewPosition` for a stacked in-flow create UI).
 * Optionally pass `positions` from parent to avoid duplicate fetch.
 */
export default function PositionSelectWithNew({
  businessId,
  positions: positionsProp,
  value,
  onChange,
  disabled = false,
  required = false,
  selectStyle = {},
  rowStyle = {},
  buttonLabel = '+ New Position',
  /** When set, "+ New Position" opens this callback instead of navigating to Position Management. */
  onRequestNewPosition
}) {
  const navigate = useNavigate();
  const { rows: fetchedRows } = useBusinessPositions(positionsProp !== undefined ? null : businessId);

  const rows = positionsProp !== undefined ? positionsProp : fetchedRows;

  const names = useMemo(
    () =>
      [...(rows || [])]
        .map((r) => r.position_name)
        .filter(Boolean),
    [rows]
  );

  const nameSet = useMemo(() => {
    const s = new Set();
    names.forEach((n) => s.add(String(n).trim()));
    return s;
  }, [names]);

  const trimmed = value != null ? String(value).trim() : '';
  const inCatalog = trimmed !== '' && nameSet.has(trimmed);
  const selectValue = inCatalog ? trimmed : trimmed ? LEGACY_SENTINEL : '';

  const handleSelectChange = (e) => {
    const v = e.target.value;
    if (v === LEGACY_SENTINEL) return;
    onChange?.(v);
  };

  const handleNewPosition = () => {
    if (onRequestNewPosition) {
      onRequestNewPosition();
      return;
    }
    navigate(HR_POSITION_MANAGEMENT_PATH);
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        flexWrap: 'wrap',
        ...rowStyle
      }}
    >
      <select
        required={required}
        value={selectValue}
        onChange={handleSelectChange}
        disabled={disabled}
        style={{
          flex: 1,
          minWidth: '140px',
          padding: '8px 12px',
          border: `1px solid ${TavariStyles.colors.gray300}`,
          borderRadius: '6px',
          fontSize: '14px',
          ...selectStyle
        }}
      >
        <option value="">
          {required ? 'Select position' : '—'}
        </option>
        {trimmed && !inCatalog && (
          <option value={LEGACY_SENTINEL}>Unknown</option>
        )}
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleNewPosition}
        disabled={disabled}
        style={{
          padding: '8px 12px',
          borderRadius: '6px',
          border: `1px solid ${TavariStyles.colors.primary}`,
          backgroundColor: 'white',
          color: TavariStyles.colors.primary,
          fontSize: '13px',
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap'
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
