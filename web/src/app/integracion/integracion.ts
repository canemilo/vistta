import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, type ConexionDeEntrada, type DestinoDeSalida, type ProfileRow } from '../core/api';
import { CabeceraPanel } from '../core/cabecera-panel';
import { CLAVE_SESION } from '../core/sesion';

/**
 * Conectar Vistta con el CRM que el agente ya usa.
 *
 * REGLA DE LENGUAJE, y es la mitad del trabajo de esta pantalla: quien la lee no
 * es técnico. Aquí no aparece «webhook», ni «endpoint», ni «payload», ni
 * «inbound». Aparecen «conexión», «enlaces automáticos» y «avisos de lectura».
 * Un campo de URL con la palabra «endpoint» encima lo rellenan cero agentes, y
 * entonces da igual lo bien que esté el backend.
 *
 * Por eso también está el botón de **enviar una prueba**: sin él, la única
 * forma de saber si funciona es esperar a que un cliente de verdad abra un
 * dosier de verdad, y nadie configura algo que no puede comprobar.
 */
@Component({
  selector: 'app-integracion',
  imports: [FormsModule, CabeceraPanel],
  templateUrl: './integracion.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Integracion {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  protected readonly cargando = signal(true);
  protected readonly error = signal('');
  protected readonly entrada = signal<ConexionDeEntrada[]>([]);
  protected readonly salida = signal<DestinoDeSalida[]>([]);
  protected readonly perfiles = signal<ProfileRow[]>([]);

  /**
   * La URL recién creada. Vive SOLO en memoria y solo hasta que se recargue:
   * en la base no queda más que su hash, así que si se pierde no hay forma de
   * recuperarla y hay que crear otra.
   */
  protected readonly urlNueva = signal<string | null>(null);
  protected readonly secretoNuevo = signal<string | null>(null);
  protected readonly copiado = signal('');
  protected readonly prueba = signal<{ id: string; texto: string; ok: boolean } | null>(null);
  protected readonly ayudaAbierta = signal(false);

  protected nombreConexion = '';
  protected perfilConexion = '';
  protected urlDestino = '';

  private readonly sesion = sessionStorage.getItem(CLAVE_SESION);

  constructor() {
    if (!this.sesion) void this.router.navigate(['/panel']);
    else void this.cargar();
  }

  private async cargar(): Promise<void> {
    if (!this.sesion) return;
    try {
      const [integracion, cuenta] = await Promise.all([
        this.api.integracion(this.sesion),
        this.api.profiles(this.sesion),
      ]);
      this.entrada.set(integracion.entrada);
      this.salida.set(integracion.salida);
      this.perfiles.set(cuenta.profiles.filter((p) => p.status === 'activo'));
    } catch {
      this.error.set('No se han podido cargar las conexiones. Vuelve a entrar al panel.');
    } finally {
      this.cargando.set(false);
    }
  }

  // --- crear enlaces automáticamente ----------------------------------------

  protected async crearConexion(): Promise<void> {
    if (!this.sesion || !this.nombreConexion.trim()) return;
    this.error.set('');
    try {
      const { url } = await this.api.crearConexion(this.sesion, {
        nombre: this.nombreConexion.trim(),
        profileId: this.perfilConexion || null,
      });
      this.urlNueva.set(url);
      this.nombreConexion = '';
      this.perfilConexion = '';
      await this.cargar();
    } catch {
      this.error.set('No se ha podido crear la conexión.');
    }
  }

  protected async revocar(c: ConexionDeEntrada): Promise<void> {
    if (!this.sesion) return;
    if (!confirm(`¿Anular «${c.nombre}»? Tu CRM dejará de poder crear enlaces con ella.`)) return;
    try {
      await this.api.revocarConexion(this.sesion, c.id);
      await this.cargar();
    } catch {
      this.error.set('No se ha podido anular la conexión.');
    }
  }

  // --- avisos de lectura ----------------------------------------------------

  protected async guardarDestino(): Promise<void> {
    if (!this.sesion || !this.urlDestino.trim()) return;
    this.error.set('');
    try {
      const { secreto } = await this.api.guardarDestino(this.sesion, {
        targetUrl: this.urlDestino.trim(),
      });
      this.secretoNuevo.set(secreto);
      this.urlDestino = '';
      await this.cargar();
    } catch (err) {
      // Aquí el motivo SÍ se enseña: quien lo lee está arreglando su propia
      // configuración, y «no se ha podido» no le dice qué corregir.
      this.error.set(mensajeDeError(err) ?? 'No se ha podido guardar la dirección.');
    }
  }

  protected async probar(d: DestinoDeSalida): Promise<void> {
    if (!this.sesion) return;
    this.prueba.set(null);
    try {
      const r = await this.api.probarDestino(this.sesion, d.id);
      this.prueba.set({
        id: d.id,
        ok: r.ok,
        texto: r.ok
          ? 'Enviado. Comprueba que ha llegado a tu CRM.'
          : `No ha llegado: ${enCastellano(r.error)}`,
      });
      await this.cargar();
    } catch {
      this.prueba.set({ id: d.id, ok: false, texto: 'No se ha podido enviar la prueba.' });
    }
  }

  protected async reactivar(d: DestinoDeSalida): Promise<void> {
    if (!this.sesion) return;
    await this.api.reactivarDestino(this.sesion, d.id);
    await this.cargar();
  }

  protected async borrarDestino(d: DestinoDeSalida): Promise<void> {
    if (!this.sesion) return;
    if (!confirm('¿Dejar de mandar avisos a esta dirección?')) return;
    await this.api.borrarDestino(this.sesion, d.id);
    await this.cargar();
  }

  // --- utilidades -----------------------------------------------------------

  /**
   * Copiar al portapapeles con lo que trae el navegador.
   *
   * Sin el CDK de Angular: es una llamada, y meter `@angular/cdk` entero en el
   * proyecto para tenerla añade una dependencia y peso al panel a cambio de
   * nada. Si el navegador no deja, el texto sigue ahí para seleccionarlo.
   */
  protected async copiar(texto: string, que: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(texto);
      this.copiado.set(`${que} copiada al portapapeles`);
    } catch {
      this.copiado.set('Tu navegador no deja copiar: selecciona el texto y cópialo a mano.');
    }
  }

  protected cuando(ts: number | null): string {
    if (ts === null) return 'nunca';
    const dias = Math.floor((Date.now() - ts) / 86_400_000);
    if (dias <= 0) return 'hoy';
    if (dias === 1) return 'ayer';
    if (dias < 31) return `hace ${dias} días`;
    return new Date(ts).toLocaleDateString('es-ES');
  }

  protected nombreDePerfil(id: string | null): string {
    if (id === null) return 'cualquiera de tus dosieres';
    return this.perfiles().find((p) => p.id === id)?.displayName ?? id;
  }

  protected enCastellano(codigo: string | null): string {
    return enCastellano(codigo);
  }
}

/**
 * Los códigos de error del envío, en palabras. El servidor manda códigos y no
 * frases a propósito: la copia vive donde vive el resto de la copia.
 */
function enCastellano(codigo: string | null): string {
  if (codigo === null) return 'sin detalle';
  if (codigo === 'sin-respuesta') return 'tu CRM no contestó a tiempo';
  if (codigo === 'sin-conexion') return 'no se ha podido conectar con esa dirección';
  if (codigo === 'destino-no-permitido') return 'esa dirección no está permitida';
  if (codigo === 'direccion-no-valida') return 'la dirección no es válida';
  const estado = /^estado-(\d+)$/.exec(codigo);
  if (estado) return `tu CRM respondió con un error (${estado[1]})`;
  return codigo;
}

/** El mensaje que manda la API en un 400, si lo trae. */
function mensajeDeError(err: unknown): string | null {
  const cuerpo = (err as { error?: { error?: string } } | null)?.error;
  return typeof cuerpo?.error === 'string' ? cuerpo.error : null;
}
