import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          miniflare: {
            compatibilityDate: "2026-01-01",
            d1Databases: ["DB"],
            bindings: { TEST_MIGRATIONS: migrations, PANEL_TOKEN: "test-secret" },
          },
          wrangler: { configPath: "./wrangler.toml" },
        },
      },
    },
  };
});
