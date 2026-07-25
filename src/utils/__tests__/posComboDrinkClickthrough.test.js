import { describe, expect, it } from 'vitest';
import {
  filterVisiblePosModifierGroups,
  pickNewlyUnlockedGroupId,
} from '../posModifierVisibility';
import { sortModifierGroupsForDisplay } from '../posModifierGroupsLoader';

/** Mirrors ModifierSelectionModal nested-focus tab list. */
function nestedFocusVisibleGroups(allGroups, selections, productId, nestedFocusParentId) {
  const followUpRank = (group) => {
    const name = String(group?.name || '').toLowerCase();
    if (/\bsize\b/.test(name)) return 0;
    if (group?.is_required) return 1;
    if (/flavour|flavor/.test(name)) return 2;
    return 3;
  };
  const all = sortModifierGroupsForDisplay(
    filterVisiblePosModifierGroups(allGroups, selections, productId),
    allGroups.map((g) => g.id)
  );
  if (!nestedFocusParentId) return all;
  const nested = all
    .filter((g) => String(g.show_when_inventory_id || '') === String(nestedFocusParentId))
    .sort((a, b) => followUpRank(a) - followUpRank(b));
  return nested.length > 0 ? nested : all;
}

function nextActiveAfterPick(visible, selections) {
  const unfinishedSize = visible.find(
    (g) =>
      /\bsize\b/i.test(String(g.name || '')) &&
      !selections.some((s) => s.group_id === g.id)
  );
  if (unfinishedSize) return unfinishedSize.name;
  const unfinished = visible.find((g) => !selections.some((s) => s.group_id === g.id));
  return unfinished?.name || visible[0]?.name || null;
}

describe('combo drink click-through: Size then Flavour only', () => {
  const fountainId = 'fountain-pop';
  const mealId = 'meal';
  const groups = [
    {
      id: 'side',
      name: 'Combo Side',
      is_required: true,
      max_selections: 1,
      sort_order: 1,
      show_when_inventory_id: null,
      modifiers: [{ id: 'fries', name: 'Fries' }],
    },
    {
      id: 'drink',
      name: 'Combo Drink',
      is_required: true,
      max_selections: 1,
      sort_order: 2,
      show_when_inventory_id: null,
      modifiers: [
        { id: fountainId, name: 'Fountain Pop', modifier_group_ids: ['size', 'flavour'] },
        { id: 'water', name: 'Water' },
      ],
    },
    {
      id: 'flavour',
      name: 'Fountain Pop Flavour',
      is_required: false,
      max_selections: 1,
      sort_order: 1,
      show_when_inventory_id: fountainId,
      modifiers: [{ id: 'cola', name: 'Cola' }],
    },
    {
      id: 'size',
      name: 'Fountain Pop Size',
      is_required: true,
      max_selections: 1,
      sort_order: 1,
      show_when_inventory_id: fountainId,
      modifiers: [
        { id: 'small', name: 'Pepsi - Small' },
        { id: 'large', name: 'Pepsi - Large' },
      ],
    },
    {
      id: 'bun',
      name: 'Hot Dog Bun',
      is_required: false,
      max_selections: 1,
      sort_order: 3,
      show_when_inventory_id: null,
      modifiers: [{ id: 'bun1', name: 'Regular' }],
    },
  ];

  it('after tapping Fountain Pop, only Size+Flavour tabs show and Size is active', () => {
    const selections = [{ id: fountainId, group_id: 'drink', name: 'Fountain Pop' }];
    const tabs = nestedFocusVisibleGroups(groups, selections, mealId, fountainId);
    expect(tabs.map((g) => g.name)).toEqual([
      'Fountain Pop Size',
      'Fountain Pop Flavour',
    ]);
    expect(nextActiveAfterPick(tabs, selections)).toBe('Fountain Pop Size');
    expect(tabs.some((g) => g.name === 'Hot Dog Bun')).toBe(false);
    expect(tabs.some((g) => g.name === 'Combo Side')).toBe(false);
  });

  it('after picking a size, Flavour is next (not bun/side)', () => {
    const selections = [
      { id: fountainId, group_id: 'drink', name: 'Fountain Pop' },
      { id: 'small', group_id: 'size', name: 'Pepsi - Small' },
    ];
    const tabs = nestedFocusVisibleGroups(groups, selections, mealId, fountainId);
    expect(nextActiveAfterPick(tabs, selections)).toBe('Fountain Pop Flavour');
  });

  it('auto-advance helper prefers Size over Flavour', () => {
    const prev = filterVisiblePosModifierGroups(groups, [], mealId);
    const next = filterVisiblePosModifierGroups(
      groups,
      [{ id: fountainId, group_id: 'drink' }],
      mealId
    );
    expect(pickNewlyUnlockedGroupId(prev, next)).toBe('size');
  });
});
