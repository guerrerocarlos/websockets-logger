import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  sourcemap: true,
  splitting: false,
  clean: true,
  dts: true,
  format: ['esm', 'cjs'],
  outDir: 'dist',
  target: 'es2020',
  minify: false,
  keepNames: true,
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs'
    };
  }
});
