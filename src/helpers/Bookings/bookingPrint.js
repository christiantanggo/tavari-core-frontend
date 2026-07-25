import { parsePortalActivityOptions, resolvePortalOptionListPrice } from '../../utils/bookingActivityOptions';
import { formatBookingMoney } from '../../utils/bookingPricing';
import { formatDateTimeForBusiness, formatDateWithWeekday } from '../../utils/businessDateFormat';
import { formatPhoneDisplay } from '../../utils/phoneFormat';
import { formatBookingTimeRangeLabel } from '../../utils/bookingTimeRange';
import {
  formatGuestFullName,
  formatPartyGuestOverageFood,
  formatPartyGuestOveragePayment,
  formatPartyGuestOverageSocks,
  roleTagLabel,
  splitEntriesForStaffView,
} from '../../utils/partyGuestList';
import { groupBundleItemsByBundleId } from '../../utils/posInventoryBundles';
import {
  buildBookingSelectedOptionsView,
  buildPortalOptionSelectionsFromBooking,
  extractPortalOptionIdFromAddon,
} from './bookingOptionsDisplay';
import {
  getBookingAdultDisplayName,
  getParticipantDisplayName,
} from './participantIdentity';

function shortPortalOptionPrintName(option = {}, inventoryItem = null) {
  const inventoryName = String(inventoryItem?.name || '').trim();
  if (inventoryName) return inventoryName;

  const raw = String(option?.name || '').trim();
  if (!raw) return 'Option';
  const parenIndex = raw.indexOf(' (');
  if (parenIndex > 0) return raw.slice(0, parenIndex).trim() || raw;
  return raw;
}

/** Pizza bundles are recipes (base + toppings). Kitchen just needs the pizza name. */
function isPizzaRecipeBundle(option = {}, inventoryItem = null) {
  const label = `${inventoryItem?.name || ''} ${option?.name || ''}`.toLowerCase();
  return label.includes('pizza');
}

function resolvePrintBundleComponents(option = {}, inventoryById, bundleItemsByBundleId) {
  const inventoryId = String(option?.inventory_item_id || '').trim();
  if (!inventoryId) return [];

  const inventoryItem = inventoryById.get(inventoryId) || null;
  if (!inventoryItem?.is_bundle) return [];
  // Keep Food Option / platter packages stacked; do not explode pizza into toppings.
  if (isPizzaRecipeBundle(option, inventoryItem)) return [];

  const rows = bundleItemsByBundleId.get(inventoryId) || [];
  return rows
    .map((row) => {
      const component = row?.component || row?.pos_inventory || null;
      const name = String(component?.name || '').trim();
      if (!name) return null;
      return {
        name,
        quantity: Math.max(1, Number.parseInt(row?.quantity, 10) || 1),
      };
    })
    .filter(Boolean);
}

export const BOOKING_PRINT_SECTIONS = [
  {
    id: 'party_overview',
    label: 'Party overview',
    description: 'Activity, date, time, booking #, parent, birthday child, rooms, contact, and payment status.',
  },
  {
    id: 'food_options',
    label: 'Food & activity options',
    description: 'Included food, party host, mascot, and additional food in two columns.',
  },
  {
    id: 'notes',
    label: 'Notes',
    description: 'Staff notes saved on this booking (allergies, special requests, etc.).',
  },
  {
    id: 'participants',
    label: 'Party participants (attending)',
    description: 'People linked to this booking who are attending.',
  },
  {
    id: 'guest_list',
    label: 'Guest list',
    description: 'Full party guest list for check-in.',
  },
  {
    id: 'payment_summary',
    label: 'Payment summary',
    description: 'Subtotal, taxes, and total.',
  },
];

export const DEFAULT_BOOKING_PRINT_SECTIONS = Object.fromEntries(
  BOOKING_PRINT_SECTIONS.map((section) => [section.id, true]),
);

const PRINT_SECTIONS_STORAGE_PREFIX = 'tavari_booking_print_sections_';

