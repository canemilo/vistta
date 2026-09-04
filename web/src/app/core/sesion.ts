/**
 * Dónde vive el testigo de sesión, y quién puede preguntarlo.
 *
 * La clave estaba escrita a mano en el panel y en administración, y ahora hacen
 * falta dos sitios más —la portada y los textos legales— para saber si hay
 * alguien dentro. Cuatro copias de la misma cadena es una que alguien cambia y
 * tres que se quedan viejas.
 *
 * `sessionStorage` y no `localStorage`: la sesión muere con la pestaña, que es
 * lo que se quiere en un ordenador compartido.
 */
export const CLAVE_SESION = 'vistta.sesion';

/**
 * ¿Hay alguien dentro?
 *
 * Responde por la PRESENCIA del testigo, no por su validez: comprobarla exige
 * preguntarle al servidor, y estas dos pantallas solo necesitan decidir a dónde
 * apunta un enlace. Si el testigo estuviera caducado, quien llegue al panel se
 * encontrará la pantalla de entrada, que es exactamente lo que debe pasar.
 */
export function haySesion(): boolean {
  try {
    return sessionStorage.getItem(CLAVE_SESION) !== null;
  } catch {
    // Modo privado con almacenamiento bloqueado: se trata como «no hay sesión».
    return false;
  }
}
