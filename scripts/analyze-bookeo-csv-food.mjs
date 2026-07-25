import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '..', 'Legacy Bookings', 'report_bookingsJuly4-September31.csv');

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

const text = fs.readFileSync(CSV_PATH, 'utf8');
const rows = parseCsv(text);
const headers = rows[0];
const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

const foodCols = headers.filter((h) =>
  /pizza|platter|fry|hot dog|juice|pepsi|breakfast|fruit|vegetable|gold fish|doritos|waffle|balloon|character|party host|early drop|late pick|chicken nugget|chicken strip|cracker bowl/i.test(h),
);

const dataRows = rows.slice(1).filter((r) => r.some((c) => String(c || '').trim()));
let rowsWithFood = 0;
const foodCounts = {};
const samples = [];

for (const row of dataRows) {
  const bookingNum = row[idx['Booking number']]?.trim();
  const items = [];
  for (const col of foodCols) {
    const v = parseInt(row[idx[col]] || '0', 10) || 0;
    if (v > 0) {
      items.push({ col, qty: v });
      foodCounts[col] = (foodCounts[col] || 0) + v;
    }
  }
  if (items.length) {
    rowsWithFood++;
    if (samples.length < 5) {
      samples.push({ bookingNum, activity: row[idx.Activity]?.trim(), items });
    }
  }
}

console.log(JSON.stringify({
  totalDataRows: dataRows.length,
  rowsWithFood,
  foodColumnCount: foodCols.length,
  foodColumns: foodCols,
  topFoodCounts: Object.entries(foodCounts).sort((a, b) => b[1] - a[1]),
  samples,
}, null, 2));
