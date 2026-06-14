/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'LidarEngine',
      fileName: 'lidar-engine',
      formats: ['es'],
    },
    rollupOptions: { external: ['three', 'three-mesh-bvh', /^three\/examples\//] },
  },
  test: {
    environment: 'node',
  },
});
