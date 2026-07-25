import React, { useMemo, useState } from 'react';
import { FiCheck, FiEdit2, FiPrinter } from 'react-icons/fi';
import TavariCheckbox from '../UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import {
  buildGuestListEntryDisplayMeta,
  computePartyGuestOverageSummary,
  draftToGuestEntry,
  emptyGuestDraft,
  formatGuestFullName,
  formatPartyGuestMoney,
  PARTY_GUEST_OVERAGE_FOOD_OPTIONS,
  PARTY_GUEST_OVERAGE_PAYMENT_OPTIONS,
  PARTY_GUEST_OVERAGE_SOCKS_OPTIONS,
  resolvePartyGuestOveragePayment,
  resolvePartyGuestOveragePricing,
  roleTagLabel,
  splitEntriesForStaffView,
  waiverStatusStyle,
} from '../../utils/partyGuestList';
import { formatPhoneDisplay, formatPhoneInput } from '../../utils/phoneFormat';
import './PartyGuestListComponents.css';

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
  boxSizing: 'border-box',
};

const selectStyle = {
  ...inputStyle,
  background: '#fff',
};

const sectionTitleStyle = {
  fontWeight: 700,
  fontSize: 15,
  color: TavariStyles.colors.gray800,
  margin: '0 0 12px',
};

const panelStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: 14,
  background: '#fff',
};

const btnSecondary = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
};

const btnPrimarySmall = {
  ...btnSecondary,
  border: 'none',
  background: TavariStyles.colors.primary || '#2563eb',
  color: '#fff',
};

function entryKey(entry, index) {
  return entry.id || `row-${index}`;
}

function GuestEntryFormFields({ draft, onChange, disabled = false, idPrefix = 'guest' }) {
  const isChild = draft.guest_type !== 'adult';

  const setDraft = (patch) => onChange({ ...draft, ...patch });

  const handleTypeChange = (guestType) => {
    if (guestType === 'adult') {
      onChange({
        ...draft,
        guest_type: 'adult',
        parent_last_name: '',
        is_birthday_child: false,
      });
      return;
    }
    onChange({ ...draft, guest_type: 'child' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: TavariStyles.colors.gray700 }}>
        Guest type
        <select
          style={{ ...selectStyle, marginTop: 6 }}
          value={draft.guest_type === 'adult' ? 'adult' : 'child'}
          disabled={disabled}
          onChange={(e) => handleTypeChange(e.target.value)}
        >
          <option value="child">Child</option>
          <option value="adult">Adult</option>
        </select>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }} className="party-guest-list-form-grid">
        <input
          style={inputStyle}
          placeholder="First name"
          value={draft.first_name || ''}
          disabled={disabled}
          onChange={(e) => setDraft({ first_name: e.target.value })}
        />
        <input
          style={inputStyle}
          placeholder="Last name"
          value={draft.last_name || ''}
          disabled={disabled}
          onChange={(e) => setDraft({ last_name: e.target.value })}
        />
        {isChild && (
          <input
            style={inputStyle}
            placeholder="Parent last name (if different)"
            value={draft.parent_last_name || ''}
            disabled={disabled}
            onChange={(e) => setDraft({ parent_last_name: e.target.value })}
          />
        )}
        <input
          style={inputStyle}
          placeholder="Phone (household)"
          value={formatPhoneDisplay(draft.household_phone || '')}
          disabled={disabled}
          onChange={(e) => setDraft({ household_phone: formatPhoneInput(e.target.value) })}
        />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        {isChild && (
          <TavariCheckbox
            id={`${idPrefix}-birthday-child`}
            checked={!!draft.is_birthday_child}
            disabled={disabled}
            onChange={(checked) => setDraft({ is_birthday_child: checked })}
            label="Birthday child"
            size="sm"
          />
        )}
        <TavariCheckbox
          id={`${idPrefix}-attending`}
          checked={draft.is_attending !== false}
          disabled={disabled}
          onChange={(checked) => setDraft({ is_attending: checked })}
          label="Attending party"
          size="sm"
        />
      </div>
    </div>
  );
}

const overLimitRowStyle = {
  background: '#fffbeb',
};

const overLimitNumberStyle = {
  fontWeight: 700,
  color: '#b45309',
};

