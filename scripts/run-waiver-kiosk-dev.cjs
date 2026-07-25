// scripts/run-waiver-kiosk-dev.cjs
// Run the Waiver Kiosk in development mode (for local testing)
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 Starting Waiver Kiosk in Development Mode...\n');

const frontendDir = path.join(__dirname, '..');
const electronBuildDir = path.join(frontendDir, 'build', 'electron');
const mainCjs = path.join(electronBuildDir, 'main.cjs');
const waiverMainCjs = path.join(electronBuildDir, 'waiver-kiosk-main.cjs');
const backupMainCjs = path.join(electronBuildDir, 'main.cjs.dev-backup');

let backupCreated = false;

try {
  // Backup original main.cjs
  if (fs.existsSync(mainCjs)) {
    fs.copyFileSync(mainCjs, backupMainCjs);
    backupCreated = true;
    console.log('✅ Backed up original main.cjs');
  }

  // Copy waiver-kiosk-main.cjs to main.cjs
  if (fs.existsSync(waiverMainCjs)) {
    fs.copyFileSync(waiverMainCjs, mainCjs);
    console.log('✅ Using waiver kiosk main file');
  } else {
    throw new Error('waiver-kiosk-main.cjs not found!');
  }

  console.log('\n🚀 Starting Electron in development mode...');
  console.log('   Make sure Vite dev server is running (npm run dev)\n');

  // Run electron in development mode
  execSync(
    'cross-env NODE_ENV=development KIOSK_FULLSCREEN=false electron build/electron/main.cjs',
    {
      stdio: 'inherit',
      cwd: frontendDir
    }
  );

} catch (error) {
  if (error.status !== null && error.status !== 0) {
    // Electron was closed normally
    console.log('\n✅ Electron closed');
  } else {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
} finally {
  // Restore original main.cjs
  if (backupCreated && fs.existsSync(backupMainCjs)) {
    fs.copyFileSync(backupMainCjs, mainCjs);
    fs.unlinkSync(backupMainCjs);
    console.log('\n✅ Restored original main.cjs');
  }
}




