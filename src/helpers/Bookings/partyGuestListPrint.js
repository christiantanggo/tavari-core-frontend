import { formatDateShort } from '../../utils/businessDateFormat';
import { formatBookingResourceAssignments, formatBookingTimeRangeLabel } from '../../utils/bookingTimeRange';
import { formatGuestFullName, splitEntriesForStaffView, waiverStatusStyle } from '../../utils/partyGuestList';
import { getBirthdayChildName, getPartyHostName, openBookingPrintWindow } from './bookingPrint';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveBookingRecord(booking, guestList) {
  if (booking?.id || booking?.booking_date) return booking;
  return guestList?.bookings || null;
}

function resolveBirthdayChildName(booking, entries = []) {
  const fromBooking = getBirthdayChildName(booking);
  if (fromBooking) return fromBooking;
  const entry = (entries || []).find((row) => row.is_birthday_child);
  return entry ? formatGuestFullName(entry) : '';
}

function resolvePartyParentName(booking, guestList, entries = []) {
  const fromBooking = getPartyHostName(booking);
  if (fromBooking) return fromBooking;

  const adults = (entries || []).filter((row) => row.guest_type === 'adult');
  if (adults.length) return formatGuestFullName(adults[0]);

  const bookingRecord = resolveBookingRecord(booking, guestList);
  if (bookingRecord?.customer_name) return String(bookingRecord.customer_name).trim();

  return guestList?.booker_phone || '';
}

function resolveResourceAssignments(booking, guestList) {
  const bookingRecord = resolveBookingRecord(booking, guestList);
  return bookingRecord?.booking_resource_assignments
    || booking?.booking_resource_assignments
    || [];
}

export function buildResourceLabel(booking, guestList, resources = []) {
  if (guestList?.resource_label) return String(guestList.resource_label).trim();
  const assignments = resolveResourceAssignments(booking, guestList);
  if (!assignments.length) return 'Not assigned';
  const formatted = formatBookingResourceAssignments(assignments, resources);
  const names = formatted
    .map((row) => row.resourceName)
    .filter((name) => name && !String(name).match(/^[0-9a-f-]{36}$/i));
  return names.length ? [...new Set(names)].join(' + ') : 'Not assigned';
}

export function buildPartyGuestListPrintMeta({
  booking = null,
  guestList = null,
  entries = [],
  businessName = '',
  businessTimezone = null,
  resources = [],
} = {}) {
  const bookingRecord = resolveBookingRecord(booking, guestList);
  const activityName = booking?.booking_activities?.activity_name
    || bookingRecord?.booking_activities?.activity_name
    || 'Party';
  const partyDate = bookingRecord?.booking_date
    || guestList?.party_date
    || booking?.booking_date
    || '';
  const timeLabel = formatBookingTimeRangeLabel(bookingRecord || booking) || bookingRecord?.booking_time || '';

  return {
    businessName: String(businessName || '').trim(),
    activityName,
    partyDate: partyDate ? formatDateShort(partyDate, businessTimezone) : '',
    timeLabel,
    bookingNumber: bookingRecord?.booking_number || booking?.booking_number || '',
    partyParentName: resolvePartyParentName(booking, guestList, entries),
    birthdayChildName: resolveBirthdayChildName(booking, entries),
    resourceLabel: buildResourceLabel(booking, guestList, resources),
  };
}

function renderGuestTable(entries, emptyLabel) {
  if (!entries.length) {
    return `<div style="color:#6b7280;font-size: 14px;">${escapeHtml(emptyLabel)}</div>`;
  }
  const rows = entries.map((entry) => {
    const name = formatGuestFullName(entry) || 'Unnamed guest';
    const waiver = waiverStatusStyle(entry.waiver_status);
    const attending = entry.is_attending === false ? ' <span style="color:#9ca3af;font-size: 13px;">(not attending)</span>' : '';
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${escapeHtml(name)}${attending}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;color:${waiver.color};font-weight:600;white-space:nowrap;">${escapeHtml(waiver.label)}</td>
    </tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size: 15px;line-height:1.5;">
    <thead>
      <tr>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #d1d5db;font-size: 13px;">Name</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #d1d5db;font-size: 13px;">Waiver</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderNameList(entries, emptyLabel) {
  return renderGuestTable(entries, emptyLabel);
}

export function buildPartyGuestListPrintHtml({
  meta,
  entries = [],
}) {
  const { kids, adults } = splitEntriesForStaffView(entries);
  const title = [meta.activityName, meta.partyDate].filter(Boolean).join(' — ') || 'Party Guest List';

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { margin: 0.75in; }
      @media print {
        body { margin: 0; }
      }
    </style>
  </head>
  <body style="font-family: Arial, Helvetica, sans-serif; color: #111; padding: 24px; max-width: 820px; margin: 0 auto;">
    <header style="margin-bottom: 28px; border-bottom: 2px solid #111; padding-bottom: 16px;">
      ${meta.businessName ? `<div style="font-size: 13px; color: #6b7280; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.04em;">${escapeHtml(meta.businessName)}</div>` : ''}
      <h1 style="margin: 0 0 8px; font-size: 28px; font-weight: 700; line-height: 1.2; display:flex; justify-content:space-between; align-items:baseline; gap:16px;">
        <span style="font-size: 28px; font-weight: 700;">${escapeHtml(meta.activityName || 'Party Guest List')}</span>
        <span style="font-size: 28px; font-weight: 700; white-space:nowrap;">${escapeHtml(meta.partyDate || 'Date TBD')}</span>
      </h1>
      ${meta.timeLabel ? `<div style="font-size: 16px; color: #374151; margin-bottom: ${meta.bookingNumber ? '6px' : '14px'}; line-height: 1.25;">${escapeHtml(meta.timeLabel)}</div>` : (meta.bookingNumber ? '' : '<div style="margin-bottom: 14px;"></div>')}
      ${meta.bookingNumber ? `<div style="font-size: 16px; color: #374151; margin-bottom: 14px;">Booking #${escapeHtml(meta.bookingNumber)}</div>` : ''}
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; font-size: 15px; line-height: 1.45;">
        <div><strong>Party parent:</strong> ${escapeHtml(meta.partyParentName || '—')}</div>
        <div><strong>Birthday child:</strong> ${escapeHtml(meta.birthdayChildName || '—')}</div>
        <div style="grid-column: 1 / -1;"><strong>Resources:</strong> ${escapeHtml(meta.resourceLabel || 'Not assigned')}</div>
      </div>
    </header>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px; align-items: start;">
      <section>
        <h2 style="margin: 0 0 12px; font-size: 18px; border-bottom: 1px solid #d1d5db; padding-bottom: 6px;">Children</h2>
        ${renderNameList(kids, 'None listed')}
      </section>
      <section>
        <h2 style="margin: 0 0 12px; font-size: 18px; border-bottom: 1px solid #d1d5db; padding-bottom: 6px;">Adults</h2>
        ${renderNameList(adults, 'None listed')}
      </section>
    </div>

    <footer style="margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af;">
      Printed ${escapeHtml(new Date().toLocaleString())}
    </footer>
  </body>
</html>`;
}

export function printPartyGuestList({
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
  const html = buildPartyGuestListPrintHtml({ meta, entries });
  openBookingPrintWindow(html);
}
