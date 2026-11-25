import { defineConfig } from 'vite';
import { steamBridgePlugin } from './tools/steam-bridge/vite-plugin';

export default defineConfig({
  plugins: [steamBridgePlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
