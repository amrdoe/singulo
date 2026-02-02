import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/vite.ts', 'src/runtime/client.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['vite', '@babel/core', 'magic-string', 'prettier']
});
