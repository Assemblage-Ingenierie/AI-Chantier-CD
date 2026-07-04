import { defineConfig } from 'vitest/config';

// Config de test isolée de vite.config.js (build) — évite d'embarquer le plugin React
// dans le runner. Les tests ciblent la logique pure (persistance, merge, sync) : pas de JSX.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    setupFiles: ['./src/test/setup.js'],
  },
});
