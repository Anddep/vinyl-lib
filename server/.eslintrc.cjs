/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: ['../.eslintrc.cjs'],
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ['dist', 'node_modules', 'prisma/migrations'],
};
