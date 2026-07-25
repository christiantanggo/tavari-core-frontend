// scripts/build-exe-only.cjs
// Build the music kiosk NSIS installer from an isolated Electron package.
//
// The root app has a very large dependency tree and electron-builder can hang while
// scanning/copying it. The music kiosk shell only needs the Electron files under
// build/electron plus a few runtime dependencies, so package that smaller app.
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = path.join(os.tmpdir(), 'tavari-music-packager');
const tempElectronDir = path.join(tempRoot, 'build', 'electron');
const outputFileName = 'Tavari-Music-Desktop-Setup-1.0.1.exe';
const outputBlockMapName = `${outputFileName}.blockmap`;

const electronFiles = [
  'main.cjs',
  'preload.cjs',
  'sessionManager.cjs',
  'fileCache.cjs',
  'installationManager.cjs',
  'autoUpdater.cjs'
];

function copyFileFromElectron(fileName) {
  const source = path.join(projectRoot, 'build', 'electron', fileName);
  const destination = path.join(tempElectronDir, fileName);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing required Electron file: ${source}`);
  }
  fs.copyFileSync(source, destination);
}

function copyIfExists(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.cpSync(source, destination, { recursive: true, force: true });
}

console.log('🔨 Building Tavari Music Desktop installer (.exe)...');
console.log('   Using isolated music kiosk packager to avoid root dependency scan hangs');
console.log('   Skipping code signing to avoid permission errors\n');

try {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempElectronDir, { recursive: true });

  for (const fileName of electronFiles) {
    copyFileFromElectron(fileName);
  }

  copyIfExists(
    path.join(projectRoot, 'build', 'electron', 'assets'),
    path.join(tempElectronDir, 'assets')
  );

  const packageJson = {
    name: 'tavari-music-desktop-packager',
    version: '1.0.1',
    description: 'Tavari Music Desktop kiosk shell',
    author: 'Tavari',
    main: 'build/electron/main.cjs',
    build: {
      appId: 'com.tavari.music-desktop',
      productName: 'Tavari Music Desktop',
      directories: {
        output: 'dist',
        buildResources: 'build'
      },
      files: [
        'build/electron/**/*',
        'package.json'
      ],
      win: {
        target: [
          {
            target: 'nsis',
            arch: ['x64']
          }
        ],
        signingHashAlgorithms: [],
        signDlls: false,
        verifyUpdateCodeSignature: false
      },
      nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        artifactName: 'Tavari-Music-Desktop-Setup-${version}.exe',
        script: null
      }
    },
    dependencies: {
      'electron-log': '^5.4.3',
      'electron-updater': '^6.6.2',
      'node-machine-id': '^1.1.12',
      uuid: '^9.0.1'
    },
    devDependencies: {
      electron: '^28.3.3',
      'electron-builder': '^24.13.3'
    }
  };

  fs.writeFileSync(
    path.join(tempRoot, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );

  const env = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    SKIP_NOTARIZATION: 'true'
  };

  delete env.WIN_CSC_LINK;
  delete env.CSC_LINK;

  execSync('npm install', {
    cwd: tempRoot,
    stdio: 'inherit',
    env
  });

  execSync('npx electron-builder --win nsis --config.win.verifyUpdateCodeSignature=false --publish never', {
    cwd: tempRoot,
    stdio: 'inherit',
    env
  });

  const distDir = path.join(projectRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  fs.copyFileSync(
    path.join(tempRoot, 'dist', outputFileName),
    path.join(distDir, outputFileName)
  );

  const blockMapSource = path.join(tempRoot, 'dist', outputBlockMapName);
  if (fs.existsSync(blockMapSource)) {
    fs.copyFileSync(blockMapSource, path.join(distDir, outputBlockMapName));
  }

  const installerStats = fs.statSync(path.join(distDir, outputFileName));
  console.log('\n✅ Build complete!');
  console.log(`   Installer: ${path.join(distDir, outputFileName)}`);
  console.log(`   Size: ${(installerStats.size / 1024 / 1024).toFixed(2)} MB`);
} catch (error) {
  console.error('\n❌ Build failed:', error.message);
  process.exit(1);
}

