import { defineConfig } from 'vitest/config';

// Plain unit tests for logic without TestBed. The setup file loads the Angular JIT compiler
// because the Angular packages are partially compiled.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    setupFiles: ['src/testing/vitest-setup.ts'],
  },
});
