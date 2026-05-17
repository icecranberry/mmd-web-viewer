import { defineConfig } from 'vite';

export default defineConfig({
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