export function loadSavedPrintSectionPreferences(businessId) {
  if (!businessId || typeof window === 'undefined') return { ...DEFAULT_BOOKING_PRINT_SECTIONS };
  try {
    const raw = window.localStorage.getItem(`${PRINT_SECTIONS_STORAGE_PREFIX}${businessId}`);
    if (!raw) return { ...DEFAULT_BOOKING_PRINT_SECTIONS };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_BOOKING_PRINT_SECTIONS };
    BOOKING_PRINT_SECTIONS.forEach((section) => {
      if (typeof parsed[section.id] === 'boolean') {
        merged[section.id] = parsed[section.id];
      }
    });
    return merged;
  } catch {
    return { ...DEFAULT_BOOKING_PRINT_SECTIONS };
  }
}

export function savePrintSectionPreferences(businessId, sections) {
  if (!businessId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${PRINT_SECTIONS_STORAGE_PREFIX}${businessId}`,
      JSON.stringify(sections),
    );
  } catch {
    // ignore storage errors
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getPartyHostName(booking) {
  const parts = booking?.booking_participants || [];
  const host = parts.find((participant) => participant.party_role === 'host_adult');
  if (host) return getParticipantDisplayName(host, 0);
  return getBookingAdultDisplayName(booking);
}

export function getBirthdayChildName(booking) {
  const parts = booking?.booking_participants || [];
  const child = parts.find((participant) => participant.party_role === 'birthday_child');
  if (!child) return '';
  return getParticipantDisplayName(child, 0);
}

/** All configured portal option groups with every option (qty blank when not ordered). */
export function buildBookingPrintOptionsCatalog(booking, { inventoryItems = [], bundleContext = {} } = {}) {
  const activity = booking?.booking_activities || {};
  const config = parsePortalActivityOptions(activity.addon_settings);
  const selections = buildPortalOptionSelectionsFromBooking(booking);
  // Includes portal-* keys and legacy/Bookeo lines matched by option name.
  const selectedView = buildBookingSelectedOptionsView(booking);
  const selectedByOptionId = new Map();
  for (const group of selectedView.groups || []) {
    for (const option of group.options || []) {
      if (option?.optionId) selectedByOptionId.set(option.optionId, option);
    }
  }

  const inventoryById = new Map(
    (inventoryItems || []).filter((item) => item?.id).map((item) => [item.id, item]),
  );
  const bundleItemsByBundleId =
    bundleContext.bundleItemsByBundleId instanceof Map
      ? bundleContext.bundleItemsByBundleId
      : groupBundleItemsByBundleId(bundleContext.bundleRows || []);

  const linePricesByOptionId = {};

  for (const line of booking?.booking_addon_items || []) {
    const optionId = extractPortalOptionIdFromAddon(line.booking_addons || {}, booking?.id || null);
    if (!optionId) continue;
    const unitPrice = Number(line.unit_price) || Number(line.booking_addons?.price) || 0;
    if (unitPrice > 0 || !(optionId in linePricesByOptionId)) {
      linePricesByOptionId[optionId] = unitPrice;
    }
  }

  for (const [optionId, selected] of selectedByOptionId) {
    const unitPrice = Number(selected?.unitPrice) || 0;
    if (unitPrice > 0 || !(optionId in linePricesByOptionId)) {
      linePricesByOptionId[optionId] = unitPrice;
    }
  }

  const groups = [...(config.groups || [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((group) => ({
      id: group.id,
      // Group/option descriptions are customer-facing online only — never on the print sheet.
      name: group.name || 'Options',
      options: [...(group.options || [])]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .filter((option) => String(option?.name || '').trim() || option?.inventory_item_id)
        .map((option) => {
          const selected = selectedByOptionId.get(option.id);
          // Portal keys first; fall back to name-matched legacy/Bookeo addon lines.
          const quantity = Math.max(
            0,
            Number.parseInt(selections[option.id], 10) || 0,
            Number.parseInt(selected?.quantity, 10) || 0,
          );
          let listPrice = resolvePortalOptionListPrice(group, option, {});
          if (listPrice === 0 && linePricesByOptionId[option.id] != null) {
            listPrice = linePricesByOptionId[option.id];
          }
          const inventoryItem = option.inventory_item_id
            ? inventoryById.get(option.inventory_item_id)
            : null;
          const components = resolvePrintBundleComponents(
            option,
            inventoryById,
            bundleItemsByBundleId,
          );
          return {
            id: option.id,
            name: shortPortalOptionPrintName(option, inventoryItem),
            quantity,
            included: option.included === true,
            listPrice,
            // Only fill component qtys when this package was ordered — otherwise staff
            // think every listed recipe needs to be cooked.
            components: components.map((component) => ({
              name: component.name,
              quantity: quantity > 0 ? component.quantity * quantity : 0,
            })),
          };
        }),
    }))
    .filter((group) => group.options.length > 0);

  return {
    groups,
    additionalItems: selectedView.additionalItems || [],
  };
}

/** Itemized pretax charge lines for the print payment summary. */
export function buildBookingPrintChargeLines(booking, pricing) {
  const lines = [];
  let addonPretaxSum = 0;

  for (const item of booking?.booking_addon_items || []) {
    const quantity = Math.max(0, Number.parseInt(item.quantity, 10) || 0);
    const unitPrice = Number(item.unit_price) || Number(item.booking_addons?.price) || 0;
    const totalPrice = Number.isFinite(Number(item.total_price))
      ? Number(item.total_price)
      : Math.round(quantity * unitPrice * 100) / 100;

    addonPretaxSum += totalPrice;
    if (totalPrice <= 0) continue;

    const label = String(item.booking_addons?.addon_name || '').trim() || 'Add-on';
    const detail = quantity > 1 ? `${quantity} × ${formatBookingMoney(unitPrice)}` : null;
    lines.push({ label, detail, amount: totalPrice });
  }

  for (const extension of booking?.booking_time_extensions || []) {
    if (extension.extension_type !== 'paid') continue;
    const amount = Number(extension.amount_charged) || 0;
    if (amount <= 0) continue;

    const minutes = Number.parseInt(extension.added_minutes, 10) || 0;
    const label = minutes > 0 ? `Time extension (+${minutes} min)` : 'Time extension';
    const alreadyListed = lines.some((line) => line.label === label && line.amount === amount);
    if (alreadyListed) continue;

    const billedViaAddon = (booking?.booking_addon_items || []).some((item) => {
      const name = String(item?.booking_addons?.addon_name || '');
      return name.startsWith('Time extension') && (Number(item.total_price) || 0) >= amount;
    });
    if (billedViaAddon) continue;

    lines.push({ label, detail: null, amount });
    addonPretaxSum += amount;
  }

  const subtotal = Number(pricing?.subtotal) || 0;
  const baseAmount = Math.round((subtotal - addonPretaxSum) * 100) / 100;

  if (baseAmount > 0) {
    const activityName = booking?.booking_activities?.activity_name || 'Booking';
    lines.unshift({
      label: activityName,
      detail: null,
      amount: baseAmount,
    });
  }

  return lines;
}

function formatBookingPrintPaymentMethod(method) {
  if (method === 'helcim_card_on_file') return 'Helcim card on file';
  if (method === 'helcim') return 'Helcim';
  if (method === 'manual') return 'Manual payment';
  if (!method) return 'Payment';
  return String(method).replace(/_/g, ' ');
}

function renderSectionHeading(title) {
  return `<h2 style="margin:12px 0 8px;font-size: 16px;border-bottom:1px solid #111;padding-bottom:4px;">${escapeHtml(title)}</h2>`;
}

function renderLabelValue(label, value) {
  return `<div style="margin-bottom:4px;font-size: 14px;line-height:1.4;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value || '—')}</div>`;
}

function buildPartyOverviewSection({
  booking,
  businessTimezone,
  resourceLabel,
  partyHostName,
  birthdayChildName,
  pricing,
  guestList,
}) {
  const activityName = booking?.booking_activities?.activity_name || 'Party';
  const dateLabel = formatDateWithWeekday(booking?.booking_date, businessTimezone);
  const timeLabel = formatBookingTimeRangeLabel(booking) || booking?.booking_time || '';
  const paidLabel = formatBookingMoney(pricing?.totalPaid ?? 0);
  const balanceLabel = formatBookingMoney(pricing?.totalDue ?? 0);
  const extraGuestAdmission = formatPartyGuestOveragePayment(guestList?.overage_payment);
  const extraGuestFood = formatPartyGuestOverageFood(guestList);
  const extraGuestSocks = formatPartyGuestOverageSocks(guestList?.overage_socks);

  return `
    ${renderSectionHeading('Party overview')}
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:8px;font-size: 20px;font-weight:700;line-height:1.25;">
      <span>${escapeHtml(activityName)}</span>
      <span style="white-space:nowrap;">${escapeHtml(dateLabel || '—')}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;font-size: 14px;line-height:1.4;">
      ${renderLabelValue('Time', timeLabel)}
      ${renderLabelValue('Booking #', booking?.booking_number || booking?.id)}
      ${renderLabelValue('Party parent', partyHostName)}
      ${renderLabelValue('Birthday child', birthdayChildName)}
      ${renderLabelValue('Resources', resourceLabel || 'Not assigned')}
      ${renderLabelValue('Status', booking?.status)}
      ${renderLabelValue('Customer email', booking?.customer_email)}
      ${renderLabelValue('Customer phone', formatPhoneDisplay(booking?.customer_phone) || booking?.customer_phone)}
      ${renderLabelValue('Payment status', booking?.payment_status)}
      <div style="margin-bottom:4px;font-size: 14px;line-height:1.4;">
        <strong>Paid:</strong> ${escapeHtml(paidLabel)} · <strong>Balance:</strong> ${escapeHtml(balanceLabel)}
      </div>
      ${renderLabelValue('Extra guest admission', extraGuestAdmission)}
      ${renderLabelValue('Additional food & drinks', extraGuestFood)}
      ${renderLabelValue('Socks if forgotten', extraGuestSocks)}
    </div>
  `;
}

function isBalloonOptionsGroup(group = {}) {
  return /balloon/i.test(String(group?.name || '').trim());
}

function findPrintOptionGroup(groups, pattern) {
  return (groups || []).find((group) => pattern.test(String(group?.name || '').trim())) || null;
}

function printOptionGroupDisplayName(group = {}) {
  const name = String(group?.name || '').trim();
  if (/included\s*food/i.test(name)) return 'Included food';
  if (/additional\s*food/i.test(name)) return 'Additional food';
  if (/party\s*host/i.test(name)) return 'Party Host';
  if (/mascot/i.test(name)) return 'Mascot';
  return name || 'Options';
}

/** Page-1 food columns: Included food → Party Host → Mascot | Additional food */
function splitFoodOptionsForPrintColumns(groups = []) {
  const pageOneGroups = groups.filter((group) => !isBalloonOptionsGroup(group));
  const included = findPrintOptionGroup(pageOneGroups, /included\s*food/i);
  const partyHost = findPrintOptionGroup(pageOneGroups, /party\s*host/i);
  const mascot = findPrintOptionGroup(pageOneGroups, /mascot/i);
  const additional = findPrintOptionGroup(pageOneGroups, /additional\s*food/i);
  const claimedIds = new Set(
    [included, partyHost, mascot, additional].filter(Boolean).map((group) => group.id),
  );
  const leftover = pageOneGroups.filter((group) => !claimedIds.has(group.id));

  return {
    column1: [included, partyHost, mascot, ...leftover].filter(Boolean),
    column2: [additional].filter(Boolean),
  };
}

function buildFoodOptionsSection({ optionsCatalog }) {
  const { groups = [], additionalItems = [] } = optionsCatalog || {};

  if (!groups.length && !additionalItems.length) {
    return `
      ${renderSectionHeading('Food & activity options')}
      <p style="color:#6b7280;font-size: 13px;margin:0;">No activity options configured for this booking.</p>
    `;
  }

  const renderQtyCell = (quantity, { emphasize = false } = {}) => {
    if (quantity > 0) {
      const size = emphasize ? '10px' : '9px';
      return `<strong style="font-size:${size};">${quantity}</strong>`;
    }
    return '<span style="display:inline-block;min-width:18px;border-bottom:1px solid #9ca3af;">&nbsp;</span>';
  };

  const renderOptionRows = (options) => {
    const header = `
      <div style="display:grid;grid-template-columns:30px 1fr 48px;background:#f9fafb;border:1px solid #d1d5db;border-bottom:none;font-size: 11px;font-weight:600;">
        <div style="padding:3px 3px;text-align:center;border-right:1px solid #d1d5db;">Qty</div>
        <div style="padding:3px 4px;border-right:1px solid #d1d5db;">Item</div>
        <div style="padding:3px 3px;text-align:right;">Price</div>
      </div>
    `;

    const rows = options.map((option) => {
      const includedNote = option.included ? ' <span style="color:#6b7280;font-size: 10px;">(inc.)</span>' : '';
      const priceLabel = formatBookingMoney(option.listPrice ?? 0);
      const components = Array.isArray(option.components) ? option.components : [];
      const packageRow = `
        <div style="display:grid;grid-template-columns:30px 1fr 48px;border:1px solid #d1d5db;border-top:none;break-inside:avoid;page-break-inside:avoid;font-size: 11px;line-height:1.3;">
          <div style="padding:2px 3px;text-align:center;border-right:1px solid #d1d5db;vertical-align:top;">${renderQtyCell(option.quantity, { emphasize: true })}</div>
          <div style="padding:2px 4px;border-right:1px solid #d1d5db;font-weight:${components.length ? '600' : '400'};">${escapeHtml(option.name)}${includedNote}</div>
          <div style="padding:2px 3px;text-align:right;white-space:nowrap;">${escapeHtml(priceLabel)}</div>
        </div>
      `;

      if (!components.length) return packageRow;

      const componentRows = components.map((component) => `
        <div style="display:grid;grid-template-columns:30px 1fr 48px;border:1px solid #d1d5db;border-top:none;break-inside:avoid;page-break-inside:avoid;font-size: 11px;line-height:1.25;background:#fcfcfd;">
          <div style="padding:2px 3px;text-align:center;border-right:1px solid #d1d5db;vertical-align:top;">${renderQtyCell(component.quantity)}</div>
          <div style="padding:2px 4px 2px 10px;border-right:1px solid #d1d5db;color:#374151;">${escapeHtml(component.name)}</div>
          <div style="padding:2px 3px;text-align:right;color:#9ca3af;">—</div>
        </div>
      `).join('');

      return `${packageRow}${componentRows}`;
    }).join('');

    return `${header}${rows}`;
  };

  const renderGroupBlock = (group) => `
    <div style="margin-bottom:8px;break-inside:avoid;page-break-inside:avoid;">
      <div style="font-weight:700;font-size: 14px;margin-bottom:3px;line-height:1.25;break-after:avoid;page-break-after:avoid;">${escapeHtml(printOptionGroupDisplayName(group))}</div>
      ${renderOptionRows(group.options)}
    </div>
  `;

  const { column1, column2 } = splitFoodOptionsForPrintColumns(groups);
  const balloonGroups = groups.filter((group) => isBalloonOptionsGroup(group));
  const balloonOptions = balloonGroups.flatMap((group) => group.options || []);
  const balloonSplitIndex = Math.ceil(balloonOptions.length / 2);
  const balloonLeftOptions = balloonOptions.slice(0, balloonSplitIndex);
  const balloonRightOptions = balloonOptions.slice(balloonSplitIndex);

  const column2Blocks = [
    ...column2.map(renderGroupBlock),
    additionalItems.length
      ? `
      <div style="margin-bottom:8px;break-inside:avoid;page-break-inside:avoid;">
        <div style="font-weight:700;font-size: 14px;margin-bottom:3px;break-after:avoid;page-break-after:avoid;">Additional items</div>
        ${renderOptionRows(additionalItems.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          included: false,
          listPrice: item.unitPrice ?? 0,
          components: [],
        })))}
      </div>
    `
      : '',
  ].join('');

  const balloonsPageHtml = balloonOptions.length
    ? `
      <div style="break-before:page;page-break-before:always;margin-top:0;">
        <div style="font-weight:700;font-size: 16px;margin:0 0 6px;padding-bottom:3px;border-bottom:1px solid #111;">Balloons</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start;font-size: 11px;">
          <div>${renderOptionRows(balloonLeftOptions)}</div>
          <div>${balloonRightOptions.length ? renderOptionRows(balloonRightOptions) : ''}</div>
        </div>
      </div>
    `
    : '';

  return `
    ${renderSectionHeading('Food & activity options')}
    <p style="font-size: 11px;color:#6b7280;margin:0 0 6px;line-height:1.35;">Quantities show what was ordered; blank qty lines can be filled in if the order changes.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start;break-inside:avoid;page-break-inside:avoid;font-size: 11px;">
      <div data-print-food-col="1">${column1.map(renderGroupBlock).join('')}</div>
      <div data-print-food-col="2">${column2Blocks}</div>
    </div>
    ${balloonsPageHtml}
  `;
}

function buildNotesSection({
  bookingNotes = [],
  bookingNotesLegacy = '',
  businessTimezone,
}) {
  const items = [];
  const legacy = String(bookingNotesLegacy || '').trim();
  if (legacy) {
    items.push({ text: legacy, meta: null });
  }

  const chronological = [...(bookingNotes || [])].sort((a, b) => {
    const aTime = new Date(a?.created_at || 0).getTime();
    const bTime = new Date(b?.created_at || 0).getTime();
    return aTime - bTime;
  });

  for (const note of chronological) {
    const text = String(note?.note_text || '').trim();
    if (!text) continue;
    const meta = note?.created_at
      ? formatDateTimeForBusiness(note.created_at, businessTimezone)
      : null;
    items.push({ text, meta });
  }

  if (!items.length) {
    return `
      ${renderSectionHeading('Notes')}
      <p style="color:#6b7280;font-size: 14px;margin:0;">No notes on this booking.</p>
    `;
  }

  const rows = items.map((item) => {
    const metaHtml = item.meta
      ? `<div style="font-size: 11px;color:#6b7280;margin-bottom:2px;">${escapeHtml(item.meta)}</div>`
      : '';
    return `
      <div style="margin-bottom:8px;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;break-inside:avoid;page-break-inside:avoid;">
        ${metaHtml}
        <div style="font-size: 14px;line-height:1.45;white-space:pre-wrap;">${escapeHtml(item.text)}</div>
      </div>
    `;
  }).join('');

  return `
    ${renderSectionHeading('Notes')}
    ${rows}
  `;
}

function buildParticipantsSection({ participants = [] }) {
  if (!participants.length) {
    return `
      ${renderSectionHeading('Party participants')}
      <p style="color:#6b7280;font-size: 18px;margin:0;">No participants on this booking.</p>
    `;
  }

  const rows = participants.map((participant, index) => {
    const name = getParticipantDisplayName(participant, index);
    const role = participant.party_role === 'birthday_child'
      ? 'Birthday child'
      : participant.party_role === 'host_adult'
        ? 'Party host'
        : participant.is_minor
          ? 'Minor'
          : 'Guest';
    return `<li style="margin-bottom:6px;">${escapeHtml(name)} <span style="color:#6b7280;">(${escapeHtml(role)})</span></li>`;
  }).join('');

  return `
    ${renderSectionHeading('Party participants (attending)')}
    <ol style="margin:0;padding-left:20px;font-size: 18px;">${rows}</ol>
  `;
}

function buildGuestListSection({ guestListEntries = [] }) {
  const { kids, adults } = splitEntriesForStaffView(guestListEntries);

  const renderList = (entries, emptyLabel) => {
    if (!entries.length) {
      return `<div style="color:#6b7280;font-size: 18px;margin-bottom:12px;">${escapeHtml(emptyLabel)}</div>`;
    }
    return `<ol style="margin:0 0 16px;padding-left:20px;font-size: 18px;">${
      entries.map((entry, index) => {
        const name = formatGuestFullName(entry);
        const role = roleTagLabel(entry.role_tag || (entry.is_birthday_child ? 'birthday_child' : entry.guest_type === 'adult' ? 'adult' : 'child'));
        const attending = entry.is_attending === false ? ' — not attending' : '';
        const parent = entry.parent_last_name ? ` (parent last: ${entry.parent_last_name})` : '';
        return `<li style="margin-bottom:6px;">${escapeHtml(name)}${escapeHtml(parent)} (${escapeHtml(role)})${escapeHtml(attending)}</li>`;
      }).join('')
    }</ol>`;
  };

  return `
    ${renderSectionHeading('Guest list')}
    <div style="font-weight:700;margin-bottom:8px;">Kids</div>
    ${renderList(kids, 'None listed')}
    <div style="font-weight:700;margin-bottom:8px;">Adults</div>
    ${renderList(adults, 'None listed')}
  `;
}

function buildPaymentSection({ booking, pricing }) {
  if (!pricing) return '';

  const chargeLines = buildBookingPrintChargeLines(booking, pricing);
  const totalPrice = Number(pricing.totalPrice ?? pricing.total) || 0;
  const totalPaid = Number(pricing.totalPaid) || 0;
  const balanceDue = Number.isFinite(Number(pricing.totalDue))
    ? Number(pricing.totalDue)
    : Math.max(0, Math.round((totalPrice - totalPaid) * 100) / 100);

  const completedPayments = (booking?.booking_payments || [])
    .filter((payment) => payment.status === 'completed')
    .map((payment) => ({
      label: formatBookingPrintPaymentMethod(payment.payment_method),
      amount: Number(payment.amount_paid) || 0,
    }));

  const chargeRows = chargeLines.map((line) => {
    const detail = line.detail
      ? `<div style="font-size: 11px;color:#6b7280;margin-top:1px;">${escapeHtml(line.detail)}</div>`
      : '';
    return `
      <tr>
        <td style="padding:4px 0;vertical-align:top;">
          ${escapeHtml(line.label)}${detail}
        </td>
        <td style="padding:4px 0;text-align:right;vertical-align:top;white-space:nowrap;">${escapeHtml(formatBookingMoney(line.amount))}</td>
      </tr>
    `;
  }).join('');

  const paymentRows = completedPayments.map((payment) => `
    <tr>
      <td style="padding:4px 0;">${escapeHtml(payment.label)}</td>
      <td style="padding:4px 0;text-align:right;white-space:nowrap;">${escapeHtml(formatBookingMoney(payment.amount))}</td>
    </tr>
  `).join('');

  const chargesBlock = chargeLines.length
    ? `
      <div style="font-size: 11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:4px;">Charges</div>
      <table style="width:100%;border-collapse:collapse;font-size: 13px;margin-bottom:10px;">
        <tbody>${chargeRows}</tbody>
      </table>
    `
    : '';

  const paymentsBlock = completedPayments.length
    ? `
      <div style="font-size: 11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.03em;margin:10px 0 4px;">Payments received</div>
      <table style="width:100%;border-collapse:collapse;font-size: 13px;margin-bottom:10px;">
        <tbody>
          ${paymentRows}
          <tr>
            <td style="padding:4px 0;font-weight:600;">Total paid</td>
            <td style="padding:4px 0;text-align:right;font-weight:600;white-space:nowrap;">${escapeHtml(formatBookingMoney(totalPaid))}</td>
          </tr>
        </tbody>
      </table>
    `
    : '';

  return `
    ${renderSectionHeading('Payment summary')}
    ${chargesBlock}
    <table style="width:100%;max-width:420px;border-collapse:collapse;font-size: 13px;">
      <tr><td style="padding:4px 0;">Subtotal</td><td style="padding:4px 0;text-align:right;">${escapeHtml(formatBookingMoney(pricing.subtotal))}</td></tr>
      <tr><td style="padding:4px 0;">Taxes</td><td style="padding:4px 0;text-align:right;">${escapeHtml(formatBookingMoney(pricing.taxAmount))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;border-top:1px solid #d1d5db;">Total</td><td style="padding:6px 0;text-align:right;font-weight:700;border-top:1px solid #d1d5db;">${escapeHtml(formatBookingMoney(totalPrice))}</td></tr>
    </table>
    ${paymentsBlock}
    <table style="width:100%;max-width:420px;border-collapse:collapse;font-size: 13px;margin-top:6px;">
      <tr><td style="padding:4px 0;font-weight:600;">Balance due</td><td style="padding:4px 0;text-align:right;font-weight:600;">${escapeHtml(formatBookingMoney(balanceDue))}</td></tr>
    </table>
  `;
}

export function buildBookingPrintHtml({
  booking,
  sections,
  businessTimezone,
  partyHostName,
  birthdayChildName,
  resourceLabel,
  optionsCatalog,
  participants,
  guestListEntries,
  guestList,
  bookingNotes,
  pricing,
}) {
  const activityName = booking?.booking_activities?.activity_name || 'Booking';
  const titleDate = formatDateWithWeekday(booking?.booking_date, businessTimezone);

  const bodyParts = [];

  if (sections.party_overview) {
    bodyParts.push(buildPartyOverviewSection({
      booking,
      businessTimezone,
      resourceLabel,
      partyHostName,
      birthdayChildName,
      pricing,
      guestList,
    }));
  }

  if (sections.food_options) {
    bodyParts.push(buildFoodOptionsSection({ optionsCatalog }));
  }

  if (sections.notes) {
    bodyParts.push(buildNotesSection({
      bookingNotes,
      bookingNotesLegacy: booking?.notes,
      businessTimezone,
    }));
  }

  if (sections.participants) {
    bodyParts.push(buildParticipantsSection({ participants }));
  }

  if (sections.guest_list) {
    bodyParts.push(buildGuestListSection({ guestListEntries }));
  }

  if (sections.payment_summary) {
    bodyParts.push(buildPaymentSection({ booking, pricing }));
  }

  const fallbackHeader = sections.party_overview
    ? ''
    : `
    <header style="margin-bottom:12px;border-bottom:2px solid #111;padding-bottom:8px;">
      <h1 style="margin:0;font-size: 19px;font-weight:700;line-height:1.25;display:flex;justify-content:space-between;align-items:baseline;gap:12px;">
        <span>${escapeHtml(activityName)}</span>
        <span style="white-space:nowrap;">${escapeHtml(titleDate)}</span>
      </h1>
    </header>
  `;

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(activityName)} — ${escapeHtml(titleDate)}</title>
    <style>
      @media print {
        body { margin: 0; padding: 14px; }
      }
    </style>
  </head>
  <body style="font-family: Arial, Helvetica, sans-serif; color: #111; padding: 14px; max-width: 800px; font-size: 14px;">
    ${fallbackHeader}
    ${bodyParts.join('\n')}
    <footer style="margin-top: 18px; padding-top: 8px; border-top: 1px solid #d1d5db; font-size: 11px; color: #9ca3af;">
      Printed ${escapeHtml(new Date().toLocaleString())}
    </footer>
  </body>
</html>`;
}

export function openBookingPrintWindow(html) {
  const printWindow = window.open('', '_blank', 'width=900,height=800');
  if (!printWindow) {
    throw new Error('Pop-up blocked. Allow pop-ups to print this booking.');
  }

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();

  const triggerPrint = () => {
    try {
      printWindow.print();
    } catch {
      // ignore
    }
  };

  if (printWindow.document.readyState === 'complete') {
    setTimeout(triggerPrint, 250);
  } else {
    printWindow.onload = () => setTimeout(triggerPrint, 250);
  }
}
