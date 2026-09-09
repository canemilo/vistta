/**
 * Los nombres de los trabajos que se encolan desde fuera del trabajador.
 *
 * Módulo minúsculo y a propósito. `lib/pass.ts` encola dos cosas al abrir un
 * pase —el aviso de reapertura y el envío al CRM— y quien las ejecuta es
 * `worker.ts`, que a su vez importa `lib/pass.ts` por otras vías. Si las
 * constantes vivieran en cualquiera de los dos, habría un ciclo. Dos cadenas no
 * merecen un ciclo.
 */

/** Alguien ha vuelto a abrir un dosier: el momento de llamar. */
export const TRABAJO_AVISO_REAPERTURA = "aviso-reapertura";

/**
 * Contarle al CRM del agente que su dosier se ha abierto.
 *
 * ESTO NO PUEDE PASAR DENTRO DE LA PETICIÓN DEL VIEWER, y esa es la razón
 * entera de que sea un trabajo de la cola: si el CRM tarda o está caído, quien
 * se queda esperando es el comprador que acaba de abrir el enlace.
 */
export const TRABAJO_WEBHOOK_SALIDA = "webhook-salida";
