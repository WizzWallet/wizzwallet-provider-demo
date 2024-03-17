module.exports = {
  'root': true,
  'env': {
    'browser': true,
    'es6': true,
    'jest': true,
    'node': true
  },
  'extends': [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  'ignorePatterns': [
    'dist'
  ],
  'parser': '@typescript-eslint/parser',
  'plugins': [
    'react',
    'react-hooks',
    'react-refresh'
  ],
  'rules': {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/ban-types': 'off',
    'react-refresh/only-export-components': [
      'warn',
      {
        'allowConstantExport': true
      }
    ],
    // 'react/jsx-first-prop-new-line': [2, 'multiline'],
    // 'react/jsx-max-props-per-line': [
    //   2,
    //   {
    //     'maximum': {
    //       'single': 1,
    //       'multi': 1
    //     }
    //   }
    // ],
    'arrow-parens': ['error', 'always'],
    'quotes': ['error', 'single', { 'avoidEscape': true }],
    'jsx-quotes': [2, 'prefer-double'],
    'semi': [
      'error',
      'always'
    ],
    'prefer-const': [
      2,
      {
        'ignoreReadBeforeAssign': false
      }
    ],
    'object-curly-spacing': [
      'error',
      'always'
    ],
    'no-undef': 'off',
    'no-prototype-builtins': 'off'
  }
};
