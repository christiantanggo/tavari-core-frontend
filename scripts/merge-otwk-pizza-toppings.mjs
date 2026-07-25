/**
 * Merge 7" and 12" pizza topping sections into one section with both prices per item.
 * Run: node scripts/merge-otwk-pizza-toppings.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

const TOPPINGS = [
  { name: 'Pepperoni', id7: '326b1930-d3dc-4f3a-9765-655a2ddc9bfb', id12: '4fb689d2-446d-4e22-b62c-78e454bcef55' },
  { name: 'Sausage', id7: '842aca7e-c954-43e8-9272-dbfde1453fa0', id12: 'ea0048f3-b279-4c60-bf09-8728e5a3f5b7' },
  { name: 'Bacon Crumble', id7: '6ab5c722-68a5-4956-8a1f-ab4653fbda6c', id12: '1ed25c31-c6fc-4675-8872-980b4dc469da' },
  { name: 'Olives', id7: '0b53a379-8271-4a71-ba46-e980c1c89897', id12: '570b3e27-adce-432d-b375-cdd0f0fa598a' },
  { name: 'Pineapple', id7: '765ff239-5eeb-459c-af3c-9560205a9f7c', id12: '8f4d4732-a6f1-4ccb-b438-41fbb967f343' },
  { name: 'Green Pepper', id7: 'e2f89036-25be-471a-93cd-46eb87776aac', id12: '493e72d1-3060-4dd1-921b-ebec6e5604e5' },
  { name: 'Tomato', id7: '02af4049-fe3c-4ba4-85c1-30b670e3954d', id12: '84fcb04a-6b1d-436f-b965-3f7f90f5ca76' },
  { name: 'Mushroom', id7: '895d832e-00af-477f-adb9-b90d127df0f0', id12: '178710c5-142f-4397-92b7-cddd857dddf5' },
  { name: 'Onion', id7: 'a7581133-7559-4e04-923d-3af0c8b0da04', id12: '3fa91ba6-6beb-4d80-a86a-78c621b4ff1b' },
  { name: 'Sun Dried Tomato', id7: '61db2eeb-0650-48ed-9acf-8330d14e9cd1', id12: 'd1e7aa26-1bd0-4cba-ab11-e976562b50e8' },
];

function toppingItem({ name, id7, id12 }) {
  return {
    id: `mi-topping-${name.replace(/\W/g, '').slice(0, 12).toLowerCase()}`,
    kind: 'tavari',
    priceLayout: 'sizes',
    displayName: name,
    tavariProductId: id7,
    variants: [
      { label: '7"', tavariProductId: id7 },
      { label: '12"', tavariProductId: id12 },
    ],
  };
}

const mergedSection = {
  id: 'pizza-toppings',
  title: 'Pizza Toppings',
  subtitle: 'Additional toppings extra. Prices shown for 7" and 12" pizzas.',
  items: TOPPINGS.map(toppingItem),
};

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data, error } = await supabase
  .from('business_website_menu')
  .select('menu_sections')
  .eq('business_id', BIZ)
  .single();
if (error) throw error;

const sections = (data.menu_sections || []).filter(
  (s) => s.id !== 'pizza-toppings-7' && s.id !== 'pizza-toppings-12',
);

const pizzaIdx = sections.findIndex((s) => s.id === 'pizza');
const insertAt = pizzaIdx >= 0 ? pizzaIdx + 1 : sections.length;
sections.splice(insertAt, 0, mergedSection);

const { error: updateErr } = await supabase
  .from('business_website_menu')
  .update({ menu_sections: sections, updated_at: new Date().toISOString() })
  .eq('business_id', BIZ);
if (updateErr) throw updateErr;

console.log('Merged pizza toppings -> single section with 7" and 12" prices per item.');