const overLimitBadgeStyle = {
  display: 'inline-block',
  marginLeft: 8,
  fontSize: 11,
  fontWeight: 700,
  color: '#92400e',
  background: '#fde68a',
  padding: '2px 8px',
  borderRadius: 999,
};

const overLimitPriceStyle = {
  display: 'inline-block',
  marginLeft: 8,
  fontSize: 13,
  fontWeight: 700,
  color: '#b45309',
};

function GuestOveragePriceTag({ overagePrice }) {
  if (overagePrice == null) return null;
  return (
    <span style={overLimitPriceStyle}>
      +
      {formatPartyGuestMoney(overagePrice)}
    </span>
  );
}

function GuestListRowDisplay({
  entry,
  locked,
  onEdit,
  onRemove,
  layout = 'card',
  listNumber = null,
  isOverLimit = false,
  overagePrice = null,
}) {
  const waiver = waiverStatusStyle(entry.waiver_status);
  const name = formatGuestFullName(entry) || 'Unnamed guest';
  const phoneLabel = entry.household_phone ? formatPhoneDisplay(entry.household_phone) : null;
  const details = [
    phoneLabel,
    entry.is_attending === false ? 'Not attending' : null,
    entry.is_birthday_child ? 'Birthday child' : null,
    entry.source === 'walk_in' ? 'Walk-in' : null,
  ].filter(Boolean);

  if (layout === 'table') {
    return (
      <tr style={isOverLimit ? overLimitRowStyle : undefined}>
        <td style={{ padding: '10px 8px', borderBottom: '1px solid #e5e7eb', verticalAlign: 'top', width: 36, whiteSpace: 'nowrap' }}>
          {listNumber != null ? (
            <span style={isOverLimit ? overLimitNumberStyle : { fontWeight: 700, color: '#6b7280' }}>
              {listNumber}.
            </span>
          ) : '—'}
        </td>
        <td style={{ padding: '10px 8px', borderBottom: '1px solid #e5e7eb', verticalAlign: 'top' }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {name}
            {isOverLimit ? <span style={overLimitBadgeStyle}>Extra guest</span> : null}
            <GuestOveragePriceTag overagePrice={overagePrice} />
          </div>
          {details.length ? (
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{details.join(' · ')}</div>
          ) : null}
          {entry.parent_last_name ? (
            <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 2 }}>
              Parent last name: {entry.parent_last_name}
            </div>
          ) : null}
        </td>
        <td style={{ padding: '10px 8px', borderBottom: '1px solid #e5e7eb', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: waiver.color, background: waiver.bg, padding: '2px 8px', borderRadius: 999 }}>
            {waiver.label}
          </span>
        </td>
        {!locked && (
          <td style={{ padding: '10px 8px', borderBottom: '1px solid #e5e7eb', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onEdit} style={{ ...btnSecondary, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <FiEdit2 size={14} /> Edit
              </button>
              <button
                type="button"
                onClick={onRemove}
                style={{ ...btnSecondary, border: 'none', background: 'none', color: '#dc2626' }}
              >
                Remove
              </button>
            </div>
          </td>
        )}
      </tr>
    );
  }

  return (
    <div
      className={`party-guest-list-card${isOverLimit ? ' is-over-limit' : ''}`}
    >
      <div className="party-guest-list-card-header-row">
        {listNumber != null ? (
          <span className="party-guest-list-card-number">{listNumber}.</span>
        ) : null}
        <span className="party-guest-list-card-name">{name}</span>
      {isOverLimit ? (
        <span className="party-guest-list-card-extra-badge">Extra guest</span>
      ) : null}
      <GuestOveragePriceTag overagePrice={overagePrice} />
      </div>

      <div className="party-guest-list-card-meta-row">
        <span className="party-guest-list-card-meta-item">
          {entry.guest_type === 'child' ? 'Child' : 'Adult'}
        </span>
        {phoneLabel ? (
          <span className="party-guest-list-card-meta-item">{phoneLabel}</span>
        ) : null}
        {entry.waiver_status ? (
          <span
            className="party-guest-list-card-waiver"
            style={{ color: waiver.color, background: waiver.bg }}
          >
            {waiver.label}
          </span>
        ) : null}
      </div>

      {entry.is_attending === false || entry.is_birthday_child || entry.source === 'walk_in' || entry.parent_last_name ? (
        <div className="party-guest-list-card-secondary">
          {entry.is_attending === false ? <span>Not attending</span> : null}
          {entry.is_birthday_child ? <span>Birthday child</span> : null}
          {entry.source === 'walk_in' ? <span>Walk-in</span> : null}
          {entry.parent_last_name ? (
            <span>
              Parent last name:
              {' '}
              {entry.parent_last_name}
            </span>
          ) : null}
        </div>
      ) : null}

      {!locked && (
        <div className="party-guest-list-card-actions">
          <button type="button" onClick={onEdit} style={{ ...btnSecondary, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FiEdit2 size={14} /> Edit
          </button>
          <button
            type="button"
            onClick={onRemove}
            style={{ ...btnSecondary, border: 'none', background: 'none', color: '#dc2626' }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function GuestListTableSection({
  title,
  indexedEntries,
  entryDisplayMeta,
  locked,
  editingKey,
  editDraft,
  editError,
  persisting,
  onStartEdit,
  onRemove,
  onSaveEdit,
  onCancelEdit,
  onEditDraftChange,
}) {
  if (!indexedEntries.length) {
    return (
      <div style={{ marginBottom: 20 }}>
        <h4 style={{ ...sectionTitleStyle, fontSize: 14 }}>{title}</h4>
        <div style={{ color: '#6b7280', fontSize: 14 }}>None listed</div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <h4 style={{ ...sectionTitleStyle, fontSize: 14 }}>{title}</h4>
      <div className="party-guest-list-table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #d1d5db', fontSize: 13, width: 36 }}>#</th>
              <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #d1d5db', fontSize: 13 }}>Name</th>
              <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #d1d5db', fontSize: 13 }}>Waiver</th>
              {!locked ? (
                <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #d1d5db', fontSize: 13, width: 160 }}>Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {indexedEntries.map(({ entry, index }) => {
              const key = entryKey(entry, index);
              const isEditing = editingKey === key;
              const displayMeta = entryDisplayMeta?.get(index) || {
                listNumber: null,
                isOverLimit: false,
                overagePrice: null,
              };

              if (isEditing && editDraft) {
                return (
                  <tr key={key}>
                    <td colSpan={locked ? 3 : 4} style={{ padding: '12px 8px', borderBottom: '1px solid #e5e7eb' }}>
                      <div style={{ ...panelStyle, borderColor: TavariStyles.colors.primary || '#2563eb' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: TavariStyles.colors.gray700 }}>
                          Edit guest
                        </div>
                        <GuestEntryFormFields
                          draft={editDraft}
                          onChange={onEditDraftChange}
                          idPrefix={`edit-guest-${key}`}
                        />
                        {editError ? (
                          <div style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{editError}</div>
                        ) : null}
                        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                          <button type="button" onClick={() => onSaveEdit(index)} disabled={persisting} style={btnPrimarySmall}>
                            {persisting ? 'Saving…' : 'Save'}
                          </button>
                          <button type="button" onClick={onCancelEdit} style={btnSecondary}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <GuestListRowDisplay
                  key={key}
                  entry={entry}
                  locked={locked}
                  layout="table"
                  listNumber={displayMeta.listNumber}
                  isOverLimit={displayMeta.isOverLimit}
                  overagePrice={displayMeta.overagePrice}
                  onEdit={() => onStartEdit(entry, index)}
                  onRemove={() => onRemove(index)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="party-guest-list-mobile-stack">
        {indexedEntries.map(({ entry, index }) => {
          const key = entryKey(entry, index);
          const isEditing = editingKey === key;
          const displayMeta = entryDisplayMeta?.get(index) || { listNumber: null, isOverLimit: false };

          if (isEditing && editDraft) {
            return (
              <div key={key} className="party-guest-list-mobile-edit">
                <div style={{ ...panelStyle, borderColor: TavariStyles.colors.primary || '#2563eb', padding: 0, border: 'none' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: TavariStyles.colors.gray700 }}>
                    Edit guest
                  </div>
                  <GuestEntryFormFields
                    draft={editDraft}
                    onChange={onEditDraftChange}
                    idPrefix={`edit-guest-mobile-${key}`}
                  />
                  {editError ? (
                    <div style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{editError}</div>
                  ) : null}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button type="button" onClick={() => onSaveEdit(index)} disabled={persisting} style={btnPrimarySmall}>
                      {persisting ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" onClick={onCancelEdit} style={btnSecondary}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <GuestListRowDisplay
              key={key}
              entry={entry}
              locked={locked}
              layout="card"
              listNumber={displayMeta.listNumber}
              isOverLimit={displayMeta.isOverLimit}
              overagePrice={displayMeta.overagePrice}
              onEdit={() => onStartEdit(entry, index)}
              onRemove={() => onRemove(index)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function PartyGuestListStaffPrintView({ entries = [], title = 'Party Guest List', showWaiver = true }) {
  const { kids, adults } = splitEntriesForStaffView(entries);

  return (
    <div className="party-guest-print-root" style={{ fontFamily: 'Arial, sans-serif', color: '#111' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 20 }}>{title}</h2>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Kids:</div>
        {kids.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 14 }}>None listed</div>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {kids.map((entry, i) => (
              <li key={entry.id || i} style={{ marginBottom: 6 }}>
                {formatGuestFullName(entry)}
                {entry.parent_last_name ? ` (parent last: ${entry.parent_last_name})` : ''}
                {' '}({roleTagLabel(entry.role_tag || (entry.is_birthday_child ? 'birthday_child' : 'child'))})
                {entry.is_attending === false ? ' — not attending' : ''}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Adults:</div>
        {adults.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 14 }}>None listed</div>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {adults.map((entry, i) => (
              <li key={entry.id || i} style={{ marginBottom: 6 }}>
                {formatGuestFullName(entry)}
                {' '}({roleTagLabel(entry.role_tag || 'adult')})
                {entry.is_attending === false ? ' — not attending' : ''}
              </li>
            ))}
          </ol>
        )}
      </div>
      {showWaiver && (
        <div style={{ marginTop: 24, fontSize: 13, color: '#6b7280' }}>
          Waiver statuses are shown in the check-in screen — verify at the gate for each guest.
        </div>
      )}
    </div>
  );
}

export function PartyGuestListOverageOptions({
  overagePayment = '',
  overageFood = '',
  overageFoodOther = '',
  overageSocks = '',
  onOveragePaymentChange,
  onOverageFoodChange,
  onOverageFoodOtherChange,
  onOverageFoodOtherBlur,
  onOverageSocksChange,
  disabled = false,
}) {
  return (
    <div className="party-guest-list-overage-panel">
      <div className="party-guest-list-overage-panel-title">Extra guests beyond your package</div>
      <div className="party-guest-list-overage-options">
        <fieldset className="party-guest-list-overage-column" disabled={disabled}>
          <legend className="party-guest-list-overage-column-title">Admission</legend>
          {PARTY_GUEST_OVERAGE_PAYMENT_OPTIONS.map((option) => (
            <label key={option.value} className="party-guest-list-overage-option">
              <input
                type="radio"
                name="overage_payment"
                checked={overagePayment === option.value}
                onChange={() => onOveragePaymentChange?.(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="party-guest-list-overage-column" disabled={disabled}>
          <legend className="party-guest-list-overage-column-title">Additional food &amp; drinks</legend>
          {PARTY_GUEST_OVERAGE_FOOD_OPTIONS.map((option) => (
            <label key={option.value} className="party-guest-list-overage-option">
              <input
                type="radio"
                name="overage_food"
                checked={overageFood === option.value}
                onChange={() => onOverageFoodChange?.(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
          {overageFood === 'other' ? (
            <input
              type="text"
              className="party-guest-list-overage-other-input"
              value={overageFoodOther}
              onChange={(event) => onOverageFoodOtherChange?.(event.target.value)}
              onBlur={(event) => onOverageFoodOtherBlur?.(event.target.value)}
              placeholder="Please describe your request"
              disabled={disabled}
            />
          ) : null}
        </fieldset>
        <fieldset className="party-guest-list-overage-column" disabled={disabled}>
          <legend className="party-guest-list-overage-column-title">Socks</legend>
          {PARTY_GUEST_OVERAGE_SOCKS_OPTIONS.map((option) => (
            <label key={option.value} className="party-guest-list-overage-option">
              <input
                type="radio"
                name="overage_socks"
                checked={overageSocks === option.value}
                onChange={() => onOverageSocksChange?.(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </div>
  );
}

export function PartyGuestListOverageSummary({ entries, limitSettings, overagePricing, overagePayment }) {
  const resolvedOveragePayment = resolvePartyGuestOveragePayment(overagePayment);
  const summary = useMemo(
    () => computePartyGuestOverageSummary(entries, limitSettings, overagePricing),
    [entries, limitSettings, overagePricing],
  );

  if (!summary.hasOverage || !overagePricing?.hasPricing) return null;

  const parts = [];
  if (summary.extraChildCount > 0 && overagePricing.childPrice != null) {
    parts.push(`${summary.extraChildCount} child${summary.extraChildCount === 1 ? '' : 'ren'} × ${formatPartyGuestMoney(overagePricing.childPrice)}`);
  }
  if (summary.extraAdultCount > 0 && overagePricing.adultPrice != null) {
    parts.push(`${summary.extraAdultCount} adult${summary.extraAdultCount === 1 ? '' : 's'} × ${formatPartyGuestMoney(overagePricing.adultPrice)}`);
  }

  return (
    <div
      style={{
        background: '#f0fdf4',
        border: '1px solid #86efac',
        borderRadius: 10,
        padding: 14,
        marginBottom: 16,
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6, color: '#166534' }}>
        Estimated extra guest cost:
        {' '}
        {formatPartyGuestMoney(summary.total)}
      </div>
      {parts.length ? (
        <div style={{ color: '#15803d', marginBottom: 6 }}>
          {parts.join(' · ')}
        </div>
      ) : null}
      <div style={{ color: '#166534', fontSize: 13 }}>
        {resolvedOveragePayment === 'guest_at_gate'
          ? 'These guests will pay at the gate themselves.'
          : 'This amount will be added to your final party bill if you cover extra guests.'}
      </div>
    </div>
  );
}

export function PartyGuestListEntryEditor({
  entries,
  onChange,
  locked = false,
  onPersist,
  persisting = false,
  limitSettings = null,
  overagePricing = null,
  overagePayment = '',
}) {
  const [addDraft, setAddDraft] = useState(emptyGuestDraft);
  const [editingKey, setEditingKey] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [addError, setAddError] = useState('');
  const [editError, setEditError] = useState('');

  const entryDisplayMeta = useMemo(
    () => buildGuestListEntryDisplayMeta(entries, limitSettings, overagePricing),
    [entries, limitSettings, overagePricing],
  );

  const removeEntry = async (index) => {
    const key = entryKey(entries[index], index);
    if (editingKey === key) {
      setEditingKey(null);
      setEditDraft(null);
      setEditError('');
    }
    const nextEntries = entries.filter((_, i) => i !== index);
    onChange(nextEntries);
    await onPersist?.(nextEntries);
  };

  const startEdit = (entry, index) => {
    setEditingKey(entryKey(entry, index));
    setEditDraft({
      guest_type: entry.guest_type === 'adult' ? 'adult' : 'child',
      first_name: entry.first_name || '',
      last_name: entry.last_name || '',
      parent_last_name: entry.parent_last_name || '',
      household_phone: entry.household_phone || '',
      is_attending: entry.is_attending !== false,
      is_birthday_child: !!entry.is_birthday_child,
    });
    setEditError('');
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditDraft(null);
    setEditError('');
  };

  const handleAdd = async () => {
    const first = String(addDraft.first_name || '').trim();
    const last = String(addDraft.last_name || '').trim();
    if (!first || !last) {
      setAddError('First and last name are required.');
      return;
    }
    setAddError('');
    const nextEntries = [...entries, draftToGuestEntry(addDraft, entries.length)];
    onChange(nextEntries);
    setAddDraft(emptyGuestDraft());
    await onPersist?.(nextEntries);
  };

  const handleSaveEdit = async (index) => {
    const first = String(editDraft.first_name || '').trim();
    const last = String(editDraft.last_name || '').trim();
    if (!first || !last) {
      setEditError('First and last name are required.');
      return;
    }
    setEditError('');
    const updated = {
      ...draftToGuestEntry(editDraft, entries[index]?.sort_order ?? index),
      id: entries[index]?.id,
      source: entries[index]?.source,
      waiver_status: entries[index]?.waiver_status,
      role_tag: entries[index]?.role_tag,
      checked_in_at: entries[index]?.checked_in_at,
    };
    const nextEntries = entries.map((e, i) => (i === index ? updated : e));
    onChange(nextEntries);
    cancelEdit();
    await onPersist?.(nextEntries);
  };

  const indexedEntries = entries.map((entry, index) => ({ entry, index }));
  const childEntries = indexedEntries.filter(({ entry }) => entry.guest_type === 'child');
  const adultEntries = indexedEntries.filter(({ entry }) => entry.guest_type === 'adult');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {!locked && (
        <div>
          <h3 style={sectionTitleStyle}>Add guest</h3>
          <div style={panelStyle}>
            <GuestEntryFormFields
              draft={addDraft}
              onChange={setAddDraft}
              idPrefix="add-guest"
            />
            {addError ? (
              <div style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{addError}</div>
            ) : null}
            <button
              type="button"
              onClick={handleAdd}
              disabled={persisting}
              style={{ ...btnPrimarySmall, marginTop: 12, padding: '10px 16px', opacity: persisting ? 0.7 : 1 }}
            >
              {persisting ? 'Saving…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      <div>
        <h3 style={sectionTitleStyle}>Guest list</h3>
        <PartyGuestListOverageSummary
          entries={entries}
          limitSettings={limitSettings}
          overagePricing={overagePricing}
          overagePayment={overagePayment}
        />
        {entries.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 14, padding: '8px 0' }}>
            No guests added yet.
          </div>
        ) : (
          <div className="party-guest-list-editor-grid">
            <GuestListTableSection
              title="Children"
              indexedEntries={childEntries}
              entryDisplayMeta={entryDisplayMeta}
              locked={locked}
              editingKey={editingKey}
              editDraft={editDraft}
              editError={editError}
              persisting={persisting}
              onStartEdit={startEdit}
              onRemove={removeEntry}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={cancelEdit}
              onEditDraftChange={setEditDraft}
            />
            <GuestListTableSection
              title="Adults"
              indexedEntries={adultEntries}
              entryDisplayMeta={entryDisplayMeta}
              locked={locked}
              editingKey={editingKey}
              editDraft={editDraft}
              editError={editError}
              persisting={persisting}
              onStartEdit={startEdit}
              onRemove={removeEntry}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={cancelEdit}
              onEditDraftChange={setEditDraft}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function PartyGuestListWarnings({ warnings = [] }) {
  if (!warnings.length) return null;
  return (
    <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: 14, marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 8, color: '#92400e' }}>Please note</div>
      <ul style={{ margin: 0, paddingLeft: 18, color: '#92400e', fontSize: 14 }}>
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

export function PrintGuestListButton({ onPrint }) {
  return (
    <button
      type="button"
      onClick={onPrint}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid #d1d5db',
        background: '#fff',
        cursor: 'pointer',
        fontWeight: 600,
      }}
    >
      <FiPrinter size={16} /> Print list
    </button>
  );
}

export function CheckInEntryRow({ entry, onToggle, busy }) {
  const waiver = waiverStatusStyle(entry.waiver_status);
  const checked = !!entry.checked_in_at;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: checked ? '#ecfdf5' : '#fff',
      }}
    >
      <button
        type="button"
        disabled={busy}
        onClick={() => onToggle(!checked)}
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          border: checked ? '2px solid #10b981' : '2px solid #d1d5db',
          background: checked ? '#10b981' : '#fff',
          color: '#fff',
          cursor: busy ? 'wait' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <FiCheck /> : null}
      </button>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{formatGuestFullName(entry)}</div>
        <div style={{ fontSize: 13, color: '#6b7280' }}>
          {entry.guest_type === 'child' ? 'Child' : 'Adult'}
          {entry.is_attending === false ? ' · not attending' : ''}
        </div>
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: waiver.color }}>{waiver.label}</span>
    </div>
  );
}
