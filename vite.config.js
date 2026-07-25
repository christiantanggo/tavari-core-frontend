import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import fs from 'fs'
import path from 'path'
import process from 'process'
import { spawn } from 'child_process'
import { Buffer } from 'buffer'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Split node_modules into several Rollup chunks so production builds use less peak RAM.
 */
function manualChunks(id) {
  if (!id.includes('node_modules')) return undefined
  const mid = id.split(path.sep).join('/')
  if (mid.includes('react-router')) return 'vendor-router'
  // Keep Recharts + d3 in the same chunk as React. A separate vendor-charts chunk caused
  // production-only "Cannot read properties of undefined (reading 'forwardRef')" when
  // vendor-charts initialized before the react chunk finished binding (Rollup + legacy dual build).
  if (
    mid.includes('node_modules/react/') ||
    mid.includes('node_modules/react-dom/') ||
    mid.includes('node_modules/scheduler/') ||
    mid.includes('recharts') ||
    mid.includes('/d3-')
  ) {
    return 'vendor-react'
  }
  if (mid.includes('@supabase')) return 'vendor-supabase'
  if (
    mid.includes('pdfjs') ||
    mid.includes('pdf-lib') ||
    mid.includes('html2pdf') ||
    mid.includes('jspdf') ||
    mid.includes('html2canvas')
  ) {
    return 'vendor-pdf'
  }
  if (mid.includes('react-icons') || mid.includes('lucide-react')) return 'vendor-icons'
  // AWS SDK v3: keep @aws-sdk AND @smithy/@aws-crypto in the SAME chunk. Splitting only
  // @aws-sdk caused TDZ ("Cannot access … before initialization"). Merging AWS into vendor-misc
  // caused init-order bugs (e.g. undefined React.memo). Isolated "vendor-aws" with full tree.
  if (
    mid.includes('@aws-sdk') ||
    mid.includes('/@smithy/') ||
    mid.includes('/@aws-crypto/') ||
    mid.includes('node_modules/aws-sdk/')
  ) {
    return 'vendor-aws'
  }
  if (mid.includes('node_modules/openai')) return 'vendor-openai'
  // Never dump "everything else" into one vendor-misc chunk: it creates circular init
  // order and breaks at runtime (e.g. undefined React.memo). Let Rollup place unlisted deps.
  return undefined
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['iOS >= 13', 'Safari >= 13', 'Chrome >= 64'],
      modernPolyfills: true,
      // The dedicated legacy waiver kiosk is served as a separate ES5 app.
      // Disabling Vite's extra legacy bundle pass avoids Vercel OOM kills.
      renderLegacyChunks: false,
    }),
    // @vitejs/plugin-legacy injects polyfills with a relative `assets/...` src.
    // On deep SPA routes (e.g. /dashboard/hr) that resolves to /dashboard/hr/assets/…
    // which Vercel rewrites to index.html → MIME type error for module scripts.
    {
      name: 'fix-index-absolute-asset-paths',
      enforce: 'post',
      transformIndexHtml(html) {
        return html
          .replace(/\ssrc="assets\//g, ' src="/assets/')
          .replace(/\shref="assets\//g, ' href="/assets/');
      },
    },
    {
      name: 'redirect-clover-waiver-launch',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const raw = req.url || '';
          const pathOnly = raw.split('?')[0];
          const query = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';

          if (pathOnly === '/oauth/callback' && query) {
            res.statusCode = 302;
            res.setHeader('Location', `/clover-waivers/oauth/callback${query}`);
            res.end();
            return;
          }

          if ((pathOnly === '/' || pathOnly === '/index.html') && query) {
            const params = new URLSearchParams(query.slice(1));
            const merchantId = params.get('merchant_id') || params.get('merchantId');
            const clientId = (params.get('client_id') || '').replace(/C$/, '');
            if (merchantId && clientId === 'M1NED1S5PRAJ') {
              res.statusCode = 302;
              res.setHeader('Location', `/clover-waivers/${query}`);
              res.end();
              return;
            }
          }

          next();
        });
      },
    },
    {
      name: 'serve-static-kiosks',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const raw = req.url || '';
          const pathOnly = raw.split('?')[0];
          const query = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
          if (
            pathOnly === '/task-manager-kiosk' ||
            pathOnly === '/task-manager-kiosk/' ||
            pathOnly === '/waiver-browser-kiosk' ||
            pathOnly === '/waiver-browser-kiosk/'
          ) {
            const base = pathOnly.replace(/\/$/, '');
            req.url = `${base}/index.html${query}`;
          } else if (
            pathOnly === '/clover-waivers' ||
            pathOnly === '/clover-waivers/' ||
            (pathOnly.startsWith('/clover-waivers/') &&
              // SPA routes only — do not rewrite source files (main.jsx) or other static assets
              !/\.[a-zA-Z0-9]+$/.test(pathOnly))
          ) {
            req.url = `/clover-waivers/index.html${query}`;
          }
          next();
        });
      },
    },
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
    },
    // Dev-only: auto-start Sysco Playwright bridge so Recipe Manager "Refresh Prices"
    // can scrape shop.sysco.ca without a second terminal.
    {
      name: 'recipe-sysco-bridge-dev',
      configureServer(server) {
        if (process.env.RECIPE_SYSCO_BRIDGE === '0') return;

        const env = loadEnv(server.config.mode, server.config.root, '');
        for (const k of Object.keys(env)) {
          if (process.env[k] === undefined) process.env[k] = env[k];
        }

        const bridgePort = Number(process.env.RECIPE_SYSCO_BRIDGE_PORT || 3927);

        const isBridgeRunning = async () => {
          try {
            const res = await fetch(`http://127.0.0.1:${bridgePort}/health`, {
              signal: AbortSignal.timeout(1500),
            });
            if (!res.ok) return false;
            const data = await res.json();
            return data?.service === 'recipe-sysco-bridge';
          } catch {
            return false;
          }
        };

        void (async () => {
          if (await isBridgeRunning()) {
            console.log(`[recipe-sysco-bridge] reusing existing bridge on http://127.0.0.1:${bridgePort}`);
            return;
          }

          const bridge = spawn(process.execPath, ['scripts/recipe-sysco-bridge.mjs'], {
            cwd: process.cwd(),
            stdio: 'inherit',
            env: process.env,
          });

          bridge.on('error', (err) => {
            console.warn('[recipe-sysco-bridge] failed to start:', err.message);
          });

          const stopBridge = () => {
            if (!bridge.killed) bridge.kill();
          };
          server.httpServer?.on('close', stopBridge);
          process.on('exit', stopBridge);
        })();
      },
    },
    // Dev-only: emulate Vercel's `/api/render-pay-statement-pdf` serverless function
    // so the pay-statement PDF flow works against `npm run dev` (port 5173) without
    // having to run `vercel dev` or deploy. Production keeps using the real Vercel
    // serverless function from the `api/` directory.
    {
      name: 'serve-pay-statement-pdf-api',
      configureServer(server) {
        // Load .env vars (no VITE_ prefix filter) into process.env so the API
        // function can read SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY at request time.
        const env = loadEnv(server.config.mode, server.config.root, '')
        for (const k of Object.keys(env)) {
          if (process.env[k] === undefined) process.env[k] = env[k]
        }

        server.middlewares.use('/api/render-pay-statement-pdf', async (req, res) => {
          try {
            // Vercel adds res.status() / res.json() helpers on top of Node's raw
            // http response. Vite middleware gives us the raw response, so polyfill
            // the same helpers before invoking the handler.
            if (typeof res.status !== 'function') {
              res.status = (code) => {
                res.statusCode = code
                return res
              }
            }
            const mod = await import('./api/render-pay-statement-pdf.js')
            await mod.default(req, res)
          } catch (err) {
            console.error('[dev /api/render-pay-statement-pdf] error:', err)
            if (!res.headersSent) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  error: 'Dev middleware failed',
                  detail: String(err?.stack || err),
                })
              )
            }
          }
        })
      },
    },
  ],
  define: {
    global: 'globalThis',
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      buffer: 'buffer',
      '@safecomply/ui': path.resolve(__dirname, './packages/safecomply-ui/src/index.jsx'),
    },
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  base: '/',
  build: {
    reportCompressedSize: false,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        cloverWaivers: path.resolve(__dirname, 'clover-waivers/index.html'),
      },
      output: {
        manualChunks,
      },
    },
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