import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => {
  const preview = mode === 'preview';
  return {
    plugins: [react()],
    base: preview ? './' : '/',
    resolve: {
      alias: {
        '@shared': r('./src/shared'),
        '@': r('./src/web'),
        '@fixtures': r('./fixtures'),
      },
    },
    define: {
      __PREVIEW__: JSON.stringify(preview),
    },
    server: {
      port: 5173,
      // Lets a phone open the dev server through a Cloudflare quick tunnel (HTTPS, needed for the camera).
      allowedHosts: ['.trycloudflare.com'],
      // 127.0.0.1, not localhost: on Windows and recent Node, localhost can resolve to IPv6 (::1)
      // while the API listens on IPv4, and the proxy then cannot reach it.
      proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
    },
    build: {
      outDir: preview ? 'dist-preview' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: !preview,
      cssCodeSplit: !preview,
      // The preview is a single self-contained file: inline every asset.
      assetsInlineLimit: preview ? 100_000_000 : 4096,
      chunkSizeWarningLimit: 2000,
      rollupOptions: preview ? { output: { inlineDynamicImports: true } } : undefined,
    },
  };
});
