#!/usr/bin/env node
// Contenido de demostración para desarrollo local. No usar en producción.
//   pnpm db:seed:local
//
// Siembra tres cosas:
//   1. Una cuenta por oficio, con su perfil. Es el caso real: un dueño, un
//      perfil, y ninguna cuenta ve la de al lado.
//   2. Los MEDIOS de cada perfil: las fotos suben por el mismo camino que usa
//      un cliente de verdad (reservar y confirmar), así que quedan con su fila,
//      su tipo detectado de los bytes y sus dimensiones medidas. Sembrar el
//      JSON sin registrar los medios dejaría perfiles que apuntan a nada.
//   3. Una cuenta "escaparate" que posee una COPIA de los cuatro, para poder
//      recorrerlos desde una sola sesión del panel. No es un rol especial ni se
//      salta nada: son perfiles suyos, con `owner_id = 'demo'`, como cualquier
//      otro. El aislamiento entre inquilinos se queda como está.
//
// Cada perfil tiene sus PROPIAS copias de las fotos, con sus propios ids. Que la
// cuenta escaparate reutilizara los medios del original sería exactamente el
// fallo que cierra el bloque D: un perfil sirviendo el medio de otro.
import { readFile } from "node:fs/promises";
import { createDb, createPool } from "../src/db";
import { crearUsuario } from "../src/lib/auth";
import { confirmarMedio, reservarMedio } from "../src/lib/media-store";
import { createFsStorage } from "../src/storage/fs";
import { createSupabaseStorage } from "../src/storage/supabase";
import { loadConfig } from "../src/config";
import type { Db } from "../src/db";
import type { Storage } from "../src/storage/port";
import { cargarEnvLocal } from "./env-local";

cargarEnvLocal();

const CLAVE_DEMO = "demo-vistta-2026";
/** Cuenta que reúne una copia de todos los perfiles. Ver la nota de arriba. */
const ESCAPARATE = { id: "demo", displayName: "Demostración Vistta" };

/** En el JSON del seed, un medio es el nombre del archivo de `seed/fotos/`. */
interface ItemDeSeed {
  foto: string;
  caption?: string;
}
interface Seccion {
  type: string;
  title?: string;
  body?: string;
  items?: ItemDeSeed[];
}
interface DatosPerfil {
  tagline?: string;
  intro?: string;
  sections: Seccion[];
}
interface PerfilDemo {
  displayName: string;
  brandColor: string;
  data: DatosPerfil;
}

const config = loadConfig();
function almacen(): Storage {
  if (config.STORAGE_DRIVER === "memory") {
    // Sembrar en memoria no sirve de nada: este proceso termina y se lleva los
    // bytes, dejando perfiles que apuntan a objetos que ya no existen.
    console.error(
      "STORAGE_DRIVER=memory no vale para sembrar: los medios morirían con este proceso.\n" +
        "Usa STORAGE_DRIVER=fs para una demo local, o supabase si ya tienes el bucket."
    );
    process.exit(1);
  }
  if (config.STORAGE_DRIVER === "fs") return createFsStorage(config.STORAGE_FS_DIR);
  return createSupabaseStorage({
    supabaseUrl: config.SUPABASE_URL!,
    secretKey: config.SUPABASE_SECRET_KEY!,
    bucket: config.SUPABASE_MEDIA_BUCKET,
  });
}

const storage: Storage = almacen();

const bytesDeFoto = new Map<string, Uint8Array>();
async function foto(nombre: string): Promise<Uint8Array> {
  let bytes = bytesDeFoto.get(nombre);
  if (!bytes) {
    bytes = new Uint8Array(await readFile(new URL(`../seed/fotos/${nombre}.jpg`, import.meta.url)));
    bytesDeFoto.set(nombre, bytes);
  }
  return bytes;
}

/**
 * Sube una foto por el camino de verdad: reservar y confirmar. Nada de INSERTar
 * la fila a mano —el seed pasaría por alto la inspección de bytes y el cálculo
 * de dimensiones, y sembraría un estado que la API no sabe producir—.
 */
