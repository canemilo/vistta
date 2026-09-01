#!/usr/bin/env node
// Sube las fotos de demostración al Storage configurado.
//   pnpm tsx seed/fotos.ts
// Con STORAGE_DRIVER=memory no sirve de nada (el proceso muere y se las lleva):
// esto es para cuando ya hay un bucket de Supabase detrás.
import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config";
import { createSupabaseStorage } from "../src/storage/supabase";
import { cargarEnvLocal } from "../scripts/env-local";

cargarEnvLocal();
const config = loadConfig();

if (config.STORAGE_DRIVER !== "supabase") {
  console.error("Pon STORAGE_DRIVER=supabase: subir fotos a memoria no sirve de nada.");
  process.exit(1);
}

const storage = createSupabaseStorage({
  supabaseUrl: config.SUPABASE_URL!,
  secretKey: config.SUPABASE_SECRET_KEY!,
  bucket: config.SUPABASE_MEDIA_BUCKET,
});

const destinos: [string, string][] = [
  ...["01", "02", "03", "04", "05", "06", "07", "08"].map(
    (n) => [`${n}.jpg`, `u/p_nordeste/${n}.jpg`] as [string, string]
  ),
  ...["01", "02", "03"].map((n) => [`${n}.jpg`, `u/p_marina/${n}.jpg`] as [string, string]),
];

console.log("Subiendo fotos de demostración:");
for (const [archivo, key] of destinos) {
  const bytes = await readFile(new URL(`./fotos/${archivo}`, import.meta.url));
  await storage.put(key, new Uint8Array(bytes), "image/jpeg");
  console.log(`  ${key}`);
}
