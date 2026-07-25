/**
 * Backfill party food / add-on line items from Bookeo CSV onto imported bookings.
 *
 * Usage:
 *   node scripts/backfill-bookeo-food-addons.mjs           # dry-run
 *   node scripts/backfill-bookeo-food-addons.mjs --apply   # write to DB
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const CSV_PATH = path.join(__dirname, '..', 'Legacy Bookings', 'report_bookingsJuly4-September31.csv');
const APPLY = process.argv.includes('--apply');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

/** Bookeo CSV column → Tavari pos_inventory.name (or display label if no inventory). */
const CSV_COLUMN_TO_INVENTORY = {
  'Breakfast Platter': 'Breakfast Platter',
  'Juice Box': 'Juice Box',
  'Pepsi Fountain (Pitcher)': 'Pepsi Pitcher',
  'French Fry Bowl': 'French Fry Bowl',
  'Medium Cheese Pizza (8 Slices)': 'Cheese Pizza',
  'Medium Pepperoni Pizza (8 Slices)': 'Pepperoni Pizza',
  'Medium Canadian Pizza (8 slices)': 'Canadian Pizza',
  'Medium Vegetarian Pizza (8 slices)': 'Vegetarian Pizza',
  'Medium Deluxe Pizza (8 Slices)': 'Deluxe Pizza',
  'Medium 3-Meat Pizza (8 Slices)': '3-Meat Pizza',
  'Chicken Nugget (36) & Fry Platter': '36 Nuggets & Fries',
  'Chicken Nugget (36 & Fry Platter)': '36 Nuggets & Fries',
  'Chicken Strip (24) & Fry Platter': '24 Chicken Strips & Fries',
  'Hot dog (12) & Fry Platter': '12 Hot Dogs & Fries',
  'Gold Fish Bowl': 'Gold Fish Bowl',
  'Gold Fish Cracker Bowl': 'Gold Fish Bowl',
  'Goldfish Cracker Bowl': 'Gold Fish Bowl',
  'Doritos Chip Bowl': 'Chip Bowl',
  'Fruit Platter': 'Fruit Tray',
  'Fruit Tray': 'Fruit Tray',
  'Large Fruit Platter': 'Fruit Tray',
  'Vegetable Platter': 'Veggie Tray',
  'Vegetable Tray': 'Veggie Tray',
  'Large Vegetable Platter': 'Veggie Tray',
  'Balloon Bouquet - Helium Filled (1F|6L)': 'Helium - 1 Foil, 6 Latex',
  'Early Drop-Off': null,
  'Late Pick-Up': null,
  'LATE PICK UP': null,
  'Waffle Meal (Per Person)': null,
  'Party Host': null,
  'Character Mascot': null,
};

