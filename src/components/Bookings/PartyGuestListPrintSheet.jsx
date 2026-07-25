import React from 'react';
import { buildPartyGuestListPrintMeta } from '../../helpers/Bookings/partyGuestListPrint';
import { formatGuestFullName, splitEntriesForStaffView, waiverStatusStyle } from '../../utils/partyGuestList';

export default function PartyGuestListPrintSheet({
  booking = null,
  guestList = null,
  entries = [],
  businessName = '',
  businessTimezone = null,
  resources = [],
}) {
  const meta = buildPartyGuestListPrintMeta({
    booking,
    guestList,
    entries,
    businessName,
    businessTimezone,
    resources,
  });
  const { kids, adults } = splitEntriesForStaffView(entries);

  const renderList = (list, emptyLabel) => {
    if (!list.length) {
      return <div style={{ color: '#6b7280', fontSize: 14 }}>{emptyLabel}</div>;
    }
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15, lineHeight: 1.5 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #d1d5db', fontSize: 13 }}>Name</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #d1d5db', fontSize: 13 }}>Waiver</th>
          </tr>
        </thead>
        <tbody>
          {list.map((entry, index) => {
            const waiver = waiverStatusStyle(entry.waiver_status);
            return (
              <tr key={entry.id || index}>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb', verticalAlign: 'top' }}>
                  {formatGuestFullName(entry) || 'Unnamed guest'}
                  {entry.is_attending === false ? (
                    <span style={{ color: '#9ca3af', fontSize: 13 }}> (not attending)</span>
                  ) : null}
                </td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb', verticalAlign: 'top', color: waiver.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {waiver.label}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div className="party-guest-print-root" style={{ fontFamily: 'Arial, sans-serif', color: '#111', maxWidth: 820 }}>
      <header style={{ marginBottom: 28, borderBottom: '2px solid #111', paddingBottom: 16 }}>
        {meta.businessName ? (
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {meta.businessName}
          </div>
        ) : null}
        <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 700, lineHeight: 1.2, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
          <span style={{ fontSize: 28, fontWeight: 700 }}>{meta.activityName || 'Party Guest List'}</span>
          <span style={{ fontSize: 28, fontWeight: 700, whiteSpace: 'nowrap' }}>{meta.partyDate || 'Date TBD'}</span>
        </h1>
        {meta.timeLabel ? (
          <div style={{ fontSize: 16, color: '#374151', marginBottom: meta.bookingNumber ? 6 : 14, lineHeight: 1.25 }}>
            {meta.timeLabel}
          </div>
        ) : null}
        {meta.bookingNumber ? (
          <div style={{ fontSize: 16, color: '#374151', marginBottom: 14 }}>
            Booking #{meta.bookingNumber}
          </div>
        ) : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 15, lineHeight: 1.45 }}>
          <div><strong>Party parent:</strong> {meta.partyParentName || '—'}</div>
          <div><strong>Birthday child:</strong> {meta.birthdayChildName || '—'}</div>
          <div style={{ gridColumn: '1 / -1' }}><strong>Resources:</strong> {meta.resourceLabel || 'Not assigned'}</div>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, alignItems: 'start' }}>
        <section>
          <h2 style={{ margin: '0 0 12px', fontSize: 18, borderBottom: '1px solid #d1d5db', paddingBottom: 6 }}>Children</h2>
          {renderList(kids, 'None listed')}
        </section>
        <section>
          <h2 style={{ margin: '0 0 12px', fontSize: 18, borderBottom: '1px solid #d1d5db', paddingBottom: 6 }}>Adults</h2>
          {renderList(adults, 'None listed')}
        </section>
      </div>
    </div>
  );
}
