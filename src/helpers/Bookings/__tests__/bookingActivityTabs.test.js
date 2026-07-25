import { describe, expect, it } from 'vitest';
import {
  createCakeReceiptsTabPreset,
  createEmptyContentBlock,
  normalizeActivityTab,
  normalizeActivityTabReminders,
  renderReminderTemplate,
  serializeActivityTabForSave,
  tabUsesCakeReceiptsUpload,
  tabVisibleToAudience,
} from '../bookingActivityTabs';

describe('bookingActivityTabs', () => {
  it('builds a cake receipts preset with upload + reminders', () => {
    const tab = createCakeReceiptsTabPreset();
    expect(tab.label).toMatch(/cake/i);
    expect(tabUsesCakeReceiptsUpload(tab)).toBe(true);
    expect(tab.reminders.customer[0].days_before).toBe(3);
    expect(tab.reminders.staff[0].send_hour).toBe(9);
  });

  it('normalizes content blocks and reminders', () => {
    const tab = normalizeActivityTab({
      label: 'Packing list',
      audience: 'customer',
      content_blocks: [
        { type: 'header', text: ' Bring ' },
        { type: 'list', title: 'Items' },
        { type: 'file_upload', upload_key: 'cake_receipts' },
      ],
      reminders: {
        customer: [{ days_before: 99, send_hour: 30, enabled: true, subject: 'Hi' }],
        staff: [{ emails: [' a@b.com ', ''], days_before: 1 }],
      },
    });
    expect(tab.tab_key).toBe('packing-list');
    expect(tab.content_blocks[0].text).toBe('Bring');
    expect(tab.content_blocks[1].list_key).toBeTruthy();
    expect(tab.reminders.customer[0].send_hour).toBe(23);
    expect(tab.reminders.staff[0].emails).toEqual(['a@b.com']);
    expect(tabUsesCakeReceiptsUpload(tab)).toBe(true);
  });

  it('respects audience visibility', () => {
    expect(tabVisibleToAudience({ is_active: true, audience: 'both' }, 'staff')).toBe(true);
    expect(tabVisibleToAudience({ is_active: true, audience: 'customer' }, 'staff')).toBe(false);
    expect(tabVisibleToAudience({ is_active: false, audience: 'both' }, 'customer')).toBe(false);
  });

  it('serializes tabs for save and renders templates', () => {
    const block = createEmptyContentBlock('links');
    expect(block.type).toBe('links');
    const payload = serializeActivityTabForSave(
      {
        label: 'Info',
        tab_key: 'info',
        content_blocks: [block],
        reminders: normalizeActivityTabReminders({ customer: [], staff: [] }),
      },
      { businessId: 'biz', activityId: 'act', displayOrder: 2 },
    );
    expect(payload.business_id).toBe('biz');
    expect(payload.activity_id).toBe('act');
    expect(payload.display_order).toBe(2);
    expect(renderReminderTemplate('Hello {{name}}', { name: 'Ada' })).toBe('Hello Ada');
  });
});
