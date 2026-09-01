#!/usr/bin/env node
/**
 * Da de alta o promueve a un administrador.
 *   pnpm admin:create <id> [nombre]
 *
 * Es la ÚNICA forma de conceder el rol, y a propósito: no existe ninguna ruta
 * HTTP que lo otorgue, ni siquiera para otro administrador. Cualquier endpoint
 * capaz de dar admin convierte un fallo de autorización en cualquier otro sitio
 * del sistema en una toma de control completa. Aquí hace falta acceso a la
 * máquina y a la cadena de conexión de la base.
 *
 * Si la cuenta ya existe, la promueve sin tocar su contraseña. Si no, la crea y
 * enseña una temporal UNA vez: no se guarda en claro en ningún sitio.
 */
import { createDb, createPool } from "../src/db";
import { crearUsuario } from "../src/lib/auth";
import { passwordTemporal, registrar } from "../src/lib/admin";
import { cargarEnvLocal } from "./env-local";

cargarEnvLocal();

const [id, nombre] = process.argv.slice(2);
if (!id) {
  console.error("Uso: pnpm admin:create <id> [nombre]");
  process.exit(1);
}
if (!/^[a-z0-9_-]{3,64}$/.test(id)) {
  console.error("El identificador solo admite minúsculas, dígitos, guion y guion bajo (3-64).");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Falta DATABASE_URL.");
  process.exit(1);
}

const pool = createPool(databaseUrl);
const db = createDb(pool);
try {
  const existente = await db.one<{ id: string; role: string }>(
    `SELECT id, role FROM vistta.users WHERE id = $1`,
    [id]
  );

  if (existente) {
    if (existente.role === "admin") {
      console.log(`La cuenta ${id} ya era administradora. Nada que hacer.`);
    } else {
      await db.query(`UPDATE vistta.users SET role = 'admin' WHERE id = $1`, [id]);
      // Queda registrado como cualquier otra acción de administración, con el
      // propio script como autor: promover a alguien no puede ser lo único que
      // pase sin dejar rastro.
      await registrar(db, `script:${process.env.USER ?? "desconocido"}`, "editar_cuenta", id, {
        role: "admin",
      });
      console.log(`Cuenta ${id} promovida a administradora. Su contraseña no se ha tocado.`);
    }
  } else {
    const temporal = passwordTemporal();
    const creado = await crearUsuario(db, {
      id,
      displayName: nombre ?? id,
      password: temporal,
    });
    if (!creado) throw new Error("no se pudo crear la cuenta");

    await db.query(`UPDATE vistta.users SET role = 'admin' WHERE id = $1`, [id]);
    // El perfil vacío que crea `crearUsuario` no le sirve de nada a un
    // administrador: no gestiona contenido, gestiona cuentas.
    await db.query(`DELETE FROM vistta.profiles WHERE owner_id = $1`, [id]);
    await registrar(db, `script:${process.env.USER ?? "desconocido"}`, "crear_cuenta", id, {
      role: "admin",
    });

    console.log(
      `Administrador ${id} creado.\n` +
        `  Contraseña temporal: ${temporal}\n` +
        `  Se enseña UNA vez: no se guarda en claro. Cámbiala al entrar.`
    );
  }
} finally {
  await pool.end();
}
