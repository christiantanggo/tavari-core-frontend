import { describe, expect, it } from 'vitest';
import { filterVisiblePosModifierGroups } from '../posModifierVisibility';

describe('7" pizza combo toppings visibility', () => {
  const pizza7Id = '7-inch-cheese';
  const comboId = '7-inch-pizza-combo';

  const cheesePizzaGroups = [
    {
      id: 'pizza-size',
      name: 'Pizza Size',
      max_selections: 1,
      show_when_inventory_id: null,
      modifiers: [
        { id: pizza7Id, name: '7" Personal Cheese' },
        { id: 'pizza-12', name: '12" Medium Cheese' },
      ],
    },
    {
      id: 'toppings-7',
      name: '7" Full Pizza Toppings',
      max_selections: 99,
      show_when_inventory_id: pizza7Id,
      modifiers: [{ id: 'pep', name: 'Pepperoni (7")' }],
    },
  ];

  const comboGroups = [
    {
      id: 'combo-side',
      name: 'Combo Side',
      max_selections: 1,
      show_when_inventory_id: null,
      modifiers: [{ id: 'fries', name: 'Fries' }],
    },
    {
      id: 'toppings-7',
      name: '7" Full Pizza Toppings',
      max_selections: 99,
      // Gated on 7" cheese — which is NOT an option on the combo
      show_when_inventory_id: pizza7Id,
      modifiers: [{ id: 'pep', name: 'Pepperoni (7")' }],
    },
  ];

  it('shows 7" toppings on Cheese Pizza only after 7" is selected', () => {
    expect(filterVisiblePosModifierGroups(cheesePizzaGroups, [], 'cheese-pizza').map((g) => g.id)).toEqual([
      'pizza-size',
    ]);
    expect(
      filterVisiblePosModifierGroups(
        cheesePizzaGroups,
        [{ id: pizza7Id, group_id: 'pizza-size' }],
        'cheese-pizza'
      ).map((g) => g.id)
    ).toEqual(['pizza-size', 'toppings-7']);
  });

  it('shows 7" toppings on the 7" combo even though 7" cheese is not selectable', () => {
    const visible = filterVisiblePosModifierGroups(comboGroups, [], comboId);
    expect(visible.map((g) => g.id)).toEqual(['combo-side', 'toppings-7']);
  });
});
