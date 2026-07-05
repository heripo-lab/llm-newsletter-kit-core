import { builtinModules, createRequire } from 'node:module';
import dts from 'rollup-plugin-dts';
import typescript from 'rollup-plugin-typescript2';

const require = createRequire(import.meta.url);

const pkg = require('./package.json');

const deps = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
];

const external = (id) =>
  builtinModules.includes(id) ||
  id.startsWith('node:') ||
  deps.some((dep) => id === dep || id.startsWith(`${dep}/`));

const jsConfig = {
  input: 'src/index.ts',
  external,
  treeshake: true,
  output: {
    file: 'dist/index.js',
    format: 'esm',
    sourcemap: true,
  },
  plugins: [
    typescript({
      clean: true,
      tsconfig: './tsconfig.build.json',
      tsconfigOverride: {
        compilerOptions: {
          declaration: false,
          declarationMap: false,
        },
      },
    }),
  ],
};

const dtsConfig = {
  input: 'src/index.ts',
  output: [{ file: 'dist/index.d.ts', format: 'esm' }],
  plugins: [
    dts({
      tsconfig: './tsconfig.build.json',
      respectExternal: false,
    }),
  ],
};

export default [jsConfig, dtsConfig];
