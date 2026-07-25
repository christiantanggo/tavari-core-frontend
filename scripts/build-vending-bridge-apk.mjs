/**
 * Build Tavari Vending Bridge APK via Docker and optionally upload to Supabase.
 */
import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const imageName = 'tavari-vending-bridge-build';
const containerName = 'tavari-vending-bridge-out';
const APK_VERSION = '1.0.16';
const outApk = resolve(root, `vending-bridge/dist/Tavari-Vending-Bridge-${APK_VERSION}.apk`);
const releaseApk = resolve(
  root,
  'vending-bridge/android/app/build/outputs/apk/release/app-release.apk'
);

console.log('Building Docker image (first run downloads Android SDK — may take several minutes)...');
execSync(
  `docker build --build-arg CACHEBUST=${Date.now()} -t ${imageName} "${resolve(root, 'vending-bridge')}"`,
  {
    stdio: 'inherit',
    cwd: root
  }
);

try {
  execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });
} catch {
  /* ok */
}

execSync(`docker create --name ${containerName} ${imageName}`, { stdio: 'inherit' });

mkdirSync(resolve(root, 'vending-bridge/dist'), { recursive: true });
execSync(
  `docker cp ${containerName}:/project/app/build/outputs/apk/release/app-release.apk "${outApk}"`,
  { stdio: 'inherit' }
);
execSync(`docker rm ${containerName}`, { stdio: 'inherit' });

mkdirSync(dirname(releaseApk), { recursive: true });
copyFileSync(outApk, releaseApk);

console.log('APK built:', outApk);

if (process.env.SKIP_UPLOAD === '1') {
  console.log('SKIP_UPLOAD=1 — not uploading.');
  process.exit(0);
}

console.log('Uploading to Supabase...');
execSync(`node scripts/upload-vending-bridge-apk.mjs "${outApk}"`, {
  stdio: 'inherit',
  cwd: root,
  env: process.env
});
