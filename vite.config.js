import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 3120,
    open: true,
    cors: true
  },
  assetsInclude: ['**/*.pmx', '**/*.vmd', '**/*.wav', '**/*.sph', '**/*.spa'],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true
  }
});
