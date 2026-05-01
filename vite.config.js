import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` produces relative asset URLs in dist/, which is required
// for Capacitor — the WebView serves the bundle from a local origin and
// absolute "/assets/..." paths would break. Vercel deployments still
// resolve fine because the index.html sits at the domain root.
export default defineConfig({
  base: './',
  plugins: [react()],
});
