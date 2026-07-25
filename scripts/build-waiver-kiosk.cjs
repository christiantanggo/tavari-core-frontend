// scripts/build-waiver-kiosk.cjs
// Build the Waiver Kiosk desktop installer
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 Building Waiver Kiosk Desktop Installer...\n');

const electronDir = path.join(__dirname, '..', 'build', 'electron');
const mainCjs = path.join(electronDir, 'main.cjs');
const waiverMainCjs = path.join(electronDir, 'waiver-kiosk-main.cjs');
const backupMainCjs = path.join(electronDir, 'main.cjs.backup');

let backupCreated = false;

try {
  // Backup original main.cjs
  if (fs.existsSync(mainCjs)) {
    fs.copyFileSync(mainCjs, backupMainCjs);
    backupCreated = true;
    console.log('✅ Backed up original main.cjs');
  }
  
  // Copy waiver kiosk main to main.cjs
  if (fs.existsSync(waiverMainCjs)) {
    fs.copyFileSync(waiverMainCjs, mainCjs);
    console.log('✅ Using waiver kiosk main file');
  } else {
    throw new Error('waiver-kiosk-main.cjs not found!');
  }
  
  // Set environment variables to disable code signing
  const env = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    SKIP_NOTARIZATION: 'true'
  };
  
  delete env.WIN_CSC_LINK;
  delete env.CSC_LINK;
  
  console.log('\n📦 Building installer with electron-builder...');
  console.log('   Product: Tavari Waiver Kiosk Desktop\n');
  
  // Ensure installers directory exists
  const installersDir = path.join(__dirname, '..', 'dist', 'installers');
  if (!fs.existsSync(installersDir)) {
    fs.mkdirSync(installersDir, { recursive: true });
  }
  
  // Build with custom product name and appId via command line
  // Note: Using --config.win.sign=null causes issues, so we remove it and let package.json handle it
  execSync(
    'npx electron-builder --win nsis --config.appId=com.tavari.waiver-kiosk --config.productName="Tavari Waiver Kiosk Desktop" --config.nsis.artifactName="Tavari-Waiver-Kiosk-Setup-${version}.exe"',
    {
      stdio: 'inherit',
      env: env,
      cwd: path.join(__dirname, '..')
    }
  );
  
  // Move the .exe file to dist/installers/ folder
  const distDir = path.join(__dirname, '..', 'dist');
  const exeFiles = fs.readdirSync(distDir).filter(file => file.startsWith('Tavari-Waiver-Kiosk-Setup-') && file.endsWith('.exe'));
  
  if (exeFiles.length > 0) {
    exeFiles.forEach(exeFile => {
      const sourcePath = path.join(distDir, exeFile);
      const destPath = path.join(installersDir, exeFile);
      fs.copyFileSync(sourcePath, destPath);
      fs.unlinkSync(sourcePath);
      console.log(`   Moved ${exeFile} to dist/installers/`);
    });
    
    // Also move the .blockmap file if it exists
    const blockmapFiles = fs.readdirSync(distDir).filter(file => file.startsWith('Tavari-Waiver-Kiosk-Setup-') && file.endsWith('.exe.blockmap'));
    blockmapFiles.forEach(blockmapFile => {
      const sourcePath = path.join(distDir, blockmapFile);
      const destPath = path.join(installersDir, blockmapFile);
      fs.copyFileSync(sourcePath, destPath);
      fs.unlinkSync(sourcePath);
    });
  }
  
  console.log('\n✅ Waiver Kiosk installer built successfully!');
  console.log('   Location: dist/installers/Tavari-Waiver-Kiosk-Setup-*.exe');
  
} catch (error) {
  console.error('\n❌ Build failed:', error.message);
  process.exit(1);
} finally {
  // Restore original main.cjs
  if (backupCreated && fs.existsSync(backupMainCjs)) {
    fs.copyFileSync(backupMainCjs, mainCjs);
    fs.unlinkSync(backupMainCjs);
    console.log('\n✅ Restored original main.cjs');
  }
}

