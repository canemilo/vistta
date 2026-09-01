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

/**
 * Las mismas ocho fotos sirven a los cuatro perfiles de demostración: son un
 * relleno para ver el viewer con contenido, no el trabajo real de nadie. Las de
 * `rama` encajan regular con un gabinete de masaje, y es a propósito: lo que se
 * enseña es la plantilla, no las fotos.
 */
const TODAS = ["01", "02", "03", "04", "05", "06", "07", "08"];

/** Cuántas fotos usa cada perfil, por su sufijo. */
const POR_PERFIL: [string, string[]][] = [
  ["nordeste", TODAS],
  ["marina", ["01", "02", "03"]],
  ["costavega", TODAS],
  ["rama", ["01", "02"]],
];

const destinos: [string, string][] = POR_PERFIL.flatMap(([oficio, fotos]) =>
  fotos.flatMap((n) => [
    // El perfil del oficio...
    [`${n}.jpg`, `u/p_${oficio}/${n}.jpg`] as [string, string],
    // ...y su copia en la cuenta escaparate, que tiene claves propias a
    // propósito: una copia que apuntara a las claves del original estaría
    // sirviendo medios de otro perfil.
    [`${n}.jpg`, `u/p_demo_${oficio}/${n}.jpg`] as [string, string],
  ])
);

console.log("Subiendo fotos de demostración:");
for (const [archivo, key] of destinos) {
  const bytes = await readFile(new URL(`./fotos/${archivo}`, import.meta.url));
  await storage.put(key, new Uint8Array(bytes), "image/jpeg");
  console.log(`  ${key}`);
}
