import type { Env } from "../src/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    MEDIA: R2Bucket;
    TEST_MIGRATIONS: D1Migration[];
  }
}
