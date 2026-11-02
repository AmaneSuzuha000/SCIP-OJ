import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Injects the runtime configuration script.
 *
 * It must be an absolute, base-prefixed URL: a project page lives under
 * /<repo>/, so a bare '/config.js' would escape the deployment, and a relative
 * './config.js' would break on any deep link. The file itself is written by the
 * deploy step; locally it is an empty object and .env.local takes over.
 */
function runtimeConfig() {
  return {
    name: 'runtime-config',
    transformIndexHtml(_html: string, ctx: { server?: unknown }) {
      const base = ctx.server ? '/' : (process.env.VITE_BASE ?? '/');
      return [
        {
          tag: 'script',
          attrs: { src: base + 'config.js' },
          injectTo: 'head-prepend' as const,
        },
      ];
    },
  };
}

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
  // A project page is served from /<repo>/; the deploy sets VITE_BASE to match.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss(), runtimeConfig(), pagesSpaFallback()],
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
