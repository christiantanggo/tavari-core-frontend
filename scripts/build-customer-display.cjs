// scripts/build-customer-display.cjs
// Build the POS Customer Display desktop installer (separate entry; does NOT swap main.cjs).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 Building Tavari Customer Display Desktop Installer...\n');

try {
  execSync('node scripts/write-customer-display-runtime.cjs', {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  const env = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    SKIP_NOTARIZATION: 'true'
  };
  delete env.WIN_CSC_LINK;
  delete env.CSC_LINK;

  const installersDir = path.join(__dirname, '..', 'dist', 'installers');
  if (!fs.existsSync(installersDir)) {
    fs.mkdirSync(installersDir, { recursive: true });
  }

  console.log('📦 electron-builder (customer display config: build/electron/customer-display-electron-builder.json)\n');

  execSync('npx electron-builder --win nsis --config build/electron/customer-display-electron-builder.json', {
    stdio: 'inherit',
    env,
    cwd: path.join(__dirname, '..')
  });

  const distDir = path.join(__dirname, '..', 'dist');
  const exeFiles = fs
    .readdirSync(distDir)
    .filter((file) => file.startsWith('Tavari-Customer-Display-Setup-') && file.endsWith('.exe'));

  if (exeFiles.length > 0) {
    exeFiles.forEach((exeFile) => {
      const sourcePath = path.join(distDir, exeFile);
      const destPath = path.join(installersDir, exeFile);
      fs.copyFileSync(sourcePath, destPath);
      fs.unlinkSync(sourcePath);
      console.log(`   Moved ${exeFile} to dist/installers/`);
    });

    const blockmapFiles = fs
      .readdirSync(distDir)
      .filter((file) => file.startsWith('Tavari-Customer-Display-Setup-') && file.endsWith('.exe.blockmap'));
    blockmapFiles.forEach((blockmapFile) => {
      const sourcePath = path.join(distDir, blockmapFile);
      const destPath = path.join(installersDir, blockmapFile);
      fs.copyFileSync(sourcePath, destPath);
      fs.unlinkSync(sourcePath);
    });
  }

  console.log('\n✅ Customer Display installer built successfully!');
  console.log('   Location: dist/installers/Tavari-Customer-Display-Setup-*.exe');
} catch (error) {
  console.error('\n❌ Build failed:', error.message);
  process.exit(1);
}
