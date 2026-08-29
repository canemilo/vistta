import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", ".wrangler/**", "**/.angular/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "warn",
      "no-console": ["warn", { allow: ["error", "warn"] }],
      eqeqeq: ["error", "always"],
    },
  },
  prettier
);