async function registrarFoto(db: Db, profileId: string, nombre: string): Promise<string> {
  const bytes = await foto(nombre);
  const { mediaId } = await reservarMedio(db, {
    profileId,
    kind: "image",
    declaredBytes: bytes.byteLength,
  });
  const resultado = await confirmarMedio(db, storage, { mediaId, profileId, bytes });
  if (!resultado.ok) throw new Error(`no se pudo sembrar ${nombre}: ${resultado.motivo}`);
  return mediaId;
}

/** Sustituye cada referencia a un archivo por el id del medio ya registrado. */
async function resolverMedios(
  db: Db,
  profileId: string,
  data: DatosPerfil
): Promise<Record<string, unknown>> {
  const sections = [];
  for (const seccion of data.sections) {
    if (!seccion.items) {
      sections.push(seccion);
      continue;
    }
    const items = [];
    for (const item of seccion.items) {
      items.push({ mediaId: await registrarFoto(db, profileId, item.foto), caption: item.caption });
    }
    sections.push({ ...seccion, items });
  }
  return { tagline: data.tagline, intro: data.intro, sections };
}

async function guardarPerfil(
  db: Db,
  perfilId: string,
  ownerId: string,
  perfil: PerfilDemo
): Promise<void> {
  // El perfil se crea vacío primero: registrar sus medios necesita que la fila
  // exista (`media.profile_id` la referencia), y el contenido necesita los ids.
  await db.query(
    `INSERT INTO vistta.profiles (id, display_name, brand_color, data, created_at, owner_id)
     VALUES ($1, $2, $3, '{}'::jsonb, $4, $5)
     ON CONFLICT (id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           brand_color  = EXCLUDED.brand_color,
           data         = '{}'::jsonb`,
    [perfilId, perfil.displayName, perfil.brandColor, Date.now(), ownerId]
  );
  // Se siembra otra vez: fuera los medios de la siembra anterior, que ya no
  // referencia nadie. Sin esto, cada pasada duplica la cuota del perfil.
  await db.query(`DELETE FROM vistta.media WHERE profile_id = $1`, [perfilId]);

  const data = await resolverMedios(db, perfilId, perfil.data);
  await db.query(`UPDATE vistta.profiles SET data = $1::jsonb WHERE id = $2`, [
    JSON.stringify(data),
    perfilId,
  ]);
}

const contenido = JSON.parse(
  await readFile(new URL("../seed/demo.json", import.meta.url), "utf8")
) as Record<string, PerfilDemo>;

const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);
try {
  // 1. Una cuenta por oficio, con su perfil y sus medios.
  for (const [userId, perfil] of Object.entries(contenido)) {
    // Devuelve null si la cuenta ya existía: entonces NO se toca su contraseña,
    // y por eso el mensaje de abajo no la anuncia.
    const creada = await crearUsuario(db, {
      id: userId,
      displayName: perfil.displayName,
      password: CLAVE_DEMO,
    });
    await guardarPerfil(db, `p_${userId}`, userId, perfil);
    console.log(
      creada
        ? `Perfil p_${userId} sembrado (usuario ${userId} / ${CLAVE_DEMO})`
        : `Perfil p_${userId} sembrado (usuario ${userId} ya existía: contraseña sin tocar)`
    );
  }

  // 2. La cuenta escaparate, con una copia de cada uno.
  await crearUsuario(db, { ...ESCAPARATE, password: CLAVE_DEMO });
  // crearUsuario deja un perfil vacío por cuenta; aquí sobra, porque los suyos
  // son las cuatro copias y un quinto en blanco solo ensucia el selector.
  await db.query(`DELETE FROM vistta.profiles WHERE id = $1`, [`p_${ESCAPARATE.id}`]);

  for (const [userId, perfil] of Object.entries(contenido)) {
    await guardarPerfil(db, `p_${ESCAPARATE.id}_${userId}`, ESCAPARATE.id, perfil);
  }
  console.log(
    `\nCuenta con los cuatro perfiles: ${ESCAPARATE.id} / ${CLAVE_DEMO}` +
      `\n  Entra una vez al panel y cámbialos en el selector.` +
      `\n  La vista previa NO consume ningún pase.`
  );
} finally {
  await pool.end();
}
