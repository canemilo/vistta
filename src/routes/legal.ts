import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps";

export function legalRoutes({ config }: Deps) {
  const legal = new Hono<AppEnv>();

  /**
   * Identidad del titular y contacto legal.
   *
   * PÚBLICA y sin sesión, a propósito: quien tiene que avisar de un contenido
   * suele ser alguien que ni siquiera es cliente —la persona que aparece en una
   * foto, o quien recibió un enlace— y exigirle una cuenta para poder avisar
   * convertiría el procedimiento de retirada en un trámite imposible.
   *
   * No hay nada que proteger aquí: un aviso legal sin nombre ni dirección no es
   * un aviso legal. Es la misma decisión que el teléfono del Bizum.
   *
   * Devuelve `null` en lo que no esté configurado, y `completo` dice si se puede
   * enseñar el documento. La alternativa —enseñarlo con los huecos sin
   * rellenar— sería peor que no enseñarlo: parecería un texto en vigor.
   */
  legal.get("/api/legal", (c) => {
    const titular = {
      nombre: config.TITULAR_NOMBRE ?? null,
      identificacion: config.TITULAR_IDENTIFICACION ?? null,
      direccion: config.TITULAR_DIRECCION ?? null,
    };
    const contacto = config.CONTACTO_LEGAL ?? null;
    return c.json({
      titular,
      contacto,
      completo: Boolean(titular.nombre && titular.identificacion && titular.direccion && contacto),
    });
  });

  return legal;
}
