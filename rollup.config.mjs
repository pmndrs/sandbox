import esbuild from 'rollup-plugin-esbuild';

// `preserveModules` keeps one output file per source module, so consumers' bundlers
// can tree-shake per module. declarations come from `build:dts` (tsc).
// esbuild rather than @rollup/plugin-typescript: sources import with `.ts` extensions.
export default {
    input: ['./src/index.ts', './src/react/index.ts'],
    external: (id) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
    output: {
        dir: 'dist',
        format: 'es',
        sourcemap: true,
        preserveModules: true,
        preserveModulesRoot: 'src',
    },
    plugins: [esbuild({ target: 'es2022', jsx: 'automatic' })],
};
