import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", ".wrangler/**", "**/.angular/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Los scripts de mantenimiento corren en Node, no en el Worker.
    // Se declaran a mano los globales que usan para no añadir la dependencia
    // `globals` solo por esto (y no tocar el lockfile que el CI congela).
    files: ["scripts/**/*.mjs", "*.config.js"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", Buffer: "readonly" },
    },
  },
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
