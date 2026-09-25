import js from "@eslint/js";

export default [
  {
    ignores: [".git/**", "node_modules/**"]
  },
  js.configs.recommended,
  {
    files: ["tools/cypress/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly"
      }
    },
    rules: {
      complexity: ["error", 8],
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
      "max-depth": ["error", 4],
      "max-params": ["error", 4],
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ]
    }
  }
];
