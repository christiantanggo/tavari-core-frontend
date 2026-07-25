/**
 * Configurable additional booking tabs on activities.
 * Content block types: header | text | links | list | file_upload
 * Reminders: customer[] / staff[] with days_before + send_hour.
 */

export const ACTIVITY_TAB_AUDIENCES = ['staff', 'customer', 'both'];
export const ACTIVITY_TAB_BLOCK_TYPES = ['header', 'text', 'links', 'list', 'file_upload'];

const newId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return `id${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};

export function createEmptyActivityTab(overrides = {}) {
  return {
    id: null,
    tab_key: '',
    label: 'New tab',
    display_order: 0,
    is_active: true,
    audience: 'both',
    content_blocks: [],
    reminders: { customer: [], staff: [] },
    ...overrides,
  };
}

export function createCakeReceiptsTabPreset() {
  return createEmptyActivityTab({
    tab_key: 'cake-receipts',
    label: 'Cake receipts',
    content_blocks: [
      { id: newId(), type: 'header', text: 'Cake receipts' },
      {
        id: newId(),
        type: 'text',
        body: 'Upload a photo or PDF of your cake purchase receipt so our team can verify it before the party.',
      },
      {
        id: newId(),
        type: 'file_upload',
        upload_key: 'cake_receipts',
        label: 'Upload cake receipt',
        accept: 'image/*,application/pdf',
        max_files: 10,
      },
    ],
    reminders: {
      customer: [{
        id: newId(),
        enabled: true,
        days_before: 3,
        send_hour: 10,
        subject: 'Reminder: upload your cake receipt',
        body: 'Please upload your cake receipt for {{activity_name}} on {{booking_date}} from your manage booking page.',
      }],
      staff: [{
        id: newId(),
        enabled: true,
        days_before: 1,
        send_hour: 9,
        emails: [],
        subject: 'Cake receipt missing: {{booking_number}}',
        body: '{{activity_name}} on {{booking_date}} still has no cake receipt uploaded.',
      }],
    },
  });
}

export function createEmptyContentBlock(type = 'text') {
  const id = newId();
  switch (type) {
    case 'header':
      return { id, type: 'header', text: 'Section header' };
    case 'links':
      return { id, type: 'links', items: [{ label: 'Link', url: 'https://' }] };
    case 'list':
      return {
        id,
        type: 'list',
        list_key: `list_${id}`,
        title: 'Checklist',
        allow_customer_edit: true,
        placeholder: 'Add an item…',
      };
    case 'file_upload':
      return {
        id,
        type: 'file_upload',
        upload_key: `files_${id}`,
        label: 'Upload files',
        accept: 'image/*,application/pdf',
        max_files: 5,
      };
    case 'text':
    default:
      return { id, type: 'text', body: '' };
  }
}

export function createEmptyReminder(kind = 'customer') {
  const base = {
    id: newId(),
    enabled: true,
    days_before: 3,
    send_hour: 10,
    subject: '',
    body: '',
  };
  if (kind === 'staff') {
    return { ...base, emails: [] };
  }
  return base;
}

function slugifyTabKey(label) {
  return String(label || 'tab')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `tab-${newId()}`;
}

export function normalizeActivityTabReminders(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const normalizeList = (rows, kind) => {
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => {
      const days = Number.parseInt(String(row?.days_before ?? 3), 10);
      const hour = Number.parseInt(String(row?.send_hour ?? 10), 10);
      const next = {
        id: String(row?.id || newId()),
        enabled: row?.enabled !== false,
        days_before: Number.isFinite(days) ? Math.max(0, Math.min(365, days)) : 3,
        send_hour: Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 10,
        subject: String(row?.subject || '').trim(),
        body: String(row?.body || '').trim(),
      };
      if (kind === 'staff') {
        next.emails = Array.isArray(row?.emails)
          ? row.emails.map((e) => String(e || '').trim()).filter(Boolean)
          : [];
      }
      return next;
    });
  };
  return {
    customer: normalizeList(source.customer, 'customer'),
    staff: normalizeList(source.staff, 'staff'),
  };
}

export function normalizeActivityTabContentBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((block) => {
    const type = ACTIVITY_TAB_BLOCK_TYPES.includes(block?.type) ? block.type : 'text';
    const id = String(block?.id || newId());
    if (type === 'header') {
      return { id, type, text: String(block?.text || '').trim() };
    }
    if (type === 'links') {
      const items = Array.isArray(block?.items)
        ? block.items.map((item) => ({
          label: String(item?.label || '').trim() || 'Link',
          url: String(item?.url || '').trim(),
        })).filter((item) => item.url)
        : [];
      return { id, type, items };
    }
    if (type === 'list') {
      return {
        id,
        type,
        list_key: String(block?.list_key || `list_${id}`).trim() || `list_${id}`,
        title: String(block?.title || 'Checklist').trim() || 'Checklist',
        allow_customer_edit: block?.allow_customer_edit !== false,
        placeholder: String(block?.placeholder || 'Add an item…').trim(),
      };
    }
    if (type === 'file_upload') {
      return {
        id,
        type,
        upload_key: String(block?.upload_key || `files_${id}`).trim() || `files_${id}`,
        label: String(block?.label || 'Upload files').trim() || 'Upload files',
        accept: String(block?.accept || 'image/*,application/pdf').trim(),
        max_files: Math.max(1, Math.min(50, Number.parseInt(String(block?.max_files ?? 5), 10) || 5)),
      };
    }
    return { id, type: 'text', body: String(block?.body || '') };
  });
}

export function normalizeActivityTab(row) {
  if (!row || typeof row !== 'object') return null;
  const label = String(row.label || '').trim() || 'Tab';
  const tabKey = String(row.tab_key || '').trim() || slugifyTabKey(label);
  const audience = ACTIVITY_TAB_AUDIENCES.includes(row.audience) ? row.audience : 'both';
  return {
    id: row.id || null,
    business_id: row.business_id || null,
    activity_id: row.activity_id || null,
    tab_key: tabKey,
    label,
    display_order: Number.isFinite(Number(row.display_order)) ? Number(row.display_order) : 0,
    is_active: row.is_active !== false,
    audience,
    content_blocks: normalizeActivityTabContentBlocks(row.content_blocks),
    reminders: normalizeActivityTabReminders(row.reminders),
  };
}

export function serializeActivityTabForSave(tab, { businessId, activityId, displayOrder } = {}) {
  const normalized = normalizeActivityTab({
    ...tab,
    business_id: businessId || tab?.business_id,
    activity_id: activityId || tab?.activity_id,
    display_order: displayOrder != null ? displayOrder : tab?.display_order,
  });
  if (!normalized) return null;
  return {
    ...(normalized.id ? { id: normalized.id } : {}),
    business_id: normalized.business_id,
    activity_id: normalized.activity_id,
    tab_key: normalized.tab_key,
    label: normalized.label,
    display_order: normalized.display_order,
    is_active: normalized.is_active,
    audience: normalized.audience,
    content_blocks: normalized.content_blocks,
    reminders: normalized.reminders,
    updated_at: new Date().toISOString(),
  };
}

export function tabVisibleToAudience(tab, audience) {
  if (!tab || tab.is_active === false) return false;
  const want = audience === 'customer' ? 'customer' : 'staff';
  return tab.audience === 'both' || tab.audience === want;
}

export function tabUsesCakeReceiptsUpload(tab) {
  return (tab?.content_blocks || []).some(
    (block) => block.type === 'file_upload' && block.upload_key === 'cake_receipts',
  );
}

export function renderReminderTemplate(template, vars = {}) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const value = vars[key];
    return value == null ? '' : String(value);
  });
}
