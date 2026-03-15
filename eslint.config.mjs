import js from '@eslint/js';
import globals from 'globals';

const sharedRules = {
  'no-console': 'off',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }]
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '.firebase/**',
      'build/**',
      'apps/web/public/assets/vendor/**',
      'apps/web/public/assets/yjs.bundle.js',
      'coverage/**',
      '**/*.min.js'
    ]
  },
  js.configs.recommended,
  {
    files: ['services/api/**/*.js', 'services/collab-relay/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: sharedRules
  },
  {
    files: ['tests/**/*.mjs', 'tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: sharedRules
  },
  {
    files: ['apps/web/public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
        URLPattern: 'readonly'
      }
    },
    rules: sharedRules
  }
];
