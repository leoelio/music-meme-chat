import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    allowedHosts: ['.loca.lt', '.trycloudflare.com'],
    proxy: {
      '/api/audio': 'http://127.0.0.1:8787',
    },
  },
  preview: {
    allowedHosts: ['.loca.lt', '.trycloudflare.com'],
    proxy: {
      '/api/audio': 'http://127.0.0.1:8787',
    },
  },
});
