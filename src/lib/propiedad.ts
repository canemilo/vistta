import type { Db } from "../db";

/**
 * La ficha de la propiedad: lo poco que Vistta necesita saber de un inmueble.
 *
 * Tres campos, y la lista de lo que NO está aquí es la parte importante: no hay
 * nombre, ni correo, ni teléfono del propietario. El informe se lo entrega el
 * agente por el canal que ya tiene con él; Vistta no necesita conocerlo, y lo
 * que no se guarda no se filtra, no se exporta y no hay que declararlo.
 *
 * Es el mismo criterio con el que no se guarda el correo de los clientes.
 * Añadir cualquiera de esos tres campos obliga a rehacer `legal/rat.md` y la
 * EIPD antes de escribir una línea.
 */
export interface FichaDePropiedad {
  /** Referencia del inmueble en el CRM del agente. Es suya, no nuestra. */
  referencia: string | null;
  /** Nota del agente para el agente. NO entra en el informe. */
  propietarioNota: string | null;
  exclusivaDesde: number | null;
  actualizadoEn: number;
}

export async function fichaDePropiedad(
  db: Db,
  profileId: string
): Promise<FichaDePropiedad | null> {
  const fila = await db.one<{
    referencia: string | null;
    propietario_nota: string | null;
    exclusiva_desde: number | null;
    actualizado_en: number;
  }>(
    `SELECT referencia, propietario_nota, exclusiva_desde, actualizado_en
     FROM vistta.propiedad_meta WHERE profile_id = $1`,
    [profileId]
  );
  if (!fila) return null;
  return {
    referencia: fila.referencia,
    propietarioNota: fila.propietario_nota,
    exclusivaDesde: fila.exclusiva_desde,
    actualizadoEn: fila.actualizado_en,
  };
}

/**
 * Guarda la ficha. Un `null` BORRA el campo; no dejarlo pasar obligaría a
 * inventar un valor vacío que luego habría que distinguir de «no puesto».
 *
 * No comprueba de quién es el perfil: eso lo hace la ruta, que es la que tiene
 * la sesión. Aquí llegaría un id ya autorizado.
 */
export async function guardarFichaDePropiedad(
  db: Db,
  profileId: string,
  ficha: Partial<Omit<FichaDePropiedad, "actualizadoEn">>,
  ahora = Date.now()
): Promise<void> {
  await db.query(
    `INSERT INTO vistta.propiedad_meta
       (profile_id, referencia, propietario_nota, exclusiva_desde, actualizado_en)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (profile_id) DO UPDATE SET
       referencia       = EXCLUDED.referencia,
       propietario_nota = EXCLUDED.propietario_nota,
       exclusiva_desde  = EXCLUDED.exclusiva_desde,
       actualizado_en   = EXCLUDED.actualizado_en`,
    [
      profileId,
      ficha.referencia ?? null,
      ficha.propietarioNota ?? null,
      ficha.exclusivaDesde ?? null,
      ahora,
    ]
  );
}
