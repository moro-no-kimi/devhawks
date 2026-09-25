import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".git/**",
      "node_modules/**",
      ".venv/**",
      ".habit-hooks/**",
      "registry-cert.pem",
      "registry-chain.pem"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      complexity: ["error", 8],
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
      "max-depth": ["error", 4],
      "max-params": ["error", 4],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    files: ["tools/delivery/fixtures/**/*.ts", "tools/delivery/fixtures/**/*.tsx"],
    rules: {
      "max-params": "off",
      complexity: "off"
    }
  }
);
