import camperRegistrationService from '../services/Bookings/CamperRegistrationService';
import bookingService from '../services/Bookings/BookingService';
import { navigateFromAiChat } from './aiChatNavigation';
import { openCamperRegistrationPrint } from './openCamperRegistrationPrint';
import {
  filterCamperDocumentsByName,
  formatCamperRegistrationLabel,
} from './camperRegistrationNameMatch';
import {
  copyTextToClipboard,
  resolveStaffLink,
  resolveStaffLinksByCategory,
} from './aiStaffLinks';
import { formatDateShort } from './businessDateFormat';
import { formatBookingTimeRangeLabel } from './bookingTimeRange';
import {
  buildWaiverSigningUrl,
  resolveWaiverSigningTargets,
} from './waiverSigningLink';

const WAIVER_LINK_IDS = new Set(['waiver_signing', 'waiver_from_booking']);

/**
 * @typedef {Object} AiChatChoice
 * @property {string} [documentId]
 * @property {string} [linkId]
 * @property {string} label
 * @property {'print' | 'link' | 'booking_guest_list' | 'waiver_link'} [choiceType]
 * @property {string} [bookingId]
 * @property {string} [templateKey]
 * @property {string} [waiverLinkKind]
 */

/**
 * @typedef {Object} ExecuteAiChatActionsOptions
 * @property {string} businessId
 * @property {import('react-router-dom').NavigateFunction} navigate
 * @property {(choices: AiChatChoice[], content?: string) => void} onChoices
 * @property {(patch: { content?: string; choices?: AiChatChoice[]; linkCards?: object[] }) => void} onMessagePatch
 * @property {() => void} [close]
 * @property {(id: string, options?: { initialTab?: string }) => void} [openBookingDetail]
 */

/**
 * @param {Array<{ type: string; searchName?: string; documentId?: string }>} actions
 * @param {ExecuteAiChatActionsOptions} options
 */
export async function executeAiChatActions(actions, options) {
  if (!actions?.length) return;

  const patchMessage = (patch) => {
    if (options.onMessagePatch) options.onMessagePatch(patch);
    else if (patch.content || patch.choices) {
      options.onChoices(patch.choices || [], patch.content);
    }
  };

  for (const action of actions) {
    if (action.type === 'resolve_camper_registration_print') {
      await resolveCamperRegistrationPrint(action.searchName || '', options);
    } else if (action.type === 'print_camper_registration' && action.documentId) {
      await openCamperRegistrationPrint(options.businessId, action.documentId);
    } else if (action.type === 'open_registration_forms_search') {
      navigateFromAiChat(
        options.navigate,
        '/dashboard/bookings?tab=registration-forms',
        'Registration forms',
        action.searchQuery || ''
      );
    } else if (action.type === 'resolve_staff_link' && action.linkId) {
      await resolveStaffLinkAction(action.linkId, options, patchMessage);
    } else if (action.type === 'list_staff_links') {
      await listStaffLinksAction(action.category || 'all', options, patchMessage);
    } else if (action.type === 'disambiguate_staff_links') {
      await disambiguateStaffLinksAction(action.linkIds || [], options, patchMessage);
    } else if (action.type === 'open_booking_guest_list') {
      await openBookingGuestListAction(action, options, patchMessage);
    }
  }
}

function formatBookingGuestListLabel(booking) {
  const activity = booking?.booking_activities?.activity_name || 'Party';
  const date = booking?.booking_date ? formatDateShort(booking.booking_date) : '';
  const time = formatBookingTimeRangeLabel({
    booking_time: booking?.booking_time,
    booking_end_time: booking?.booking_end_time,
    duration_minutes: booking?.duration_minutes,
  });
  const num = booking?.booking_number ? `#${booking.booking_number}` : '';
  return [activity, date, time, num].filter(Boolean).join(' · ');
}

