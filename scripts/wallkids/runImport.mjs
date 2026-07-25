/**
 * One-shot Wallkids → Supabase legacy_waivers import (service role).
 *
 * Required env:
 *  - SUPABASE_URL (or VITE_SUPABASE_URL from your Vite .env)
 *  - SUPABASE_SERVICE_ROLE_KEY (never commit; add in shell for this command only)
 *  - TAVARI_BUSINESS_ID  (UUID)
 *
 * Optional:
 *  - WALLKIDS_SQL_DIR  (default: ./Waivers next to project root, or set absolute path)
 *  - WALLKIDS_MAX_ROWS  (limit waivers for dry run, integer; unset/omit for full import)
 *  - WALLKIDS_BATCH     (default 5; lower if undici/HTTP rejects large bodies)
 *  - WALLKIDS_MAX_RETRIES, WALLKIDS_MAX_PARSE_BUF
 *  - WALLKIDS_SKIP_FAILED_UPSERTS=1  (log and continue if a row still fails after retries; use for DB timeouts on huge rows)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { streamTableTuples } from './streamMysqlInsert.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..', '..');

function toIso(mysqlDate) {
  if (mysqlDate == null) return null;
  if (typeof mysqlDate !== 'string') return null;
  if (mysqlDate === 'NULL') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(mysqlDate)) return `${mysqlDate}T00:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(mysqlDate)) {
    return `${mysqlDate.replace(' ', 'T')}.000Z`;
  }
  return null;
}

function parseDetailsSig(details) {
  if (details == null || details === '') return { sig: null };
  const s = String(details);
  try {
    const j = JSON.parse(s);
    if (j && typeof j === 'object' && 'signature' in j) {
      const sig = j.signature;
      if (typeof sig === 'string') return { sig };
      if (sig != null) return { sig: JSON.stringify(sig) };
    }
  } catch {
    // ignore
  }
  return { sig: null };
}

function buildLegacyRow(v, minorByWaiver, customers) {
  const waiverId = v[0];
  const idSet = minorByWaiver.get(waiverId);
  const custIds = idSet ? Array.from(idSet) : [];
  const legacyMinors = [];
  for (const cid of custIds) {
    const c = customers.get(cid);
    if (!c) continue;
    legacyMinors.push({
      first_name: c.fname,
      last_name: c.lname,
      date_of_birth: c.dob,
      legacy_customer_id: cid,
      signature_strokes: c.sig
    });
  }
  return {
    business_id: process.env.TAVARI_BUSINESS_ID,
    source_system: 'wallkids',
    legacy_row_id: waiverId,
    first_name: String(v[1] || ''),
    last_name: String(v[2] || ''),
    email: v[3] != null ? String(v[3]) : '',
    date_of_birth: v[5] != null && v[5] !== 'NULL' ? String(v[5]) : null,
    signature_strokes: v[4] != null && v[4] !== 'NULL' ? String(v[4]) : null,
    num_minors: Number(v[8]) || 0,
    notes: v[9] != null && v[9] !== 'NULL' ? String(v[9]) : '',
    info: v[14] != null && v[14] !== 'NULL' ? String(v[14]) : '',
    legacy_user_id: v[6] != null ? Number(v[6]) : 0,
    legacy_location_id: v[7] != null ? Number(v[7]) : 0,
    legacy_waiver_template_id: v[15] != null && v[15] !== 'NULL' ? Number(v[15]) : null,
    legacy_customer_id: v[16] != null && v[16] !== 'NULL' ? Number(v[16]) : 0,
    // signed_at drives expiry when expires_at is null; use original creation, not last update (check-in can bump updated_at)
    signed_at: toIso(v[11]) || toIso(v[12]),
    created_at: toIso(v[11]),
    updated_at: toIso(v[12]),
    deleted_at: v[10] != null && v[10] !== 'NULL' ? toIso(v[10]) : null,
    phone: v[13] != null && v[13] !== 'NULL' ? String(v[13]) : '',
    legacy_minors: legacyMinors.length ? legacyMinors : null
  };
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const businessId = process.env.TAVARI_BUSINESS_ID;
  if (!url || !key || !businessId) {
    console.error(
      'Missing env. Need:\n' +
        '  SUPABASE_URL (or VITE_SUPABASE_URL)\n' +
        '  SUPABASE_SERVICE_ROLE_KEY  (Dashboard → Project Settings → API → service_role)\n' +
        '  TAVARI_BUSINESS_ID  (UUID from your business)\n' +
        'Optional: WALLKIDS_MAX_ROWS=100 for a dry run.'
    );
    process.exit(1);
  }

  const dir = process.env.WALLKIDS_SQL_DIR
    ? path.resolve(process.env.WALLKIDS_SQL_DIR)
    : path.join(projectRoot, 'Waivers');
  const waiversPath = path.join(dir, 'waivers.sql');
  const customersPath = path.join(dir, 'customers.sql');
  const minorPath = path.join(dir, 'minor_waivers.sql');
  for (const p of [waiversPath, customersPath, minorPath]) {
    if (!fs.existsSync(p)) {
      console.error('Missing file:', p);
      process.exit(1);
    }
  }

  const maxRows = process.env.WALLKIDS_MAX_ROWS ? parseInt(process.env.WALLKIDS_MAX_ROWS, 10) : 0;
  // Default 5: large signature / info fields can make 25+ row batches exceed HTTP limits.
  const batchSize = process.env.WALLKIDS_BATCH ? parseInt(process.env.WALLKIDS_BATCH, 10) : 5;
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log('1/3 Loading minor_waivers (linking customer_id → waiver_id)…');
  const minorByWaiver = new Map();
  let mwCount = 0;
  await streamTableTuples(minorPath, 'minor_waivers', (values) => {
    mwCount++;
    const customerId = values[1];
    const waiverId = values[2];
    if (!minorByWaiver.has(waiverId)) minorByWaiver.set(waiverId, new Set());
    minorByWaiver.get(waiverId).add(customerId);
  });
  console.log('   minor_waivers rows:', mwCount, 'waiver group keys:', minorByWaiver.size);

  console.log('2/3 Loading customers (id → name, DOB, signature)…');
  const customers = new Map();
  let cCount = 0;
  await streamTableTuples(customersPath, 'customers', (values) => {
    cCount++;
    const id = values[0];
    const fname = values[2] != null ? String(values[2]) : '';
    const lname = values[3] != null ? String(values[3]) : '';
    const details = values[11];
    const dob = values[16] != null && values[16] !== 'NULL' ? String(values[16]) : null;
    const { sig } = parseDetailsSig(details);
    customers.set(id, { fname, lname, dob, sig });
  });
  console.log('   customers rows:', cCount, 'index size:', customers.size);

  console.log('3/3 Streaming waivers → Supabase (upsert)…');
  let wCount = 0;
  const pending = [];
  const maxRetries = process.env.WALLKIDS_MAX_RETRIES ? parseInt(process.env.WALLKIDS_MAX_RETRIES, 10) : 12;
  const upsertBatch = async (batch) => {
    if (!batch.length) return;
    let lastError = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const { error } = await supabase.from('legacy_waivers').upsert(batch, {
        onConflict: 'business_id,source_system,legacy_row_id',
        ignoreDuplicates: false
      });
      if (!error) return;
      lastError = error;
      const code = String(error?.code || '');
      const msg = String(error?.message || error || '');
      const retryable =
        /fetch|ETIMEDOUT|ECONNRESET|socket|network|timeout|57014/i.test(msg) ||
        /fetch|ETIMEDOUT|ECONNRESET|socket|network|timeout|57014/i.test(code) ||
        code === '57014';
      if (!retryable || attempt === maxRetries - 1) {
        break;
      }
      const waitMs = Math.min(30000, 2000 * 2 ** attempt);
      console.warn('Upsert failed (', msg.slice(0, 80), '), retrying in', waitMs, 'ms…');
      await new Promise((r) => setTimeout(r, waitMs));
    }
    if (lastError && batch.length > 1) {
      const m = String(lastError?.message || lastError || '');
      const code = String(lastError?.code || '');
      const canSplit =
        /fetch|ETIMEDOUT|ECONNRESET|socket|network|413|Payload|content[- ]?length|too large|entity too large|RangeError|Invalid string length|timeout|57014|statement timeout/i.test(
          m
        ) ||
        code === '57014';
      if (canSplit) {
        const mid = Math.ceil(batch.length / 2);
        console.warn('Splitting batch of', batch.length, 'rows (large, timeout, or failed request).');
        await upsertBatch(batch.slice(0, mid));
        await upsertBatch(batch.slice(mid));
        return;
      }
    }
    if (lastError) {
      if (process.env.WALLKIDS_SKIP_FAILED_UPSERTS === '1' || process.env.WALLKIDS_SKIP_FAILED_UPSERTS === 'true') {
        console.error(
          'SKIP (WALLKIDS_SKIP_FAILED_UPSERTS) could not upsert legacy_row_id(s):',
          batch.map((b) => b.legacy_row_id).join(', ')
        );
        return;
      }
      console.error('Upsert error:', lastError?.message || lastError, lastError, 'legacy_row_id=', batch[0]?.legacy_row_id);
      throw lastError;
    }
  };

  await streamTableTuples(waiversPath, 'waivers', (values) => {
    if (maxRows > 0 && wCount >= maxRows) return;
    wCount++;
    if (values.length < 17) {
      console.warn('Short waiver tuple, skipping. len=', values.length);
      return;
    }
    const row = buildLegacyRow(values, minorByWaiver, customers);
    pending.push(row);
    if (pending.length >= batchSize) {
      const batch = pending.splice(0, batchSize);
      return upsertBatch(batch);
    }
    if (wCount % 5000 === 0) console.log('   …', wCount, 'waivers');
  });
  if (pending.length) await upsertBatch(pending);
  console.log('Done. Waivers upserted:', wCount, '(project max:', maxRows || 'none', ')');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
