import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * GitHub Pages serves static files only and has no SPA fallback, so a direct
 * hit on /teacher/42 would 404. Emitting the shell as 404.html lets the router
 * take over from the same URL instead of bouncing through a redirect.
 */
function pagesSpaFallback() {
  return {
    name: 'pages-spa-fallback',
    apply: 'build' as const,
    async closeBundle() {
      const out = resolve(process.cwd(), 'dist');
      await copyFile(resolve(out, 'index.html'), resolve(out, '404.html'));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), pagesSpaFallback()],
  resolve: { alias: { '@': resolve(process.cwd(), 'src') } },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
