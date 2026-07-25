// scripts/build-pos-print-agent.cjs
// Build the Tavari Receipt Printer Windows installer (tray helper).
// Does NOT overwrite music kiosk main.cjs.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building Tavari Receipt Printer installer...\n');

try {
  const env = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    SKIP_NOTARIZATION: 'true',
  };
  delete env.WIN_CSC_LINK;
  delete env.CSC_LINK;

  const installersDir = path.join(__dirname, '..', 'dist', 'installers');
  if (!fs.existsSync(installersDir)) {
    fs.mkdirSync(installersDir, { recursive: true });
  }

  // Keep a packaged copy next to the Electron main for resolvePrintAgentLib fallback
  const libSrc = path.join(__dirname, '..', 'tools', 'pos-print-agent', 'lib.cjs');
  const libDest = path.join(__dirname, '..', 'build', 'electron', 'pos-print-agent-lib.cjs');
  fs.copyFileSync(libSrc, libDest);
  console.log('Copied print agent lib into build/electron/\n');

  console.log('electron-builder (config: build/electron/pos-print-agent-electron-builder.json)\n');

  execSync(
    'npx electron-builder --win nsis --config build/electron/pos-print-agent-electron-builder.json',
    {
      stdio: 'inherit',
      env,
      cwd: path.join(__dirname, '..'),
    }
  );

  const distDir = path.join(__dirname, '..', 'dist');
  const exeFiles = fs
    .readdirSync(distDir)
    .filter((file) => file.startsWith('Tavari-Receipt-Printer-Setup-') && file.endsWith('.exe'));

  if (exeFiles.length === 0) {
    throw new Error('No Tavari-Receipt-Printer-Setup-*.exe found in dist/');
  }

  exeFiles.forEach((exeFile) => {
    const sourcePath = path.join(distDir, exeFile);
    const destPath = path.join(installersDir, exeFile);
    fs.copyFileSync(sourcePath, destPath);
    fs.unlinkSync(sourcePath);
    console.log(`Moved ${exeFile} to dist/installers/`);
  });

  const blockmapFiles = fs
    .readdirSync(distDir)
    .filter((file) => file.startsWith('Tavari-Receipt-Printer-Setup-') && file.endsWith('.exe.blockmap'));
  blockmapFiles.forEach((blockmapFile) => {
    const sourcePath = path.join(distDir, blockmapFile);
    const destPath = path.join(installersDir, blockmapFile);
    fs.copyFileSync(sourcePath, destPath);
    fs.unlinkSync(sourcePath);
  });

  // Also place a stable filename for download links
  const latest = exeFiles.sort().pop();
  const stableName = 'Tavari-Receipt-Printer-Setup.exe';
  fs.copyFileSync(path.join(installersDir, latest), path.join(installersDir, stableName));
  console.log(`Stable copy: dist/installers/${stableName}`);

  console.log('\nReceipt Printer installer built successfully!');
  console.log('Location: dist/installers/Tavari-Receipt-Printer-Setup-*.exe');
} catch (error) {
  console.error('\nBuild failed:', error.message);
  process.exit(1);
}
