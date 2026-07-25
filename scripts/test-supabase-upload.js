import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
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
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test different filename variations
const testFiles = [
  'tavari-music-desktop-portable.zip',
  'tavari-music.zip',
  'tavari-music-desktop.zip',
  'music-desktop.zip'
];

const filePath = path.join(__dirname, '..', 'public', 'installers', 'tavari-music-desktop-portable.zip');

if (!fs.existsSync(filePath)) {
  console.error('❌ Source file not found:', filePath);
  process.exit(1);
}

const fileBuffer = fs.readFileSync(filePath);
const bucketName = 'music-installers';

console.log('🧪 Testing different filename variations...\n');

for (const testName of testFiles) {
  console.log(`Testing: ${testName}`);
  
  try {
    // Try to upload with this filename
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(testName, fileBuffer, {
        contentType: 'application/zip',
        upsert: true,
        cacheControl: '3600'
      });
    
    if (error) {
      console.log(`  ❌ Failed: ${error.message}`);
      if (error.message.includes('invalid') || error.message.includes('name')) {
        console.log(`     → Filename "${testName}" is invalid`);
      }
    } else {
      console.log(`  ✅ SUCCESS! Uploaded as: ${testName}`);
      console.log(`     URL: ${supabaseUrl}/storage/v1/object/public/${bucketName}/${testName}`);
      console.log('\n🎉 Found working filename!');
      break;
    }
  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
  }
  
  console.log('');
}




