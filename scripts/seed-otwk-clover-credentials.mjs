/**
 * One-time seed: store Clover sandbox credentials for Off The Wall Kids London.
 * Run (credentials from env — never commit secrets):
 *
 *   $env:CLOVER_MERCHANT_ID="2MK4WGQEFQXE1"; $env:CLOVER_API_TOKEN="..."; node scripts/seed-otwk-clover-credentials.mjs
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
  const merchantId = String(process.env.CLOVER_MERCHANT_ID || '').trim();
  const apiToken = String(process.env.CLOVER_API_TOKEN || '').trim();
  const authCode = String(process.env.CLOVER_AUTH_CODE || '').trim();
  const sandbox = String(process.env.CLOVER_SANDBOX || 'true').toLowerCase() !== 'false';

  if (!merchantId || !apiToken) {
    console.error('Set CLOVER_MERCHANT_ID and CLOVER_API_TOKEN env vars.');
    process.exit(1);
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const keyBytes = importKeyBytes(process.env.HELCIM_CREDENTIALS_ENCRYPTION_KEY);

  const row = {
    business_id: BIZ,
    merchant_id: merchantId,
    api_token_encrypted: encryptSecret(apiToken, keyBytes),
    api_token_hint: hintFromSecret(apiToken),
    clover_auth_code_encrypted: authCode ? encryptSecret(authCode, keyBytes) : null,
    sandbox,
    payment_source: 'clover_pos',
  };

  const { error } = await supabase
    .from('business_clover_credentials')
    .upsert(row, { onConflict: 'business_id' });

  if (error) {
    console.error('Upsert failed:', error.message);
    process.exit(1);
  }

  console.log('Clover credentials saved for Off The Wall Kids London.');
  console.log(`  Merchant ID: ${merchantId}`);
  console.log(`  API token hint: ${row.api_token_hint}`);
  console.log(`  Sandbox: ${sandbox}`);
}

main();
