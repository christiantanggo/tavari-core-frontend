import { describe, expect, it } from 'vitest';
import {
  applyPortalOptionLibraryAssignment,
  applyPortalOptionLibraryGroupUpsert,
  clonePortalOptionGroup,
  collectPortalOptionLibrary,
  defaultPortalOptionGroup,
  defaultPortalOptionItem,
  mergeAddonSettingsWithPortalOptions,
  parsePortalActivityOptions,
  portalOptionGroupFingerprint,
  serializePortalActivityOptions,
} from '../bookingActivityOptions';

describe('portal option library helpers', () => {
  it('fingerprints groups by name + option inventory/name', () => {
    const groupA = defaultPortalOptionGroup({
      name: 'Pizza',
      options: [
        defaultPortalOptionItem({ name: 'Cheese', inventory_item_id: 'inv-1' }),
        defaultPortalOptionItem({ name: 'Pepperoni', inventory_item_id: 'inv-2' }),
      ],
    });
    const groupB = defaultPortalOptionGroup({
      name: 'Pizza',
      options: [
        defaultPortalOptionItem({ name: 'Pepperoni', inventory_item_id: 'inv-2' }),
        defaultPortalOptionItem({ name: 'Cheese', inventory_item_id: 'inv-1' }),
      ],
    });
    expect(portalOptionGroupFingerprint(groupA)).toBe(portalOptionGroupFingerprint(groupB));
  });

  it('clones groups with remapped show_when ids', () => {
    const included = defaultPortalOptionItem({ id: 'opt-a', name: 'Small', included: true });
    const upgrade = defaultPortalOptionItem({
      id: 'opt-b',
      name: 'Large',
      show_when_option_id: 'opt-a',
    });
    const group = defaultPortalOptionGroup({
      name: 'Size',
      show_when_option_id: 'opt-a',
      options: [included, upgrade],
    });
    const cloned = clonePortalOptionGroup(group);
    expect(cloned.id).not.toBe(group.id);
    expect(cloned.options[0].id).not.toBe('opt-a');
    expect(cloned.options[1].show_when_option_id).toBe(cloned.options[0].id);
    expect(cloned.show_when_option_id).toBe(cloned.options[0].id);
  });

  it('collects library and applies multi-activity assignment', () => {
    const group = defaultPortalOptionGroup({
      name: 'Food',
      options: [defaultPortalOptionItem({ name: 'Nachos', inventory_item_id: 'inv-n' })],
    });
    const addon = mergeAddonSettingsWithPortalOptions(
      {},
      serializePortalActivityOptions({ displayMode: 'single_modal', groups: [group] }),
    );
    const activities = [
      { id: 'a1', activity_name: 'Party A', addon_settings: addon },
      { id: 'a2', activity_name: 'Party B', addon_settings: {} },
      { id: 'a3', activity_name: 'Camp', addon_settings: {} },
    ];
    const library = collectPortalOptionLibrary(activities);
    expect(library).toHaveLength(1);
    expect(library[0].activityIds).toEqual(['a1']);

    const updates = applyPortalOptionLibraryAssignment({
      activities,
      fingerprint: library[0].fingerprint,
      templateGroup: library[0].group,
      selectedActivityIds: ['a1', 'a2'],
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].activityId).toBe('a2');
    const next = parsePortalActivityOptions(updates[0].addonSettings);
    expect(next.groups).toHaveLength(1);
    expect(next.groups[0].name).toBe('Food');
  });

  it('creates a new group on selected activities via upsert', () => {
    const template = defaultPortalOptionGroup({
      name: 'Decor',
      options: [defaultPortalOptionItem({ name: 'Balloons', inventory_item_id: 'inv-b' })],
    });
    const activities = [
      { id: 'a1', addon_settings: {} },
      { id: 'a2', addon_settings: {} },
    ];
    const updates = applyPortalOptionLibraryGroupUpsert({
      activities,
      previousFingerprint: null,
      templateGroup: template,
      selectedActivityIds: ['a1', 'a2'],
    });
    expect(updates).toHaveLength(2);
    expect(parsePortalActivityOptions(updates[0].addonSettings).groups[0].name).toBe('Decor');
  });
});
