import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

function localServerlessPlugin() {
  return {
    name: 'local-serverless-api',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = req.url || '';
        if (url.startsWith('/api') || url.startsWith('/actuator')) {
          try {
            let body: any = {};
            if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
              body = await new Promise((resolve) => {
                let data = '';
                req.on('data', (chunk: any) => { data += chunk; });
                req.on('end', () => {
                  try { resolve(data ? JSON.parse(data) : {}); }
                  catch { resolve({}); }
                });
              });
            }
            req.body = body;

            if (!res.status) {
              res.status = function(code: number) { this.statusCode = code; return this; };
            }
            if (!res.json) {
              res.json = function(data: any) {
                this.setHeader('Content-Type', 'application/json');
                this.end(JSON.stringify(data));
                return this;
              };
            }

            const { default: handler } = await import('./api/index');
            await handler(req, res);
          } catch (err: any) {
            console.error('Serverless dev middleware error:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        } else {
          next();
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [
    react(),
    localServerlessPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'SETU Healthcare Workspace',
        short_name: 'SETU',
        description: 'Offline-First Clinical & Field Triage Sync',
        theme_color: '#672B36',
        background_color: '#F7F3E9',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml'
          }
        ]
      },
      devOptions: {
        enabled: true
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        navigateFallback: '/index.html'
      }
    })
  ],
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  preview: {
    host: '0.0.0.0',
    port: 5173
  }
});
