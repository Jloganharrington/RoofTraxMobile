import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Standalone vitest config — intentionally does NOT reuse vite.config.ts
// because that file throws if PORT / BASE_PATH env vars are absent.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    // Dedupe React so test environment mirrors the app
    dedupe: ['react', 'react-dom'],
  },
});
