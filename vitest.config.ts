import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/{room,pano,gateway}/test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
