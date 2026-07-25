// Quick script to upload the Music V2 desktop app to Supabase Storage
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env files
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Get Supabase credentials
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables:');
  console.error('   VITE_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✓' : '✗');
  console.error('');
  console.error('Add SUPABASE_SERVICE_ROLE_KEY to your .env file');
  console.error('Get it from: Supabase Dashboard → Settings → API → service_role key');
  process.exit(1);
}

// Use service role key for uploads (bypasses RLS)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// File to upload
const exePath = path.join(__dirname, '..', 'dist', 'win-unpacked', 'Tavari Music Desktop.exe');
const targetFileName = 'tavari-music-desktop-setup.exe'; // Lowercase name
const bucketName = 'music-installers';

async function uploadFile() {
  try {
    // Check if file exists
    if (!fs.existsSync(exePath)) {
      console.error(`❌ File not found: ${exePath}`);
      console.error('');
      console.error('Build the app first: npm run build-desktop');
      process.exit(1);
    }

    const fileStats = fs.statSync(exePath);
    const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(2);
    
    console.log('📦 Uploading Music V2 Desktop App...');
    console.log(`   File: ${exePath}`);
    console.log(`   Size: ${fileSizeMB} MB`);
    console.log(`   Target: ${bucketName}/${targetFileName}`);
    console.log('');

    // Read file as buffer
    const fileBuffer = fs.readFileSync(exePath);
    
    // Upload to Supabase Storage
    console.log('📤 Uploading to Supabase Storage...');
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(targetFileName, fileBuffer, {
        contentType: 'application/x-msdownload', // .exe MIME type
        upsert: true, // Overwrite if exists
        cacheControl: '3600'
      });

    if (error) {
      // If bucket doesn't exist, try to create it
      if (error.message?.includes('Bucket not found') || error.message?.includes('not found')) {
        console.log('⚠️  Bucket not found. Creating bucket...');
        
        // Create bucket (requires service role)
        const { data: bucketData, error: bucketError } = await supabase.storage.createBucket(bucketName, {
          public: true,
          fileSizeLimit: 1048576000, // 1GB
          allowedMimeTypes: [
            'application/x-msdownload',
            'application/octet-stream',
            'application/zip'
          ]
        });

        if (bucketError) {
          console.error('❌ Failed to create bucket:', bucketError.message);
          console.error('');
          console.error('Create the bucket manually in Supabase Dashboard:');
          console.error('   1. Go to Storage');
          console.error('   2. Create bucket: music-installers');
          console.error('   3. Set to Public');
          process.exit(1);
        }

        console.log('✅ Bucket created! Retrying upload...');
        
        // Retry upload
        const { data: retryData, error: retryError } = await supabase.storage
          .from(bucketName)
          .upload(targetFileName, fileBuffer, {
            contentType: 'application/x-msdownload',
            upsert: true,
            cacheControl: '3600'
          });

        if (retryError) {
          throw retryError;
        }

        console.log('✅ Upload successful!');
        console.log('');
        console.log('📥 Download URL:');
        console.log(`   ${supabaseUrl.replace('/rest/v1', '')}/storage/v1/object/public/${bucketName}/${targetFileName}`);
        return;
      }
      
      throw error;
    }

    console.log('✅ Upload successful!');
    console.log('');
    console.log('📥 Download URL:');
    console.log(`   ${supabaseUrl.replace('/rest/v1', '')}/storage/v1/object/public/${bucketName}/${targetFileName}`);
    console.log('');
    console.log('🎉 Users can now download from the Music V2 Dashboard!');
    
  } catch (error) {
    console.error('❌ Upload failed:', error.message);
    console.error('');
    console.error('Troubleshooting:');
    console.error('   1. Check SUPABASE_SERVICE_ROLE_KEY is correct');
    console.error('   2. Ensure bucket "music-installers" exists and is public');
    console.error('   3. Check file size (should be < 1GB)');
    process.exit(1);
  }
}

uploadFile();


