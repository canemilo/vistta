import { Injectable, inject, signal } from '@angular/core';
import { Api } from '../../core/api';
import { CLAVE_SESION } from '../../core/sesion';
import { NucleoPanel } from './nucleo';

/**
 * Entrar y salir, y la única pantalla del panel que ve alguien sin sesión.
 *
 * No sabe nada de perfiles ni de planes: monta la sesión y ya. Lo que hay que
 * cargar DESPUÉS de entrar —los perfiles, el primero abierto— lo decide el
 * coordinador, que es el que conoce las cuatro áreas. Sin esa frontera, la
 * sesión tendría que importar el perfil y el perfil la sesión, y las
 * dependencias darían la vuelta.
 *
 * La sesión vive en `sessionStorage` y no en una cookie: sobrevive a un F5
 * dentro de la misma pestaña y no más allá.
 */
@Injectable({ providedIn: 'root' })
export class EstadoSesion {
  private readonly api = inject(Api);
  private readonly nucleo = inject(NucleoPanel);

  usuarioId = '';
  contrasena = '';

  /** Mientras gira la tarjeta de entrada. Solo pinta; no decide nada. */
  readonly saliendoDelLogin = signal(false);

  // --- contraseña olvidada --------------------------------------------------
  readonly pidiendoClave = signal(false);
  readonly clavePedida = signal('');
  usuarioOlvidado = '';

  /** Lo que tarda el giro. Tiene que coincidir con `girar-salida` del CSS. */
  private static readonly GIRO_MS = 420;

  /** El testigo guardado de una sesión anterior, si lo hay. */
  guardada(): string | null {
    return sessionStorage.getItem(CLAVE_SESION);
  }

  /** Comprueba un testigo guardado. Devuelve el usuario, o nada si ya no vale. */
  async retomar(token: string) {
    try {
      return (await this.api.me(token)).user;
    } catch {
      sessionStorage.removeItem(CLAVE_SESION);
      return null;
    }
  }

  /**
   * Entra con usuario y contraseña. Devuelve el testigo y el usuario, o nada.
   *
   * Guarda la sesión ANTES del giro: si algo fallara a partir de ahí, la sesión
   * está a salvo y basta con recargar.
   */
  async entrar() {
    this.nucleo.error.set('');
    this.saliendoDelLogin.set(false);
    this.nucleo.ocupado.set(true);
    try {
      const { token, user } = await this.api.login(this.usuarioId.trim(), this.contrasena);
      this.contrasena = '';
      sessionStorage.setItem(CLAVE_SESION, token);
      await this.girar();
      return { token, user };
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      this.nucleo.error.set(
        status === 429
          ? 'Demasiados intentos. Espera un rato antes de volver a probar.'
          : 'Ese usuario o esa contraseña no son correctos.',
      );
      return null;
    } finally {
      this.nucleo.ocupado.set(false);
    }
  }

  /**
   * Gira la tarjeta de entrada y espera a que termine.
   *
   * La espera es un plazo FIJO y no un `animationend`, y es a propósito: si ese
   * evento no llegara —animación desactivada por el sistema, pestaña en segundo
   * plano, un navegador que no la ejecute—, quien acaba de meter bien su
   * contraseña se quedaría mirando una pantalla que no avanza. Un adorno no
   * puede dejar a nadie fuera de su propio panel.
   *
   * Y quien pide menos movimiento no espera nada: entra en el acto.
   */
  private async girar(): Promise<void> {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.saliendoDelLogin.set(true);
    await new Promise((listo) => setTimeout(listo, EstadoSesion.GIRO_MS));
  }

  /**
   * Pide que un administrador genere una contraseña nueva.
   *
   * No hay recuperación por correo porque no se guarda el correo de nadie: es
   * una propiedad declarada del sistema, no un olvido. Esto deja una marca en
   * la cuenta y una persona comprueba quién eres por donde te dio el acceso.
   *
   * El mensaje que se enseña es el que manda el servidor, y es el mismo exista
   * la cuenta o no: si la pantalla dijera «esa cuenta no existe», el formulario
   * sería un comprobador de usuarios.
   */
  async pedirClaveNueva(): Promise<void> {
    const usuario = this.usuarioOlvidado.trim();
    if (!usuario) return;
    this.nucleo.ocupado.set(true);
    this.nucleo.error.set('');
    try {
      const { mensaje } = await this.api.claveOlvidada(usuario);
      this.usuarioOlvidado = '';
      this.clavePedida.set(mensaje);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      this.nucleo.error.set(
        status === 429
          ? 'Demasiadas solicitudes. Espera un rato antes de volver a probar.'
          : 'No se pudo enviar la solicitud.',
      );
    } finally {
      this.nucleo.ocupado.set(false);
    }
  }

  /**
   * Cierra la sesión aquí y en el servidor.
   *
   * Deshacer el giro es lo PRIMERO, y no es un detalle: la animación de salida
   * lleva `forwards`, así que deja la tarjeta girada y a opacidad cero. Si al
   * salir no se apaga esta señal, la pantalla de entrada vuelve ya desaparecida
   * y lo que se ve es un rectángulo negro. Pasó.
   */
  async cerrar(): Promise<void> {
    const token = this.nucleo.sesion();
    sessionStorage.removeItem(CLAVE_SESION);
    this.saliendoDelLogin.set(false);
    if (token) await this.api.logout(token).catch(() => undefined);
  }
}
