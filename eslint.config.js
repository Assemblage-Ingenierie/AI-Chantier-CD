import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

// Flat config ESLint 9. Objectif : filet de sécurité léger, pas de refonte de style.
// On cible les règles à haute valeur (deps de hooks, erreurs réelles) sans imposer
// un formatage strict sur un code existant volumineux.
export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/sw.js'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Bruit sur un code existant — on relâche sans masquer les vrais bugs.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-cond-assign': ['error', 'except-parens'],
    },
  },
  {
    files: ['src/**/*.{test,spec}.{js,jsx}', 'src/test/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['api/**/*.js'],
    languageOptions: { globals: { ...globals.node }, sourceType: 'module' },
  },
];
