// scripts/create-portable-zip.js
// Creates a portable ZIP file from the unpacked Electron app
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const distPath = path.join(__dirname, '../dist');
const winUnpackedPath = path.join(distPath, 'win-unpacked');
const zipPath = path.join(distPath, 'Tavari-Music-Desktop-Portable.zip');

// Check if win-unpacked exists
if (!fs.existsSync(winUnpackedPath)) {
  console.error('❌ win-unpacked folder not found. Run "npm run build-desktop" first.');
  process.exit(1);
}

// Remove old ZIP if exists
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
  console.log('🗑️  Removed old ZIP file');
}

// Create ZIP using archiver (handles large files better than PowerShell)
const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', {
  zlib: { level: 9 } // Maximum compression
});

output.on('close', () => {
  const sizeMB = (archive.pointer / (1024 * 1024)).toFixed(2);
  console.log(`✅ Portable ZIP created: ${zipPath}`);
  console.log(`   Size: ${sizeMB} MB`);
  console.log(`   Total bytes: ${archive.pointer}`);
});

archive.on('error', (err) => {
  console.error('❌ Error creating ZIP:', err);
  process.exit(1);
});

// Pipe archive data to the file
archive.pipe(output);

// Add all files from win-unpacked directory
console.log('📦 Creating portable ZIP file...');
archive.directory(winUnpackedPath, false);

// Finalize the archive
archive.finalize();
