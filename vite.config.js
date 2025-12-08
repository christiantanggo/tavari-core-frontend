import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Middleware to serve installer files directly (bypasses React Router)
    {
      name: 'serve-installers',
      configureServer(server) {
        server.middlewares.use('/installers', (req, res, next) => {
          console.log('\n🔍 [INSTALLER MIDDLEWARE] Request intercepted:', req.url);
          console.log('   Method:', req.method);
          console.log('   Headers:', JSON.stringify(req.headers, null, 2));
          
          // Serve files from public/installers directly
          const url = new URL(req.url, `http://${req.headers.host}`);
          const filePath = url.pathname.replace('/installers', '').replace(/^\//, '');
          
          console.log('   Extracted filePath:', filePath);
          
          // Only serve .zip, .exe, .dmg, .AppImage, .bat, .ps1 files
          if (/\.(zip|exe|dmg|AppImage|bat|ps1)$/i.test(filePath)) {
            const publicPath = path.join(process.cwd(), 'public', 'installers', filePath);
            
            console.log('   Full publicPath:', publicPath);
            console.log('   File exists?', fs.existsSync(publicPath));
            
            if (fs.existsSync(publicPath)) {
              const stat = fs.statSync(publicPath);
              const ext = path.extname(publicPath).toLowerCase();
              const mimeTypes = {
                '.zip': 'application/zip',
                '.exe': 'application/x-msdownload',
                '.dmg': 'application/x-apple-diskimage',
                '.appimage': 'application/x-executable',
                '.bat': 'application/x-msdos-program',
                '.ps1': 'application/x-powershell'
              };
              
              console.log('   ✅ Serving file:', path.basename(publicPath));
              console.log('   Size:', stat.size, 'bytes');
              console.log('   MIME type:', mimeTypes[ext] || 'application/octet-stream');
              
              // Verify file is actually a ZIP by reading first 4 bytes
              const fileHandle = fs.openSync(publicPath, 'r');
              const buffer = Buffer.allocUnsafe(4);
              fs.readSync(fileHandle, buffer, 0, 4, 0);
              fs.closeSync(fileHandle);
              const magicBytes = buffer.toString('hex');
              console.log('   Magic bytes (first 4):', magicBytes);
              console.log('   Is valid ZIP?', magicBytes.startsWith('504b03') || magicBytes.startsWith('504b05') || magicBytes.startsWith('504b07'));
              
              res.writeHead(200, {
                'Content-Type': mimeTypes[ext] || 'application/octet-stream',
                'Content-Length': stat.size,
                'Content-Disposition': `attachment; filename="${path.basename(publicPath)}"`,
                'Cache-Control': 'no-cache'
              });
              
              const stream = fs.createReadStream(publicPath);
              stream.on('error', (err) => {
                console.error('   ❌ Stream error:', err);
                if (!res.headersSent) {
                  res.writeHead(500);
                  res.end('Stream error');
                }
              });
              stream.pipe(res);
              console.log('   ✅ Stream started, piping to response');
              return;
            } else {
              console.log('   ❌ File not found at:', publicPath);
            }
          } else {
            console.log('   ⚠️  Not an installer file extension:', filePath);
          }
          console.log('   ⏭️  Calling next() - passing to next middleware');
          next();
        });
      }
    }
  ],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer',
    },
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  base: '/',
  build: {
    rollupOptions: {
      input: './index.html'
    }
  },
  server: {
    port: 5173,
    host: true,
    fs: {
      strict: false
    }
  },
  publicDir: 'public'
})