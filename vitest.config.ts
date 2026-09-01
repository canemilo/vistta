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
            compatibilityDate: "2026-01-01",
            // Lo exige @cloudflare/vitest-pool-workers; igual que en wrangler.toml.
            compatibilityFlags: ["nodejs_compat"],
            d1Databases: ["DB"],
            r2Buckets: ["MEDIA"],
            bindings: {
              TEST_MIGRATIONS: migrations,
              // Sin esta clave, /api/open no firma y test/media.spec.ts no puede pasar.
              MEDIA_SIGNING_KEY: "test-media-key",
            },
          },
          wrangler: { configPath: "./wrangler.toml" },
        },
      },
    },
  };
});
