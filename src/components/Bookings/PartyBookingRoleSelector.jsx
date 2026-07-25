import React, { useState } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import { partitionRosterForParty } from '../../utils/bookingPartySettings';
import BirthdateCalendarPicker from '../UI/BirthdateCalendarPicker';

const ADD_CHILD_VALUE = '__add_birthday_child__';

const emptyBirthdate = () => ({ year: '', month: '', day: '' });

const selectStyle = {
  width: '100%',
  padding: '10px 14px',
  border: `1px solid ${TavariStyles.colors.gray300}`,
  borderRadius: '8px',
  fontSize: '14px',
  backgroundColor: 'white',
};

const formatName = (participant) =>
  [participant?.first_name, participant?.last_name].filter(Boolean).join(' ').trim() || 'Unnamed';

const waiverBadge = (status) => {
  if (status === 'valid') {
    return <span style={{ color: '#10b981', fontWeight: 600, fontSize: 13 }}>Waiver complete</span>;
  }
  if (status === 'expired') {
    return <span style={{ color: '#f59e0b', fontWeight: 600, fontSize: 13 }}>Waiver expired</span>;
  }
  return <span style={{ color: '#ef4444', fontWeight: 600, fontSize: 13 }}>Waiver required</span>;
};

export default function PartyBookingRoleSelector({
  customerParticipants = [],
  hostParticipantId,
  birthdayChildParticipantId,
  requireBirthdayChild = true,
  onHostChange,
  onBirthdayChildChange,
  getParticipantWaiverStatus,
  onAddBirthdayChild,
  addingBirthdayChild = false,
}) {
  const { adults, minors } = partitionRosterForParty(customerParticipants);
  const [showAddChildForm, setShowAddChildForm] = useState(false);
  const [newChild, setNewChild] = useState({ firstName: '', lastName: '', birthdate: emptyBirthdate() });

  const resetAddChildForm = () => {
    setShowAddChildForm(false);
    setNewChild({ firstName: '', lastName: '', birthdate: emptyBirthdate() });
  };

  const handleBirthdayChildSelect = (value) => {
    if (value === ADD_CHILD_VALUE) {
      setShowAddChildForm(true);
      return;
    }
    resetAddChildForm();
    onBirthdayChildChange(value || null);
  };

  const handleSaveNewChild = async () => {
    if (!onAddBirthdayChild) return;
    const saved = await onAddBirthdayChild(newChild);
    if (saved) {
      resetAddChildForm();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div
        style={{
          padding: '14px 16px',
          borderRadius: 8,
          backgroundColor: '#eff6ff',
          border: '1px solid #bfdbfe',
          fontSize: 13,
          color: '#1e40af',
          lineHeight: 1.5,
        }}
      >
        You are booking <strong>one party space</strong>. Choose who this party is for — not every guest on your waiver
        needs to be selected. Additional guests can be linked at check-in.
      </div>

      <div>
        <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 14, color: TavariStyles.colors.gray900 }}>
          Party host (adult) *
        </label>
        <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginBottom: 10 }}>
          Supervising adult for this party.
        </p>
        <select
          value={hostParticipantId || ''}
          onChange={(e) => onHostChange(e.target.value || null)}
          style={selectStyle}
        >
          <option value="">Select adult…</option>
          {adults.map((participant) => (
            <option key={participant.id} value={participant.id}>
              {formatName(participant)}
            </option>
          ))}
        </select>
        {hostParticipantId && (
          <div style={{ marginTop: 8 }}>
            {waiverBadge(getParticipantWaiverStatus?.(customerParticipants.find((p) => p.id === hostParticipantId)))}
          </div>
        )}
        {adults.length === 0 && (
          <p style={{ marginTop: 8, fontSize: 13, color: TavariStyles.colors.gray600 }}>
            No adults found on your account. Add or complete your waiver profile first.
          </p>
        )}
      </div>

      {requireBirthdayChild && (
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 14, color: TavariStyles.colors.gray900 }}>
            Birthday child *
          </label>
          <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginBottom: 10 }}>
            The guest of honour for this party.
          </p>
          <select
            value={showAddChildForm ? '' : (birthdayChildParticipantId || '')}
            onChange={(e) => handleBirthdayChildSelect(e.target.value)}
            style={selectStyle}
          >
            <option value="">Select birthday child…</option>
            {minors.map((participant) => (
              <option key={participant.id} value={participant.id}>
                {formatName(participant)}
              </option>
            ))}
            {onAddBirthdayChild && (
              <option value={ADD_CHILD_VALUE}>+ Add a new child…</option>
            )}
          </select>
          {birthdayChildParticipantId && !showAddChildForm && (
            <div style={{ marginTop: 8 }}>
              {waiverBadge(getParticipantWaiverStatus?.(customerParticipants.find((p) => p.id === birthdayChildParticipantId)))}
            </div>
          )}
          {minors.length === 0 && !showAddChildForm && (
            <p style={{ marginTop: 8, fontSize: 13, color: TavariStyles.colors.gray600 }}>
              No children on your account yet. Choose &ldquo;+ Add a new child&rdquo; above to add the birthday child.
            </p>
          )}

          {showAddChildForm && onAddBirthdayChild && (
            <div
              style={{
                marginTop: 12,
                padding: 16,
                borderRadius: 8,
                border: `1px solid ${TavariStyles.colors.gray200}`,
                backgroundColor: TavariStyles.colors.gray50,
              }}
            >
              <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: TavariStyles.colors.gray900 }}>
                Add birthday child
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600, color: TavariStyles.colors.gray700 }}>
                    First name *
                  </label>
                  <input
                    type="text"
                    value={newChild.firstName}
                    onChange={(e) => setNewChild((prev) => ({ ...prev, firstName: e.target.value }))}
                    placeholder="First name"
                    style={selectStyle}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600, color: TavariStyles.colors.gray700 }}>
                    Last name *
                  </label>
                  <input
                    type="text"
                    value={newChild.lastName}
                    onChange={(e) => setNewChild((prev) => ({ ...prev, lastName: e.target.value }))}
                    placeholder="Last name"
                    style={selectStyle}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600, color: TavariStyles.colors.gray700 }}>
                    Birthdate *
                  </label>
                  <BirthdateCalendarPicker
                    value={newChild.birthdate}
                    onChange={(birthdate) => setNewChild((prev) => ({ ...prev, birthdate }))}
                    yearRangeBack={18}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={handleSaveNewChild}
                    disabled={addingBirthdayChild}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: 'none',
                      backgroundColor: TavariStyles.colors.primary,
                      color: 'white',
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: addingBirthdayChild ? 'wait' : 'pointer',
                      opacity: addingBirthdayChild ? 0.7 : 1,
                    }}
                  >
                    {addingBirthdayChild ? 'Saving…' : 'Add child'}
                  </button>
                  <button
                    type="button"
                    onClick={resetAddChildForm}
                    disabled={addingBirthdayChild}
                    style={{
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: `1px solid ${TavariStyles.colors.gray300}`,
                      backgroundColor: 'white',
                      color: TavariStyles.colors.gray700,
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: addingBirthdayChild ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!requireBirthdayChild && (
        <div style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
          This activity is configured for adult parties — only the host is required.
        </div>
      )}
    </div>
  );
}
