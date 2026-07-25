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

const filePath = path.join(__dirname, '..', 'public', 'installers', 'tavari-music-desktop-portable.zip');
const fileName = 'tavari-music.zip'; // Shorter name
const bucketName = 'music-installers';

if (!fs.existsSync(filePath)) {
  console.error('❌ File not found:', filePath);
  process.exit(1);
}

const fileStats = fs.statSync(filePath);
console.log('📦 File to upload:');
console.log('   Path:', filePath);
console.log('   Size:', (fileStats.size / 1024 / 1024).toFixed(2), 'MB');
console.log('   Target:', `${bucketName}/${fileName}`);
console.log('');

// For very large files, we need to use a different approach
// Supabase Storage API has a limit, so we'll try direct upload with retries
console.log('📤 Uploading (this may take 10-15 minutes for 957MB)...');
console.log('   Using direct upload with automatic retries...');
console.log('');

const fileBuffer = fs.readFileSync(filePath);
const maxRetries = 5;
let uploadData = null;
let uploadError = null;

for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    console.log(`   Attempt ${attempt}/${maxRetries}...`);
    
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(fileName, fileBuffer, {
        contentType: 'application/zip',
        upsert: true,
        cacheControl: '3600'
      });
    
    if (error) {
      uploadError = error;
      console.log(`   ❌ Failed: ${error.message}`);
      
      if (attempt < maxRetries) {
        const waitTime = Math.min(attempt * 30, 120); // 30s, 60s, 90s, 120s, 120s
        console.log(`   ⏳ Waiting ${waitTime}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        continue;
      }
    } else {
      uploadData = data;
      console.log(`   ✅ Upload successful!`);
      break;
    }
  } catch (err) {
    uploadError = err;
    console.log(`   ❌ Error: ${err.message}`);
    
    if (attempt < maxRetries) {
      const waitTime = Math.min(attempt * 30, 120);
      console.log(`   ⏳ Waiting ${waitTime}s before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
    }
  }
}

if (uploadError && !uploadData) {
  console.error('\n❌ Upload failed after all retries');
  console.error('   Error:', uploadError.message);
  console.error('');
  console.error('💡 RECOMMENDATION: Use GitHub Releases instead');
  console.error('   GitHub Releases:');
  console.error('   - FREE');
  console.error('   - No file size limits');
  console.error('   - Reliable CDN');
  console.error('   - Easy to update');
  console.error('');
  console.error('   Steps:');
  console.error('   1. Create GitHub repo (or use existing)');
  console.error('   2. Go to Releases → Create new release');
  console.error('   3. Upload: tavari-music-desktop-portable.zip');
  console.error('   4. Get URL and set VITE_INSTALLER_BASE_URL');
  process.exit(1);
}

console.log('\n✅ Upload successful!');
console.log('   File:', uploadData.path);
console.log('   URL:', `${supabaseUrl}/storage/v1/object/public/${bucketName}/${uploadData.path}`);
console.log('');
console.log('🎉 File is now available for download!');
console.log('');
console.log('⚠️  NOTE: Update download page to use filename: tavari-music.zip');




