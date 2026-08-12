import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// The customer page is served from ui/ but imports the same verification code
// the tests use. compact-runtime resolves to its `browser` build, which is
// wasm-bindgen output — hence the two plugins.
export default defineConfig({
  root: 'ui',
  // Serve brand assets directly rather than duplicating them into a public dir.
  publicDir: '../brand',
  plugins: [wasm(), topLevelAwait()],
  server: { host: '127.0.0.1', port: 5273 },
  build: { outDir: '../dist-ui', emptyOutDir: true, target: 'esnext' },
});
