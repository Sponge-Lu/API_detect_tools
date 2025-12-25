import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // 忽略的目录
  {
    ignores: ['node_modules/', 'dist/', 'dist-renderer/', 'release/', '*.config.js', '*.config.cjs', '*.config.mjs'],
  },

  // 基础配置
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React 和 Prettier 配置
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      prettier,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // React 相关
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/display-name': 'off',

      // React Hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // TypeScript 相关
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',

      // 代码风格
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',

      // Prettier
      'prettier/prettier': ['warn', {}, { usePrettierrc: true }],

      // 禁用与 Prettier 冲突的规则
      ...prettierConfig.rules,
    },
  }
);

