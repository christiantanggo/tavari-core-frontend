import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file manually if it exists
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, ''); // Remove quotes
        process.env[key.trim()] = value.trim();
      }
    }
  });
}

// Load env vars (check both VITE_ and without prefix)
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables:');
  console.error('   VITE_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
  console.error('   VITE_SUPABASE_ANON_KEY:', supabaseKey ? '✓' : '✗');
  console.error('');
  console.error('Create a .env file with these variables or set them in your terminal');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Supabase storage requires lowercase filenames
const bucketName = 'music-installers';

// Upload both files: portable ZIP and setup EXE
// Check multiple locations for flexibility
const filesToUpload = [
  {
    localPath: path.join(__dirname, '..', 'public', 'installers', 'tavari-music-desktop-portable.zip'),
    remoteName: 'tavari-music-desktop-portable.zip',
    description: 'Portable ZIP (no admin needed)'
  },
  {
    localPath: path.join(__dirname, '..', 'public', 'installers', 'tavari-music-desktop-setup.exe'),
    remoteName: 'tavari-music-desktop-setup.exe',
    description: 'Windows Setup Installer'
  },
  // Also check dist/win-unpacked for the unpacked exe (from build-desktop)
  {
    localPath: path.join(__dirname, '..', 'dist', 'win-unpacked', 'Tavari Music Desktop.exe'),
    remoteName: 'tavari-music-desktop-setup.exe',
    description: 'Windows Desktop App (from dist/win-unpacked)'
  }
];

// Check which files exist
const existingFiles = filesToUpload.filter(f => fs.existsSync(f.localPath));

if (existingFiles.length === 0) {
  console.error('❌ No installer files found!');
  console.error('   Expected files:');
  filesToUpload.forEach(f => console.error(`     - ${f.localPath}`));
  process.exit(1);
}

console.log('📦 Files to upload:');
existingFiles.forEach(f => {
  const stats = fs.statSync(f.localPath);
  console.log(`   ${f.description}:`);
  console.log(`      Path: ${f.localPath}`);
  console.log(`      Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`      Remote: ${f.remoteName}`);
});
console.log('');

// Verify ZIP file if it exists
const zipFile = existingFiles.find(f => f.remoteName.endsWith('.zip'));
if (zipFile) {
  try {
    const fileBuffer = fs.readFileSync(zipFile.localPath);
    const magicBytes = fileBuffer.slice(0, 4);
    const isZip = magicBytes[0] === 0x50 && magicBytes[1] === 0x4B;
    
    if (!isZip) {
      console.error('❌ ZIP file is not valid (missing PK signature)');
      process.exit(1);
    }
    console.log('✅ ZIP signature verified');
    console.log('');
  } catch (err) {
    console.error('❌ Error reading ZIP file:', err.message);
    process.exit(1);
  }
}

console.log('📤 Uploading to Supabase storage...');
console.log('   URL:', supabaseUrl);
console.log('   Bucket:', bucketName);
console.log('');

// Upload each file
const uploadResults = [];

for (const file of existingFiles) {
  console.log(`\n📤 Uploading: ${file.description}`);
  console.log(`   File: ${file.remoteName}`);
  
  const fileStats = fs.statSync(file.localPath);
  console.log(`   Size: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);
  
  // Check file size warning
  if (fileStats.size > 50 * 1024 * 1024) {
    console.log('   ⚠️  WARNING: File exceeds 50MB (Supabase free tier limit)');
  }
  
  // Read file as buffer
  console.log('   Reading file into memory...');
  const fileBuffer = fs.readFileSync(file.localPath);
  
  // Determine content type
  const contentType = file.remoteName.endsWith('.zip') 
    ? 'application/zip' 
    : 'application/x-msdownload'; // .exe
  
  // Upload with retries
  const maxRetries = 3;
  let uploadData = null;
  let uploadError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`   Upload attempt ${attempt}/${maxRetries}...`);
      
      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(file.remoteName, fileBuffer, {
          contentType: contentType,
          upsert: true,
          cacheControl: '3600'
        });
      
      if (error) {
        uploadError = error;
        if (attempt < maxRetries) {
          const waitTime = attempt * 10;
          console.log(`   ⚠️  Upload failed, retrying in ${waitTime}s...`);
          console.log(`   Error: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
          continue;
        }
      } else {
        uploadData = data;
        console.log('   ✅ Upload successful!');
        break;
      }
    } catch (err) {
      uploadError = err;
      if (attempt < maxRetries) {
        const waitTime = attempt * 10;
        console.log(`   ⚠️  Upload failed, retrying in ${waitTime}s...`);
        console.log(`   Error: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      }
    }
  }
  
  if (uploadError && !uploadData) {
    console.error(`   ❌ Upload failed after all retries: ${uploadError.message}`);
    uploadResults.push({ file: file.remoteName, success: false, error: uploadError });
  } else {
    console.log(`   🔗 URL: ${supabaseUrl}/storage/v1/object/public/${bucketName}/${uploadData.path}`);
    uploadResults.push({ file: file.remoteName, success: true, data: uploadData });
  }
}

// Summary
console.log('\n📊 Upload Summary:');
uploadResults.forEach(result => {
  if (result.success) {
    console.log(`   ✅ ${result.file} - Uploaded successfully`);
  } else {
    console.log(`   ❌ ${result.file} - Failed: ${result.error.message}`);
  }
});

const failedUploads = uploadResults.filter(r => !r.success);
if (failedUploads.length > 0) {
  console.log('\n💡 For failed uploads, try:');
  console.log('   Option 1: Use Supabase CLI');
  console.log('      supabase storage cp <local-path> ss:///music-installers/<filename>');
  console.log('   Option 2: Upload via Supabase Dashboard');
  console.log('      https://supabase.com/dashboard → Storage → music-installers');
  process.exit(1);
}

console.log('\n🎉 All files uploaded successfully!');
