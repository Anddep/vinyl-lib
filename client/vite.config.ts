import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = process.env.SERVER_PORT ?? '4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: `http://server:${serverPort}`,
        changeOrigin: true,
      },
      // Uploaded covers are served from the API container but do not sit
      // under /api, so they need their own rule.
      '/uploads': {
        target: `http://server:${serverPort}`,
        changeOrigin: true,
      },
    },
  },
});
