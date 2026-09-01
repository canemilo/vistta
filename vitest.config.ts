import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Solo las pruebas del backend; el frontend (web/) tiene su propio runner.
    include: ["test/**/*.spec.ts"],
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    // Todos los ficheros comparten la misma base y la vacían entre pruebas, así
    // que no pueden correr a la vez. La concurrencia que importa —dos aperturas
    // del mismo pase— se provoca dentro de un test, contra Postgres de verdad.
    fileParallelism: false,
  },
});
