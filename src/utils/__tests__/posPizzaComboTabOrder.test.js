import { describe, expect, it } from 'vitest';
import { sortModifierGroupsForDisplay } from '../posModifierGroupsLoader';

describe('7" pizza combo modifier tab order', () => {
  it('follows product attachment: Toppings → Side → Drink → Left → Right', () => {
    const groups = [
      { id: 'side', name: 'Combo Side', sort_order: 1, show_when_inventory_id: null },
      { id: 'drink', name: 'Combo Drink', sort_order: 2, show_when_inventory_id: null },
      { id: 'full', name: '7" Full Pizza Toppings', sort_order: 2, show_when_inventory_id: 'pizza7' },
      { id: 'left', name: '7" Left Pizza Toppings', sort_order: 3, show_when_inventory_id: 'pizza7' },
      { id: 'right', name: '7" Right Pizza Toppings', sort_order: 4, show_when_inventory_id: 'pizza7' },
    ];
    const ordered = sortModifierGroupsForDisplay(groups, [
      'full',
      'side',
      'drink',
      'left',
      'right',
    ]);
    expect(ordered.map((g) => g.name)).toEqual([
      '7" Full Pizza Toppings',
      'Combo Side',
      'Combo Drink',
      '7" Left Pizza Toppings',
      '7" Right Pizza Toppings',
    ]);
  });
});
