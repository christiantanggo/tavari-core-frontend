/**
 * Upload Tavari Receipt Printer installer to Supabase Storage (waiver-installers bucket).
 * Usage: node scripts/upload-pos-print-agent-installer.mjs [path-to-exe]
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
const objectName = 'Tavari-Receipt-Printer-Setup.exe';

const argPath = process.argv[2];
const candidates = [
  argPath,
  path.join(__dirname, '..', 'dist', 'installers', 'Tavari-Receipt-Printer-Setup.exe'),
  path.join(__dirname, '..', 'public', 'installers', 'Tavari-Receipt-Printer-Setup.exe'),
].filter(Boolean);

const filePath = candidates.find((p) => fs.existsSync(p));
if (!filePath) {
  console.error('Installer not found. Build first: npm run build-pos-print-agent');
  console.error('Looked for:', candidates.join(', '));
  process.exit(1);
}

const fileBuffer = fs.readFileSync(filePath);
console.log(`Uploading ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB → ${bucketName}/${objectName}`);

const { data, error } = await supabase.storage.from(bucketName).upload(objectName, fileBuffer, {
  contentType: 'application/octet-stream',
  upsert: true,
  cacheControl: '3600',
});

if (error) {
  console.error('Upload failed:', error.message);
  process.exit(1);
}

const publicUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucketName}/${objectName}`;
console.log('Uploaded:', data?.path || objectName);
console.log('Public URL:', publicUrl);
console.log('Set VITE_POS_PRINT_AGENT_INSTALLER_URL to that URL in Vercel if needed.');
