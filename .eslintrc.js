/** @type {import('eslint').Linter.Config} */
module.exports = {
  // `next/typescript` registers @typescript-eslint/{parser,eslint-plugin}
  // so rule references like `@typescript-eslint/no-explicit-any` (in
  // eslint-disable comments and individual file overrides) resolve. Without
  // it, those rule names trip "Definition for rule … was not found" errors
  // even though the parser is set up. See dashboard#198.
  extends: ["next/core-web-vitals", "next/typescript"],
  rules: {
    "react/no-unescaped-entities": "off",
    "@next/next/no-img-element": "warn",
  },
};
