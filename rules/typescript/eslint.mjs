import tseslint from 'typescript-eslint'

export default {
  name: 'code-flow-lint/typescript',
  files: ['**/*.{ts,tsx,cts,mts}'],
  languageOptions: { parser: tseslint.parser },
  rules: {
    'no-debugger': 'error',
    'no-dupe-keys': 'error',
    'no-nested-ternary': 'error',
    'no-unreachable': 'error',
    'no-sparse-arrays': 'error',
  },
}
