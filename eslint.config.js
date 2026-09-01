import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.angular/**"] },
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
  {
    // Aquí console.log no es un olvido de depuración: son las herramientas de
    // línea de órdenes y el arranque del servidor, y su salida es la interfaz.
    files: [
      "scripts/**/*.ts",
      "scripts/**/*.mjs",
      "seed/**/*.ts",
      "src/server.ts",
      "src/migrate.ts",
    ],
    rules: { "no-console": "off" },
  },
  {
    // Los scripts .mjs los ejecuta `node` a secas, sin transpilador: usan los
    // globales de Node y no pasan por la configuración de TypeScript.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
  prettier
);
