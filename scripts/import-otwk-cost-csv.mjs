/**
 * Import OTWK cost spreadsheet (ingredients + supplier URLs) into Recipe Manager.
 *
 * Default CSV: ~/Downloads/Copy of OTWK - Cost vs Price Update - Updated April 1st 2026v2.csv
 *
 * Run:
 *   node scripts/import-otwk-cost-csv.mjs
 *   node scripts/import-otwk-cost-csv.mjs --recipes
 *   node scripts/import-otwk-cost-csv.mjs --dry-run
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createClient } from '@supabase/supabase-js';

const BIZ = process.env.OTWK_BUSINESS_ID || 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const DEFAULT_CSV = path.join(
  os.homedir(),
  'Downloads',
  'Copy of OTWK - Cost vs Price Update - Updated April 1st 2026v2.csv',
);

const SUPPLIER_DEFS = [
  { key: 'gfs', name: 'Gordon Food Service', website_url: 'https://order.gfs.com', cols: { price: 2, link: 3 } },
  { key: 'sysco', name: 'Sysco', website_url: 'https://www.sysco.ca', cols: { price: 5, link: null } },
  { key: 'wc', name: 'Wholesale Club', website_url: 'https://www.wholesaleclub.ca/en', cols: { price: 7, link: 8 } },
  { key: 'walmart', name: 'Walmart Canada', website_url: 'https://www.walmart.ca/en', cols: { price: 9, link: 10 } },
  { key: 'rcss', name: 'Real Canadian Superstore', website_url: 'https://www.realcanadiansuperstore.ca/en', cols: { price: 11, link: 12 } },
  { key: 'falls', name: 'Falls', website_url: null, cols: { price: 13, link: 14 } },
  { key: 'other', name: 'Other', website_url: null, cols: { price: 15, link: 16 } },
];

const COL = {
  category: 0,
  item: 1,
  size: 17,
  unitSize: 18,
  unitsPerCase: 19,
  casePrice: 20,
  unitPrice: 21,
};

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const importRecipes = args.has('--recipes');
const csvPath = process.argv.find((a) => !a.startsWith('--') && a.endsWith('.csv')) || DEFAULT_CSV;

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseMoney(value) {
  if (value == null) return null;
  const s = String(value).trim().replace(/[$,#REF!]/gi, '');
  if (!s || s.toLowerCase() === 'n/a') return null;
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function cleanText(value) {
  return String(value || '').trim();
}

function isUrl(value) {
  const s = cleanText(value);
  return /^https?:\/\//i.test(s);
}

function normalizeUrl(value) {
  const s = cleanText(value);
  if (isUrl(s)) return s;
  return null;
}

function loadRows(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/).map(parseCsvLine);
}

function isIngredientSectionRow(row) {
  if (row[COL.item] === 'Description' && row[COL.size - 15] === 'Cost') return false;
  if (row[1] === 'Description' && row[2] === 'Cost') return false;
  const item = cleanText(row[COL.item]);
  if (!item || item === 'Description') return false;
  return true;
}

function isMenuCostSectionRow(row) {
  return row[1] === 'Description' && row[2] === 'Cost';
}

function buildIngredientName(category, item) {
  return cleanText(item);
}

async function ensureSuppliers() {
  const map = new Map();
  const { data: existing } = await supabase.from('rb_suppliers').select('id, name').eq('business_id', BIZ);
  for (const row of existing || []) map.set(row.name.toLowerCase(), row.id);

  for (const def of SUPPLIER_DEFS) {
    const key = def.name.toLowerCase();
    if (map.has(key)) {
      map.set(def.key, map.get(key));
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] create supplier: ${def.name}`);
      map.set(def.key, `dry-${def.key}`);
      continue;
    }
    const { data, error } = await supabase
      .from('rb_suppliers')
      .insert({
        business_id: BIZ,
        name: def.name,
        website_url: def.website_url,
        scraping_enabled: Boolean(def.website_url),
        is_active: true,
      })
      .select('id')
      .single();
    if (error) throw error;
    map.set(def.key, data.id);
    map.set(key, data.id);
    console.log(`Created supplier: ${def.name}`);
  }
  return map;
}

async function upsertIngredient(record) {
  const { data: existing } = await supabase
    .from('ingredients')
    .select('id')
    .eq('business_id', BIZ)
    .eq('name', record.name)
    .maybeSingle();

  const payload = {
    name: record.name,
    business_id: BIZ,
    unit_of_measure: record.unitOfMeasure,
    units_per_case: record.unitsPerCase,
    case_price: record.casePrice,
    case_size: record.caseSize,
    cost: record.unitCost || 0,
    cost_sync_enabled: true,
    purchase_unit_size: 1,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  if (dryRun) {
    console.log(`[dry-run] ingredient: ${record.name} @ $${record.unitCost ?? 0}`);
    return existing?.id || `dry-${record.name}`;
  }

  if (existing?.id) {
    const { error } = await supabase.from('ingredients').update(payload).eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await supabase.from('ingredients').insert(payload).select('id').single();
  if (error) throw error;
  return data.id;
}

async function upsertSupplierPrice({ supplierId, ingredientId, price, productUrl, unitOfMeasure }) {
  if (!supplierId || !ingredientId) return;
  if (price == null && !productUrl) return;

  const { data: existing } = await supabase
    .from('rb_supplier_prices')
    .select('id')
    .eq('supplier_id', supplierId)
    .eq('ingredient_id', ingredientId)
    .eq('is_current', true)
    .maybeSingle();

  const payload = {
    supplier_id: supplierId,
    ingredient_id: ingredientId,
    pos_inventory_id: null,
    inventory_id: null,
    price_per_unit: price ?? 0,
    unit_of_measure: unitOfMeasure || 'each',
    product_url: productUrl,
    is_current: true,
    last_updated: new Date().toISOString(),
  };

  if (dryRun) return;

  if (existing?.id) {
    const { error } = await supabase.from('rb_supplier_prices').update(payload).eq('id', existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from('rb_supplier_prices').insert(payload);
  if (error) throw error;
}

async function importIngredients(rows, supplierMap) {
  let currentCategory = '';
  let count = 0;
  let inMenuSection = false;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (i < 3) continue;

    if (isMenuCostSectionRow(row)) {
      inMenuSection = true;
      continue;
    }
    if (inMenuSection) continue;

    const catCell = cleanText(row[COL.category]);
    if (catCell && catCell !== 'Description') currentCategory = catCell;
    if (!isIngredientSectionRow(row)) continue;

    const item = cleanText(row[COL.item]);
    const name = buildIngredientName(currentCategory, item);
    const unitsPerCase = parseMoney(row[COL.unitsPerCase]);
    const casePrice = parseMoney(row[COL.casePrice]);
    let unitCost = parseMoney(row[COL.unitPrice]);
    const size = cleanText(row[COL.size]);
    const unitSize = parseMoney(row[COL.unitSize]);
    const unitOfMeasure = unitSize != null ? 'each' : 'each';

    if (unitCost == null && casePrice != null && unitsPerCase != null && unitsPerCase > 0) {
      unitCost = casePrice / unitsPerCase;
    }

    const caseSize = size || (unitsPerCase ? `${unitsPerCase} per case` : null);

    const ingredientId = await upsertIngredient({
      name,
      unitOfMeasure,
      unitsPerCase,
      casePrice,
      caseSize,
      unitCost,
    });

    for (const def of SUPPLIER_DEFS) {
      const price = parseMoney(row[def.cols.price]);
      const linkRaw = def.cols.link != null ? row[def.cols.link] : null;
      const productUrl = normalizeUrl(linkRaw);
      if (price == null && !productUrl) continue;
      await upsertSupplierPrice({
        supplierId: supplierMap.get(def.key),
        ingredientId,
        price: price ?? casePrice ?? 0,
        productUrl,
        unitOfMeasure,
      });
    }

    count += 1;
    if (count % 25 === 0) console.log(`  … ${count} ingredients`);
  }

  console.log(`Imported ${count} purchased ingredients`);
}

async function importMenuRecipes(rows) {
  let currentMenuCategory = '';
  let count = 0;

  for (const row of rows) {
    if (isMenuCostSectionRow(row)) {
      currentMenuCategory = cleanText(row[COL.category]) || currentMenuCategory;
      continue;
    }

    const item = cleanText(row[COL.item]);
    if (!item || item === 'Description') continue;
    if (parseMoney(row[2]) == null && parseMoney(row[COL.unitPrice]) == null) continue;

    const recipeCost = parseMoney(row[2]);
    const markup = parseMoney(row[14]);
    const marginPercent = markup ? Math.round((1 - 1 / markup) * 100) : 60;

    const { data: posItem } = await supabase
      .from('pos_inventory')
      .select('id, name')
      .eq('business_id', BIZ)
      .ilike('name', item)
      .eq('is_active', true)
      .maybeSingle();

    if (!posItem) {
      console.log(`  skip recipe (no POS item): ${item}`);
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] recipe cost for ${posItem.name}: $${recipeCost} margin ${marginPercent}%`);
      count += 1;
      continue;
    }

    const { data: existingRecipe } = await supabase
      .from('pos_modifier_groups')
      .select('id')
      .eq('business_id', BIZ)
      .eq('pos_inventory_id', posItem.id)
      .eq('group_type', 'recipe_dish')
      .maybeSingle();

    const payload = {
      name: posItem.name,
      business_id: BIZ,
      group_type: 'recipe_dish',
      pos_inventory_id: posItem.id,
      target_margin_percent: marginPercent,
      is_active: true,
    };

    if (existingRecipe?.id) {
      await supabase.from('pos_modifier_groups').update(payload).eq('id', existingRecipe.id);
    } else {
      await supabase.from('pos_modifier_groups').insert(payload);
    }

    if (recipeCost != null) {
      await supabase.from('pos_inventory').update({ cost: recipeCost }).eq('id', posItem.id);
    }

    count += 1;
  }

  console.log(`Updated ${count} menu item recipe costs`);
}

async function main() {
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  console.log(`Reading ${csvPath}`);
  const rows = loadRows(csvPath);
  const supplierMap = await ensureSuppliers();

  await importIngredients(rows, supplierMap);
  if (importRecipes) await importMenuRecipes(rows);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