async function openBookingGuestListAction(action, options, patchMessage) {
  const { openBookingDetail, businessId, close } = options;

  if (action.bookingId && openBookingDetail) {
    openBookingDetail(action.bookingId, { initialTab: 'guest-list' });
    patchMessage({ content: 'Opened the **Guest list** tab for this booking.' });
    close?.();
    return;
  }

  if (!businessId) {
    patchMessage({ content: 'Select an active business to find party bookings.' });
    return;
  }

  if (!action.searchTerm && !action.bookingDate) {
    patchMessage({
      content:
        'Which party’s guest list should I open? Tell me the booking number, date (e.g. Jun 7), or customer name.',
    });
    return;
  }

  bookingService.setBusinessId(businessId);
  const filters = {};
  if (action.bookingDate) {
    filters.startDate = action.bookingDate;
    filters.endDate = action.bookingDate;
  }
  if (action.searchTerm) {
    filters.search = action.searchTerm;
  }

  let bookings = await bookingService.getBookings(filters);

  if (bookings.length === 0 && action.searchTerm && action.bookingDate) {
    bookings = await bookingService.getBookings({
      startDate: action.bookingDate,
      endDate: action.bookingDate,
    });
  }

  if (bookings.length === 0) {
    patchMessage({
      content:
        'I couldn’t find a booking matching that. Try a booking number, date, or customer phone/email.',
    });
    return;
  }

  if (bookings.length === 1 && openBookingDetail) {
    const label = formatBookingGuestListLabel(bookings[0]);
    openBookingDetail(bookings[0].id, { initialTab: 'guest-list' });
    patchMessage({ content: `Opening guest list for ${label}.` });
    close?.();
    return;
  }

  const choices = bookings.slice(0, 8).map((booking) => ({
    bookingId: booking.id,
    label: formatBookingGuestListLabel(booking),
    choiceType: 'booking_guest_list',
  }));

  patchMessage({
    content: `I found ${bookings.length} bookings. Which party’s guest list should I open?`,
    choices,
  });
}

async function disambiguateStaffLinksAction(linkIds, options, patchMessage) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const ids = Array.isArray(linkIds) ? linkIds.filter(Boolean) : [];

  if (!ids.length) {
    patchMessage({
      content:
        'Which link do you need? For example: guest list, booking portal, camp registration, waiver kiosk, or music kiosk. Or say **show all kiosk links** if you want the full kiosk list.',
    });
    return;
  }

  const choices = ids.map((linkId) => {
    const resolved = resolveStaffLink(linkId, {
      origin,
      businessId: options.businessId,
    });
    return {
      linkId,
      label: resolved?.label || linkId,
      choiceType: 'link',
    };
  });

  patchMessage({
    content: 'Which link do you need? Pick one below and I’ll copy it for you.',
    choices,
  });
}

async function resolveWaiverLinkResult(businessId, linkId, templateKey, patchMessage) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const catalogEntry = resolveStaffLink(linkId, { origin, businessId });

  if (!businessId) {
    patchMessage({ content: 'Select an active business to build a waiver signing link.' });
    return { ok: false };
  }

  let key = String(templateKey || '').trim();
  let label = catalogEntry?.label || 'Waiver signing link';

  if (!key) {
    const { targets, error } = await resolveWaiverSigningTargets(businessId);
    if (error && !targets?.length) {
      patchMessage({
        content:
          error === 'No active waiver templates found.'
            ? 'No active waiver templates found. Create one under **Tavari Waivers → Templates** first.'
            : error,
      });
      return { ok: false };
    }

    if (targets.length > 1) {
      const choices = targets.map((target) => ({
        linkId,
        templateKey: target.templateKey,
        label: target.label,
        choiceType: 'waiver_link',
        waiverLinkKind: linkId,
      }));
      patchMessage({
        content: 'Which waiver template link should I copy?',
        choices,
      });
      return { ok: false, needsChoice: true };
    }

    key = targets[0]?.templateKey || '';
    label = targets[0]?.label || label;
  }

  const url = buildWaiverSigningUrl(origin, businessId, key, linkId);
  if (!url) {
    patchMessage({ content: 'Could not build waiver signing URL.' });
    return { ok: false };
  }

  const copied = await copyTextToClipboard(url);
  const copyNote = copied ? 'Copied to your clipboard.' : 'Use Copy URL below.';
  const templateNote = key ? ` (${label})` : '';
  patchMessage({
    content: `Here’s the **${catalogEntry?.label || 'Waiver signing'}** link${templateNote} (${copyNote})`,
    linkCards: [
      {
        id: `${linkId}-${key || 'default'}`,
        label: key ? `${catalogEntry?.label || 'Waiver'} — ${label}` : catalogEntry?.label || 'Waiver signing',
        description:
          catalogEntry?.description ||
          'Customers open this link to complete and sign the waiver in their browser.',
        url,
      },
    ],
  });
  return { ok: true, copied, url, label };
}

