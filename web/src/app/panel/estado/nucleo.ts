import { Injectable, signal } from '@angular/core';
import type { Usuario } from '../../core/api';

/**
 * Lo que TODO el panel comparte, y nada más.
 *
 * El panel era un solo componente de mil líneas donde convivían la sesión, los
 * perfiles, la edición, los medios, los pases y los ajustes. Al partirlo hacía
 * falta decidir dónde vive cada cosa, y este archivo es la respuesta a la parte
 * difícil: lo que de verdad cruza áreas.
 *
 * Son cinco señales y ninguna es un capricho:
 *
 *   sesion / usuario — quién eres. Lo pide absolutamente todo lo que llama a la
 *     API, así que ponerlo en un área concreta obligaría a las otras cuatro a
 *     depender de esa.
 *   ocupado — hay una petición en vuelo. Apaga los botones de TODAS las áreas a
 *     la vez, y eso es lo correcto: si se está guardando el perfil, generar un
 *     enlace a la vez es pedir dos cosas contradictorias sobre lo mismo.
 *   error / aviso — el pie de la pantalla de edición. Se comparten porque el
 *     sitio donde se pintan es uno solo; los fallos que se leen en otro sitio
 *     —la contraseña, el logotipo, la carga del perfil— tienen su propia señal
 *     al lado de donde ocurren, y eso NO se ha unificado a propósito: un fallo
 *     que se lee al final de una página larga, cuando lo que falló está arriba,
 *     es un fallo invisible.
 *
 * Lo que NO está aquí es tan importante como lo que está. Este servicio no
 * llama a la API, no sabe qué es un perfil y no importa a ninguno de los otros
 * cuatro: es la hoja del árbol, y por eso ninguna dependencia da vueltas.
 */
@Injectable({ providedIn: 'root' })
export class NucleoPanel {
  /** El testigo de sesión. `null` es «no ha entrado», y es lo que decide la pantalla. */
  readonly sesion = signal<string | null>(null);
  readonly usuario = signal<Usuario | null>(null);

  /** Hay una petición en vuelo. Apaga los botones de todas las áreas. */
  readonly ocupado = signal(false);

  /** El pie de la pantalla de edición: lo último que pasó, bien o mal. */
  readonly error = signal('');
  readonly aviso = signal('');

  /**
   * Fallo al CARGAR el perfil. Señal propia y no el `error` de arriba, que se
   * pinta al final de una página larga: esto hay que verlo debajo de la
   * cabecera, porque mientras esté puesto el editor de abajo no enseña nada de
   * verdad.
   */
  readonly errorCarga = signal('');

  /**
   * El testigo, o nada.
   *
   * Existe para no repetir `const s = this.sesion(); if (!s) return;` en las
   * treinta acciones que llaman a la API. Devolver `null` y que cada una decida
   * es lo correcto: no hay ninguna reacción sensata común a todas —unas callan,
   * otras avisan— y una excepción aquí convertiría «la sesión caducó mientras
   * escribías» en una pantalla rota.
   */
  token(): string | null {
    return this.sesion();
  }

  /** Deja el núcleo como recién cargado. Lo usa la salida de sesión. */
  limpiar(): void {
    this.sesion.set(null);
    this.usuario.set(null);
    this.error.set('');
    this.aviso.set('');
    this.errorCarga.set('');
  }
}
