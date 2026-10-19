import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tst/**/*.test.ts'],
        exclude: ['llm/**', 'node_modules/**'],
    },
});
