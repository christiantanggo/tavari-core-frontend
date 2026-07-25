/**
 * One-time seed: store Authorize.net credentials for Off The Wall Kids London.
 * Run (credentials from env — never commit secrets):
 *
 *   $env:ANET_API_LOGIN_ID="..."; $env:ANET_TRANSACTION_KEY="..."; $env:ANET_SIGNATURE_KEY="..."; node scripts/seed-otwk-authorize-net-credentials.mjs
 */
import 'dotenv/config';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

function importKeyBytes(rawEnv) {
  const trimmed = String(rawEnv || '').trim();
  if (!trimmed) throw new Error('HELCIM_CREDENTIALS_ENCRYPTION_KEY is not set');

  let keyBytes;
  try {
    keyBytes = Buffer.from(trimmed, 'base64');
    if (keyBytes.length !== 32) {
      keyBytes = createHash('sha256').update(keyBytes).digest();
    }
  } catch {
    keyBytes = createHash('sha256').update(trimmed, 'utf8').digest();
  }
  return keyBytes;
}

function encryptSecret(plaintext, keyBytes) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

function hintFromSecret(value) {
  const s = String(value || '').trim();
  if (s.length <= 6) return '******';
  return `******${s.slice(-6)}`;
}

async function main() {
  const apiLoginId = String(process.env.ANET_API_LOGIN_ID || '').trim();
  const transactionKey = String(process.env.ANET_TRANSACTION_KEY || '').trim();
  const signatureKey = String(process.env.ANET_SIGNATURE_KEY || '').trim();

  if (!apiLoginId || !transactionKey || !signatureKey) {
    console.error('Set ANET_API_LOGIN_ID, ANET_TRANSACTION_KEY, and ANET_SIGNATURE_KEY env vars.');
    process.exit(1);
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const keyBytes = importKeyBytes(process.env.HELCIM_CREDENTIALS_ENCRYPTION_KEY);

  const row = {
    business_id: BIZ,
    api_login_id: apiLoginId,
    transaction_key_encrypted: encryptSecret(transactionKey, keyBytes),
    transaction_key_hint: hintFromSecret(transactionKey),
    signature_key_encrypted: encryptSecret(signatureKey, keyBytes),
    sandbox: false,
    payment_source: 'bookeo',
  };

  const { error } = await supabase
    .from('business_authorize_net_credentials')
    .upsert(row, { onConflict: 'business_id' });

  if (error) {
    console.error('Upsert failed:', error.message);
    process.exit(1);
  }

  console.log('Authorize.net credentials saved for Off The Wall Kids London.');
  console.log(`  API Login ID: ${apiLoginId}`);
  console.log(`  Transaction key hint: ${row.transaction_key_hint}`);
  console.log('  Signature key: configured');
}

main();
