// scripts/seed-app-version.js
// Script to seed initial app version in Supabase
// Run this after uploading a new installer to Supabase Storage

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env files (in order of priority)
const envFiles = [
  path.join(__dirname, '../.env.local'),
  path.join(__dirname, '../.env'),
  path.join(__dirname, '../.env.development')
];

for (const envFile of envFiles) {
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
    console.log(`📄 Loaded env from: ${path.basename(envFile)}`);
  }
}

// Also try to load from .env file manually (for VITE_ prefixed vars)
const envFile = path.join(__dirname, '../.env');
if (fs.existsSync(envFile)) {
  const envContent = fs.readFileSync(envFile, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = value;
        }
      }
    }
  });
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://iagcamwcfuiopmwefohz.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseKey) {
  console.error('❌ VITE_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY not found in environment variables');
  console.error('   Please set it in .env, .env.local, or .env.development file');
  console.error('   Or set it as an environment variable: VITE_SUPABASE_ANON_KEY=your_key');
  process.exit(1);
}

console.log('✅ Supabase URL:', supabaseUrl);
console.log('✅ Supabase Key:', supabaseKey.substring(0, 20) + '...');

const supabase = createClient(supabaseUrl, supabaseKey);

async function seedAppVersion() {
  const versionNumber = process.argv[2] || '1.0.1';
  const releaseNotes = process.argv[3] || 'Initial release with business selector feature';
  
  // Get Supabase project ID for storage URL
  const projectId = supabaseUrl.match(/https?:\/\/([^.]+)/)?.[1] || 'iagcamwcfuiopmwefohz';
  const storageBaseUrl = `https://${projectId}.supabase.co/storage/v1/object/public/music-installers`;

  // Build version data matching actual schema
  // download_url is REQUIRED (NOT NULL), installer_url_windows is optional
  const installerUrl = `${storageBaseUrl}/tavari-music-desktop-setup.exe`;
  
  const versionData = {
    version_number: versionNumber,
    release_notes: releaseNotes,
    download_url: installerUrl, // REQUIRED - old column name
    installer_url_windows: installerUrl, // Optional - new column name
    status: 'active',
    is_required: false,
    is_critical_update: false,
    auto_update_enabled: true
  };

  console.log('📦 Seeding app version:', versionNumber);
  console.log('   Data:', JSON.stringify(versionData, null, 2));

  // Try using the seed function first (bypasses RLS)
  const { data: functionData, error: functionError } = await supabase.rpc('seed_app_version', {
    p_version_number: versionNumber,
    p_release_notes: releaseNotes,
    p_installer_url_windows: installerUrl,
    p_installer_url_mac: null,
    p_installer_url_linux: null,
    p_status: 'active',
    p_is_required: false
  });

  if (!functionError && functionData) {
    console.log('✅ Version seeded successfully via function:', functionData);
    process.exit(0);
  }

  // Fallback to direct insert (RLS should allow anon inserts now)
  console.log('⚠️  Function not available, trying direct insert...');
  const { data, error } = await supabase
    .from('music_app_versions')
    .insert(versionData)
    .select();

  if (error) {
    console.error('❌ Error seeding version:', error);
    process.exit(1);
  }

  console.log('✅ Version seeded successfully:', data);
  process.exit(0);
}

seedAppVersion().catch(err => {
  console.error('❌ Failed to seed version:', err);
  process.exit(1);
});

