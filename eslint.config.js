import js from '@eslint/js';
import globals from 'globals';

const language = {ecmaVersion: 'latest', sourceType: 'module'};

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.local/**',
      '.wrangler/**',
      'drizzle/**',
      'public/vendor/**',
      'public/geography.mjs',
      'server/assets.generated.mjs',
    ],
  },
  js.configs.recommended,
  {
    files: ['public/**/*.{js,mjs}'],
    languageOptions: {...language, globals: {...globals.browser}},
  },
  {
    // Cloudflare Workers expose the service-worker style globals (fetch, Response, crypto, AbortSignal).
    files: ['server/**/*.mjs'],
    languageOptions: {...language, globals: {...globals.serviceworker}},
  },
  {
    // Tests stub browser globals on top of Node.
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', '*.js', '*.mjs'],
    languageOptions: {...language, globals: {...globals.node, ...globals.browser}},
  },
  {
    rules: {
      'no-empty': ['error', {allowEmptyCatch: true}],
      'no-unused-vars': ['error', {args: 'none', caughtErrors: 'none'}],
    },
  },
];
