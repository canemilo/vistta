#!/usr/bin/env node
// Contenido de demostración para desarrollo local. No usar en producción.
//   pnpm db:seed:local
//
// Siembra dos cosas:
//   1. Una cuenta por oficio, con su perfil. Es el caso real: un dueño, un
//      perfil, y ninguna cuenta ve la de al lado.
//   2. Una cuenta "escaparate" que posee una COPIA de los cuatro, para poder
//      recorrerlos desde una sola sesión del panel. No es un rol especial ni se
//      salta nada: son perfiles suyos, con `owner_id = 'demo'`, como cualquier
//      otro. El aislamiento entre inquilinos se queda como está.
//
// Las fotos no se suben aquí: con STORAGE_DRIVER=memory se pierden al
// reiniciar, y con Supabase van al bucket de verdad, que es decisión del que
// siembra. Para eso está `pnpm tsx seed/fotos.ts`.
import { readFile } from "node:fs/promises";
import { createDb, createPool } from "../src/db";
import { crearUsuario } from "../src/lib/auth";
import type { Db } from "../src/db";
import { cargarEnvLocal } from "./env-local";

cargarEnvLocal();

const CLAVE_DEMO = "demo-vistta-2026";
/** Cuenta que reúne una copia de todos los perfiles. Ver la nota de arriba. */
const ESCAPARATE = { id: "demo", displayName: "Demostración Vistta" };

interface ItemMedio {
  key: string;
  type: string;
  caption?: string;
}
interface Seccion {
  type: string;
  title?: string;
  body?: string;
  items?: ItemMedio[];
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

/**
 * Reapunta las claves de medios de un perfil a las del perfil copia.
 *
 * No es un detalle cosmético: si la copia conservara `u/p_costavega/01.jpg`,
 * la cuenta escaparate estaría referenciando claves de otro perfil, que es
 * justo el fallo abierto de §3 del HANDOFF. Las miniaturas del panel además
 * darían 404, porque la autorización sale del perfil que va en la clave.
 */
function copiarConClavesPropias(data: DatosPerfil, origen: string, destino: string): DatosPerfil {
  return {
    ...data,
    sections: data.sections.map((seccion) =>
      seccion.items
        ? {
            ...seccion,
            items: seccion.items.map((item) => ({
              ...item,
              key: item.key.replace(`u/${origen}/`, `u/${destino}/`),
            })),
          }
        : seccion
    ),
  };
}

async function guardarPerfil(
  db: Db,
  perfilId: string,
  ownerId: string,
  perfil: PerfilDemo
): Promise<void> {
  await db.query(
    `INSERT INTO vistta.profiles (id, display_name, brand_color, data, created_at, owner_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           brand_color  = EXCLUDED.brand_color,
           data         = EXCLUDED.data`,
    [
      perfilId,
      perfil.displayName,
      perfil.brandColor,
      JSON.stringify(perfil.data),
      Date.now(),
      ownerId,
    ]
  );
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Falta DATABASE_URL.");
  process.exit(1);
}

const contenido = JSON.parse(
  await readFile(new URL("../seed/demo.json", import.meta.url), "utf8")
) as Record<string, PerfilDemo>;

const pool = createPool(databaseUrl);
const db = createDb(pool);
try {
  // 1. Una cuenta por oficio.
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
    const destino = `p_${ESCAPARATE.id}_${userId}`;
    await guardarPerfil(db, destino, ESCAPARATE.id, {
      ...perfil,
      data: copiarConClavesPropias(perfil.data, `p_${userId}`, destino),
    });
  }
  console.log(
    `\nCuenta con los cuatro perfiles: ${ESCAPARATE.id} / ${CLAVE_DEMO}` +
      `\n  Entra una vez al panel y cámbialos en el selector.` +
      `\n  La vista previa NO consume ningún pase.`
  );
} finally {
  await pool.end();
}
