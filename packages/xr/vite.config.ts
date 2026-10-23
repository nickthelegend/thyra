/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const pkg = (name: string) => fileURLToPath(new URL(`../${name}/src/index.ts`, import.meta.url));
const gateway = process.env.THYRA_GATEWAY_URL ?? 'http://127.0.0.1:8430';

export default defineConfig({
  plugins: [iwsdkDev()],
  server: {
    host: '0.0.0.0',
    port: 8443,
    strictPort: true,
    open: false,
    // The browser only ever talks to /api on its own origin; the gateway holds the key.
    proxy: { '/api': { target: gateway, changeOrigin: true } },
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    alias: { '@thyra/room': pkg('room'), '@thyra/pano': pkg('pano') },
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
