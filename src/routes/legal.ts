import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps";
import { PERIODOS, PLANES, PLANES_DE_PAGO, PLANES_VALIDOS, PRECIOS } from "../lib/planes";

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
  /**
   * Los planes, para la página pública.
   *
   * PÚBLICA y sin sesión por lo mismo que el aviso legal: quien está mirando si
   * este producto le sirve todavía no tiene cuenta —ni la va a poder crear él,
   * porque aquí no hay alta pública—. Pedirle que entre para ver qué incluye
   * cada plan sería pedirle que entre a un sitio donde no puede entrar.
   *
   * Y sale de `planes.ts` en vez de escribirse en el HTML porque esa es la
   * regla del proyecto: ninguna cifra de plan vive fuera de ese archivo. Una
   * página de precios con los números a mano es la manera más segura de acabar
   * anunciando una oferta que ya no existe.
   */
  legal.get("/api/planes", (c) =>
    c.json({
      moneda: "EUR",
      periodos: PERIODOS,
      planes: PLANES_VALIDOS.map((nombre) => ({
        nombre,
        limites: PLANES[nombre],
        precios: PRECIOS[nombre],
        // `prueba` no se vende: se entra en ella y se sube desde ahí.
        seVende: PLANES_DE_PAGO.includes(nombre),
      })),
    })
  );

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