async function resolveStaffLinkAction(linkId, options, patchMessage) {
  if (WAIVER_LINK_IDS.has(linkId)) {
    await resolveWaiverLinkResult(options.businessId, linkId, null, patchMessage);
    return;
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const resolved = resolveStaffLink(linkId, {
    origin,
    businessId: options.businessId,
  });

  if (!resolved) {
    patchMessage({
      content: 'I couldn’t find that link type. Try asking for kiosk links or a specific link like guest list or booking portal.',
    });
    return;
  }

  if (resolved.error || !resolved.url) {
    patchMessage({ content: resolved.error || 'Could not build that link.' });
    return;
  }

  const copied = await copyTextToClipboard(resolved.url);
  const copyNote = copied ? 'Copied to your clipboard.' : 'Use Copy URL below.';
  patchMessage({
    content: `Here’s the **${resolved.label}** link (${copyNote})`,
    linkCards: [
      {
        id: resolved.id,
        label: resolved.label,
        description: resolved.description,
        url: resolved.url,
      },
    ],
  });
}

async function listStaffLinksAction(category, options, patchMessage) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const links = resolveStaffLinksByCategory({
    origin,
    businessId: options.businessId,
    category,
  });

  if (!links.length) {
    patchMessage({
      content:
        category === 'all'
          ? 'No links are available right now. Make sure a business is selected for customer links.'
          : `No ${category} links found for this business.`,
    });
    return;
  }

  const categoryLabel =
    category === 'customer'
      ? 'customer'
      : category === 'kiosk'
        ? 'kiosk'
        : category === 'staff'
          ? 'staff'
          : 'shareable';

  patchMessage({
    content: `Here are the ${categoryLabel} links for your business. Tap **Copy URL** on any row to share it.`,
    linkCards: links.map((row) => ({
      id: row.id,
      label: row.label,
      description: row.description,
      url: row.url,
    })),
  });
}

async function resolveCamperRegistrationPrint(searchName, options) {
  const { businessId, navigate, onChoices } = options;
  const term = String(searchName || '').trim();
  if (!businessId) {
    onChoices([], 'I need an active business selected to look up registrations.');
    return;
  }
  if (!term) {
    onChoices([], 'Please tell me the camper’s name (for example, “Elijah Leader”).');
    return;
  }

  camperRegistrationService.setBusinessId(businessId);
  let raw = await camperRegistrationService.getRecentDocuments(50, term);
  let matches = filterCamperDocumentsByName(raw, term);

  // Fallback: filter client-side if DB query still missed (unusual name formats).
  if (matches.length === 0 && term.includes(' ')) {
    raw = await camperRegistrationService.getRecentDocuments(100, '');
    matches = filterCamperDocumentsByName(raw, term);
  }

  if (matches.length === 0) {
    onChoices(
      [],
      `I couldn’t find a camp registration for “${term}”. Try Form Search with that name, or check the spelling.`
    );
    navigateFromAiChat(
      navigate,
      `/dashboard/bookings?tab=registration-forms`,
      'Registration forms',
      `search ${term}`
    );
    return;
  }

  if (matches.length === 1) {
    const label = formatCamperRegistrationLabel(matches[0]);
    onChoices([], `Opening the print dialog for ${label}. Click Print in the browser window to finish.`);
    await openCamperRegistrationPrint(businessId, matches[0].id);
    return;
  }

  const choices = matches.slice(0, 8).map((doc) => ({
    documentId: doc.id,
    label: formatCamperRegistrationLabel(doc),
    choiceType: 'print',
  }));

  onChoices(
    choices,
    `I found ${matches.length} registrations matching “${term}”. Which one should I print?`
  );
}

export async function printCamperRegistrationByDocumentId(businessId, documentId) {
  return openCamperRegistrationPrint(businessId, documentId);
}

export async function resolveStaffLinkById(businessId, linkId, templateKey) {
  if (WAIVER_LINK_IDS.has(linkId)) {
    const patches = [];
    const result = await resolveWaiverLinkResult(businessId, linkId, templateKey, (patch) => {
      patches.push(patch);
    });
    const patch = patches[patches.length - 1];
    if (result?.needsChoice) {
      return { ok: false, needsChoice: true, choices: patch?.choices };
    }
    if (!result?.ok) {
      return { ok: false, content: patch?.content };
    }
    const card = patch?.linkCards?.[0];
    return {
      ok: true,
      copied: result.copied,
      resolved: card
        ? { id: card.id, label: card.label, description: card.description, url: card.url }
        : null,
    };
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const resolved = resolveStaffLink(linkId, { origin, businessId });
  if (!resolved?.url || resolved.error) return { ok: false, resolved };
  const copied = await copyTextToClipboard(resolved.url);
  return { ok: true, copied, resolved };
}
