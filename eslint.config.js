import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const maxLines = 800;

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'coverage/**']
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser
      }
    }
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,cjs,mjs}'],
    rules: {
      'max-lines': [
        'error',
        {
          max: maxLines,
          skipBlankLines: true,
          skipComments: true
        }
      ]
    }
  }
];
