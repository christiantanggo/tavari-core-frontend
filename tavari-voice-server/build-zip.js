// Build Linux-compatible zip for AWS Elastic Beanstalk
import { createWriteStream } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join, relative, sep } from 'path';
import archiver from 'archiver';

const OUTPUT_FILE = 'tavari-voice-server-deployment.zip';
const SOURCE_DIR = process.cwd();

const EXCLUDE_PATTERNS = [
  '*.zip',
  '*.log',
  '.git',
  'node_modules/.cache',
  'node_modules/.bin',
  '.DS_Store',
  'test-*.js',
  '*.md',
  'temp_*',
  'build-zip.js',
  'deploy.ps1',
  'deploy.sh',
  'v35-*',
  'v35-extracted',
  'v35-check',
  'index-v35*.js',
];

async function shouldInclude(filePath) {
  const relativePath = relative(SOURCE_DIR, filePath);
  if (!relativePath) return true;

  for (const pattern of EXCLUDE_PATTERNS) {
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$'
    );
    if (regex.test(relativePath) || regex.test(filePath)) {
      return false;
    }
  }
  return true;
}

async function buildZip() {
  console.log('📦 Building deployment zip (Linux-compatible)...');
  console.log(`📁 Source directory: ${SOURCE_DIR}`);

  const output = createWriteStream(OUTPUT_FILE);
  const archive = archiver.create('zip', { 
    zlib: { level: 9 },
    store: false
  });

  archive.pipe(output);

  let fileCount = 0;
  let dirCount = 0;

  async function addDirectory(dirPath) {
    const entries = await readdir(dirPath);

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const relativePath = relative(SOURCE_DIR, fullPath);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        if (await shouldInclude(fullPath)) {
          dirCount++;
          await addDirectory(fullPath);
        }
      } else {
        if (await shouldInclude(fullPath)) {
          // Convert Windows paths to forward slashes for Linux compatibility
          const zipPath = relativePath.split(sep).join('/');
          archive.file(fullPath, { name: zipPath });
          fileCount++;
          if (fileCount % 100 === 0) {
            process.stdout.write(`\r📦 Added ${fileCount} files...`);
          }
        }
      }
    }
  }

  try {
    await addDirectory(SOURCE_DIR);
    process.stdout.write(`\r✅ Added ${fileCount} files and ${dirCount} directories\n`);

    await archive.finalize();

    return new Promise((resolve, reject) => {
      output.on('close', () => {
        const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
        console.log(`✅ Deployment zip created: ${OUTPUT_FILE}`);
        console.log(`📊 Size: ${sizeMB} MB`);
        console.log(`\n🚀 Ready to upload to AWS Elastic Beanstalk!`);
        resolve();
      });

      archive.on('error', reject);
    });
  } catch (error) {
    console.error('❌ Error building zip:', error);
    throw error;
  }
}

buildZip().catch(console.error);