const INVENTORY_FALLBACKS = {
  '24 Chicken Strips & Fries': ['Chicken Strip & Fries Platter'],
  '36 Nuggets & Fries': ['Chicken Nugget Party Platter'],
  'Cheese Pizza': ['12" Medium Cheese'],
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || (c === '\r' && next === '\n')) {
      row.push(field); rows.push(row); row = []; field = '';
      if (c === '\r') i++;
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

async function loadInventoryMap() {
  const { data, error } = await supabase
    .from('pos_inventory')
    .select('id, name, price')
    .eq('business_id', BIZ);
  if (error) throw error;

  const byName = new Map();
  for (const row of data || []) {
    byName.set(String(row.name).trim().toLowerCase(), row);
  }
  return byName;
}

function resolveInventoryItem(byName, primaryName, csvColumn) {
  const tryNames = [primaryName, ...(INVENTORY_FALLBACKS[primaryName] || [])].filter(Boolean);
  for (const name of tryNames) {
    const row = byName.get(String(name).trim().toLowerCase());
    if (row) {
      return {
        displayName: row.name,
        unitPrice: Number.parseFloat(row.price) || 0,
        inventoryId: row.id,
      };
    }
  }
  return {
    displayName: csvColumn,
    unitPrice: 0,
    inventoryId: null,
  };
}

async function loadBookingsByExternalRef() {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, booking_number, external_reference, activity_id, multi_day_role')
    .eq('business_id', BIZ)
    .not('external_reference', 'is', null);
  if (error) throw error;

  const map = new Map();
  for (const row of data || []) {
    if (row.multi_day_role === 'day') continue;
    map.set(String(row.external_reference).trim(), row);
  }
  return map;
}

async function bookingAlreadyHasBookeoFood(bookingId) {
  const { data, error } = await supabase
    .from('booking_addon_items')
    .select('id, booking_addons:addon_id ( addon_key )')
    .eq('booking_id', bookingId);
  if (error) throw error;
  return (data || []).some((row) => {
    const key = row.booking_addons?.addon_key || '';
    return String(key).startsWith('bookeo-food-');
  });
}

async function getOrCreateAddon({
  bookingId,
  activityId,
  externalRef,
  slug,
  addonName,
  unitPrice,
  csvColumn,
}) {
  const addonKey = `bookeo-food-${externalRef}-${slug}`;

  const { data: existing, error: fetchError } = await supabase
    .from('booking_addons')
    .select('id')
    .eq('business_id', BIZ)
    .eq('addon_key', addonKey)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (existing?.id) return existing.id;

  if (!APPLY) return null;

  const { data: created, error: createError } = await supabase
    .from('booking_addons')
    .insert({
      business_id: BIZ,
      addon_name: addonName,
      addon_key: addonKey,
      description: `Bookeo import food — CSV: ${csvColumn}`,
      price: unitPrice,
      is_global: false,
      activity_ids: activityId ? [activityId] : null,
      inventory_tracked: false,
      current_stock: null,
      is_active: false,
    })
    .select('id')
    .single();
  if (createError) throw createError;
  return created.id;
}

function collectFoodLines(row, idx, byName) {
  const merged = new Map();

  for (const [csvColumn, inventoryName] of Object.entries(CSV_COLUMN_TO_INVENTORY)) {
    if (!(csvColumn in idx)) continue;
    const qty = parseInt(row[idx[csvColumn]] || '0', 10) || 0;
    if (qty <= 0) continue;

    const resolved = inventoryName
      ? resolveInventoryItem(byName, inventoryName, csvColumn)
      : { displayName: csvColumn, unitPrice: 0, inventoryId: null };

    const key = resolved.displayName.toLowerCase();
    const prev = merged.get(key);
    if (prev) {
      prev.quantity += qty;
    } else {
      merged.set(key, {
        csvColumn,
        displayName: resolved.displayName,
        unitPrice: resolved.unitPrice,
        inventoryId: resolved.inventoryId,
        quantity: qty,
      });
    }
  }

  return [...merged.values()];
}

async function backfillBooking({ booking, externalRef, foodLines, stats }) {
  if (!foodLines.length) return;

  if (await bookingAlreadyHasBookeoFood(booking.id)) {
    stats.skippedExisting++;
    return;
  }

  stats.bookingsWithFood++;

  for (const line of foodLines) {
    const slug = slugify(line.displayName);
    stats.linesPlanned++;

    if (!APPLY) {
      console.log(
        `  [dry-run] ${booking.booking_number} (${externalRef}): ${line.quantity}× ${line.displayName} @ $${line.unitPrice.toFixed(2)}`,
      );
      continue;
    }

    const addonId = await getOrCreateAddon({
      bookingId: booking.id,
      activityId: booking.activity_id,
      externalRef,
      slug,
      addonName: line.displayName,
      unitPrice: line.unitPrice,
      csvColumn: line.csvColumn,
    });

    const { error: insertError } = await supabase.from('booking_addon_items').insert({
      booking_id: booking.id,
      addon_id: addonId,
      quantity: line.quantity,
      unit_price: line.unitPrice,
    });
    if (insertError) {
      stats.errors.push(`${externalRef} / ${line.displayName}: ${insertError.message}`);
      continue;
    }
    stats.linesInserted++;
  }

  if (APPLY) {
    console.log(`  ✓ ${booking.booking_number} (${externalRef}): ${foodLines.length} food line(s)`);
  }
}

async function main() {
  console.log(`=== Bookeo food add-on backfill (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);
  if (!fs.existsSync(CSV_PATH)) throw new Error(`CSV not found: ${CSV_PATH}`);

  const byName = await loadInventoryMap();
  const bookingsByRef = await loadBookingsByExternalRef();

  const csv = fs.readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(csv);
  const headers = rows[0];
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  const stats = {
    bookingsWithFood: 0,
    linesPlanned: 0,
    linesInserted: 0,
    skippedExisting: 0,
    skippedNoBooking: 0,
    unmappedInventory: new Set(),
    errors: [],
  };

  for (const row of rows.slice(1)) {
    if (!row.some((c) => String(c || '').trim())) continue;

    const externalRef = row[idx['Booking number']]?.trim();
    if (!externalRef) continue;

    const booking = bookingsByRef.get(externalRef);
    if (!booking) {
      stats.skippedNoBooking++;
      continue;
    }

    const foodLines = collectFoodLines(row, idx, byName);
    for (const line of foodLines) {
      if (line.unitPrice === 0 && CSV_COLUMN_TO_INVENTORY[line.csvColumn]) {
        const invName = CSV_COLUMN_TO_INVENTORY[line.csvColumn];
        if (invName && !byName.has(invName.toLowerCase())) {
          stats.unmappedInventory.add(`${line.csvColumn} → ${invName}`);
        }
      }
    }

    await backfillBooking({ booking, externalRef, foodLines, stats });
  }

  console.log('\n--- Summary ---');
  console.log(`Bookings with food in CSV processed: ${stats.bookingsWithFood}`);
  console.log(`Food lines ${APPLY ? 'inserted' : 'planned'}: ${APPLY ? stats.linesInserted : stats.linesPlanned}`);
  console.log(`Skipped (already had bookeo food): ${stats.skippedExisting}`);
  console.log(`Skipped (booking not in Tavari): ${stats.skippedNoBooking}`);
  if (stats.unmappedInventory.size) {
    console.log('Inventory names not found (used $0 manual lines):');
    [...stats.unmappedInventory].forEach((x) => console.log(`  - ${x}`));
  }
  if (stats.errors.length) {
    console.log('Errors:');
    stats.errors.forEach((e) => console.log(`  - ${e}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
