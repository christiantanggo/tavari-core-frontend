/**
 * Upload Chrome OS print helper installer (.sh + zip) to Supabase Storage.
 * Usage: node scripts/upload-pos-print-agent-chromeos.mjs
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, '');
        process.env[key.trim()] = value.trim();
      }
    }
  });
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL and a Supabase key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const bucketName = 'waiver-installers';
const installersDir = path.join(__dirname, '..', 'dist', 'installers');

const uploads = [
  {
    objectName: 'Tavari-Receipt-Printer-ChromeOS-Install.sh',
    contentType: 'application/octet-stream',
  },
  {
    objectName: 'Tavari-Receipt-Printer-ChromeOS.zip',
    contentType: 'application/zip',
    optional: true,
  },
];

let uploaded = 0;
for (const item of uploads) {
  const filePath = path.join(installersDir, item.objectName);
  if (!fs.existsSync(filePath)) {
    if (item.optional) {
      console.warn(`Skipping missing optional file: ${item.objectName}`);
      continue;
    }
    console.error(`Not found: ${filePath}`);
    console.error('Run: npm run build-pos-print-agent-chromeos');
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(filePath);
  console.log(
    `Uploading ${(fileBuffer.length / 1024).toFixed(1)} KB → ${bucketName}/${item.objectName}`
  );

  const { error } = await supabase.storage.from(bucketName).upload(item.objectName, fileBuffer, {
    contentType: item.contentType,
    upsert: true,
    cacheControl: '3600',
  });

  if (error) {
    console.error(`Upload failed (${item.objectName}):`, error.message);
    process.exit(1);
  }

  const publicUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucketName}/${item.objectName}`;
  console.log('Public URL:', publicUrl);
  uploaded += 1;
}

if (uploaded === 0) {
  console.error('Nothing uploaded');
  process.exit(1);
}
