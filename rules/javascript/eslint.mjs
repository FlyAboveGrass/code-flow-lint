export default {
  name: 'code-flow-lint/javascript',
  files: ['**/*.{js,jsx,cjs,mjs}'],
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  rules: {
    'no-debugger': 'error',
    'no-dupe-keys': 'error',
    'no-unreachable': 'error',
  },
}
