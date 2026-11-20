import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  tsconfig: './tsconfig.build.json',
  sourcemap: true,
  dts: true,
  clean: true,
  // Keep `dist/index.js`; the node platform defaults to `.mjs` otherwise.
  fixedExtension: false,
});
