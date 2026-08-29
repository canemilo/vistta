import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      // Solo las pruebas del Worker; el frontend (web/) tiene su propio runner.
      include: ["test/**/*.spec.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          miniflare: {
            compatibilityDate: "2024-12-30",
            compatibilityFlags: ["nodejs_compat"],
            d1Databases: ["DB"],
            r2Buckets: ["MEDIA"],
            bindings: {
              TEST_MIGRATIONS: migrations,
              PANEL_TOKEN: "test-secret",
              PANEL_PIN: "123456",
              MEDIA_SIGNING_KEY: "test-media-key",
            },
          },
          wrangler: { configPath: "./wrangler.toml" },
        },
      },
    },
  };
});
