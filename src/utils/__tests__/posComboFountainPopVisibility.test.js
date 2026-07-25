import { describe, expect, it } from 'vitest';
import {
  filterVisiblePosModifierGroups,
  getNestedMinInventoryPrice,
  pickNewlyUnlockedGroupId,
} from '../posModifierVisibility';
import { sortModifierGroupsForDisplay } from '../posModifierGroupsLoader';

describe('combo fountain pop nested size visibility', () => {
  const fountainId = 'fountain-pop';
  const mealId = 'hot-dog-meal';

  const groups = [
    {
      id: 'combo-drink',
      name: 'Combo Drink',
      is_required: true,
      max_selections: 1,
      sort_order: 1,
      show_when_inventory_id: null,
      modifiers: [
        { id: fountainId, name: 'Fountain Pop', inventory_price: 0, price: 0 },
        { id: 'water', name: 'Water', inventory_price: 1.77, price: 0 },
      ],
    },
    {
      id: 'fountain-flavour',
      name: 'Fountain Pop Flavour',
      is_required: false,
      max_selections: 1,
      sort_order: 1,
      show_when_inventory_id: fountainId,
      modifiers: [{ id: 'cola', name: 'Cola', inventory_price: 0, price: 0 }],
    },
    {
      id: 'fountain-size',
      name: 'Fountain Pop Size',
      is_required: true,
      max_selections: 1,
      sort_order: 1,
      show_when_inventory_id: fountainId,
      modifiers: [
        { id: 'small', name: 'Small', inventory_price: 2.21, price: 0 },
        { id: 'large', name: 'Large', inventory_price: 3.98, price: 1.73 },
      ],
    },
  ];

  it('hides size/flavour until fountain pop is selected', () => {
    const visible = filterVisiblePosModifierGroups(groups, [], mealId);
    expect(visible.map((g) => g.id)).toEqual(['combo-drink']);
  });

  it('orders Size before Flavour even when Flavour is listed first / same sort_order', () => {
    const ordered = sortModifierGroupsForDisplay(groups, [
      'combo-drink',
      'fountain-flavour',
      'fountain-size',
    ]);
    const nested = ordered.filter((g) => g.show_when_inventory_id === fountainId);
    expect(nested.map((g) => g.id)).toEqual(['fountain-size', 'fountain-flavour']);
  });

  it('auto-advances to Size not Flavour when both unlock', () => {
    const prev = filterVisiblePosModifierGroups(groups, [], mealId);
    const next = filterVisiblePosModifierGroups(
      groups,
      [{ id: fountainId, group_id: 'combo-drink' }],
      mealId
    );
    expect(pickNewlyUnlockedGroupId(prev, next)).toBe('fountain-size');
  });

  it('shows size before flavour after fountain pop is selected', () => {
    const selections = [
      { id: fountainId, group_id: 'combo-drink', name: 'Fountain Pop' },
    ];
    const visible = filterVisiblePosModifierGroups(groups, selections, mealId);
    const ordered = sortModifierGroupsForDisplay(visible, [
      'combo-drink',
      'fountain-flavour',
      'fountain-size',
    ]);
    expect(ordered.map((g) => g.id)).toEqual([
      'combo-drink',
      'fountain-size',
      'fountain-flavour',
    ]);
    expect(getNestedMinInventoryPrice(groups, fountainId)).toBe(2.21);
  });
});
