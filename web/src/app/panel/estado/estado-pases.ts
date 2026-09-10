import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Api,
  type ModoDePase,
  type PaseListado,
  type ResumenDeLectura,
  type TemaDePase,
} from '../../core/api';
import { EstadoCuenta } from './estado-cuenta';
import { EstadoPerfil } from './estado-perfil';
import { NucleoPanel } from './nucleo';

/**
 * Los enlaces: con qué condiciones se generan, cuáles hay vivos y qué se sabe
 * de cómo se leyeron.
 *
 * Es la parte del panel que toca el invariante del producto, y por eso las
 * decisiones de aquí no son de interfaz:
 *
 *   - `unico` viene elegido. Es lo único que este producto promete y lo que el
 *     cliente espera si no piensa en ello; los otros dos modos se eligen a
 *     conciencia o no se eligen.
 *   - Los MODOS que se ofrecen salen del plan, no de una lista escrita aquí.
 *   - Limpiar solo se lleva los CERRADOS. Un enlace todavía abrible está en
 *     manos de otra persona —ya se lo mandaste—, así que no puede desaparecer
 *     desde un botón que dice «limpiar».
 *   - Los tiempos se redondean. «Caduca en unas 6 h» es lo que alguien necesita
 *     saber; un contador al segundo daría una precisión que no existe y, en las
 *     métricas de lectura, sugeriría una vigilancia que ni es exacta ni es sana
 *     enseñar de una persona identificada.
 */
@Injectable({ providedIn: 'root' })
export class EstadoPases {
  private readonly api = inject(Api);
  private readonly nucleo = inject(NucleoPanel);
  private readonly cuenta = inject(EstadoCuenta);
  private readonly perfil = inject(EstadoPerfil);

  readonly pases = signal<PaseListado[]>([]);
  /** La lectura del pase que se ha desplegado, si se ha desplegado alguno. */
  readonly lectura = signal<{ passId: string; resumen: ResumenDeLectura } | null>(null);

  /**
   * `unico` viene elegido, y no por comodidad: es lo único que este producto
   * promete y lo que el cliente espera si no piensa en ello. Los otros dos
   * modos se eligen a conciencia o no se eligen.
   */
  readonly modoPase = signal<ModoDePase>('unico');
  /**
   * Con qué aspecto se enviará el enlace. Oscuro por defecto, que es como se ha
   * visto Vistta siempre; la vista previa de arriba lo refleja al momento, para
   * que no se elija a ciegas.
   */
  readonly temaPase = signal<TemaDePase>('oscuro');
  accesosPase = 3;
  ventanaHoras = 24;
  /** A quién se le enseña. Se pinta dentro de la foto, en cada visita. */
  destinatarioRef = '';
  /** Para reconocer el pase en la lista. No se pinta en ninguna parte. */
  destinatarioNota = '';

  readonly enlace = signal('');
  readonly copiado = signal(false);

  /** Los modos que da el plan. Sin plan (perfil sin dueño), solo el de siempre. */
  readonly modosDisponibles = computed<ModoDePase[]>(
    () => this.cuenta.plan()?.limites.modosDePase ?? ['unico'],
  );
  readonly topeAccesos = computed(() => this.cuenta.plan()?.limites.maxAccesos ?? 0);
  readonly topeVentanaHoras = computed(() =>
    Math.floor((this.cuenta.plan()?.limites.ventanaMaxMs ?? 0) / 3_600_000),
  );

  /** Cuántos de la lista ya no se abren: es lo que se puede limpiar. */
  readonly pasesCerrados = computed(
    () => this.pases().filter((p) => p.estado !== 'abrible').length,
  );

  async generar(): Promise<void> {
    const sesion = this.nucleo.token();
    if (!sesion || !this.perfil.perfilId()) return;
    this.nucleo.ocupado.set(true);
    this.nucleo.error.set('');
    this.copiado.set(false);
    try {
      const modo = this.modoPase();
      const { url } = await this.api.createPass(sesion, this.perfil.perfilId(), {
        modo,
        maxAccesos: modo === 'accesos' ? this.accesosPase : undefined,
        ventanaMs: modo === 'ventana' ? this.ventanaHoras * 3_600_000 : undefined,
        tema: this.temaPase(),
        destinatarioRef: this.destinatarioRef.trim() || undefined,
        destinatarioNota: this.destinatarioNota.trim() || undefined,
      });
      this.enlace.set(url);
      await this.cargar();
    } catch {
      this.nucleo.error.set('No se pudo generar el enlace. Vuelve a entrar con el PIN.');
    } finally {
      this.nucleo.ocupado.set(false);
    }
  }

  /** Los enlaces ya generados de este perfil, con su estado real. */
  async cargar(): Promise<void> {
    const sesion = this.nucleo.token();
    if (!sesion || !this.perfil.perfilId()) return;
    try {
      const { passes } = await this.api.listPasses(sesion, this.perfil.perfilId());
      this.pases.set(passes);
    } catch {
      // El listado es información, no funcionalidad: si falla, no se estropea
      // nada de lo que el usuario está haciendo.
      this.pases.set([]);
    }
  }

  /**
   * Limpia los enlaces cerrados de este perfil.
   *
   * Solo los cerrados, y el servidor lo aplica otra vez por su cuenta: un
   * enlace todavía abrible está en manos de otra persona —ya se lo mandaste—,
   * así que no puede desaparecer desde un botón que dice «limpiar».
   *
   * Se pide confirmación porque se pierde algo que no vuelve: lo que se sabía
   * de cómo leyó cada uno de esos enlaces.
   */
  async limpiar(): Promise<void> {
    const sesion = this.nucleo.token();
    if (!sesion || this.pasesCerrados() === 0) return;
    if (
      !confirm(
        `Se borrarán ${this.pasesCerrados()} enlaces ya cerrados y lo que se sabe de su lectura. ` +
          'Los que todavía se pueden abrir no se tocan.',
      )
    ) {
      return;
    }
    try {
      const { borrados } = await this.api.limpiarPases(sesion, this.perfil.perfilId());
      this.nucleo.aviso.set(
        `${borrados} enlace${borrados === 1 ? '' : 's'} cerrado${borrados === 1 ? '' : 's'} fuera de la lista.`,
      );
      await this.cargar();
    } catch {
      this.nucleo.error.set('No se pudieron limpiar los enlaces.');
    }
  }

  /**
   * Abre (o cierra) el detalle de lectura de un pase.
   *
   * Se pide al desplegar y no con la lista: la mayoría de los enlaces no se
   * miran nunca en detalle, y esto es una consulta de agregación por pase.
   */
  async verLectura(passId: string): Promise<void> {
    if (this.lectura()?.passId === passId) {
      this.lectura.set(null);
      return;
    }
    const sesion = this.nucleo.token();
    if (!sesion) return;
    try {
      this.lectura.set({ passId, resumen: await this.api.lecturaDelPase(sesion, passId) });
    } catch {
      this.lectura.set(null);
    }
  }

  async copiar(): Promise<void> {
    await navigator.clipboard.writeText(this.enlace());
    this.copiado.set(true);
  }

  /**
   * Lo que se enseña de cada enlace, en una línea.
   *
   * Redondeado a propósito: «caduca en unas 6 h» es lo que alguien necesita
   * saber. Un contador al segundo daría una precisión que no aporta.
   */
  estadoDelPase(p: PaseListado): string {
    if (p.estado === 'agotado') return 'ya se abrió';
    if (p.estado === 'caducado') return 'caducado sin abrir';

    const partes: string[] = [];
    if (p.modo === 'accesos' && p.maxAccesos !== null) {
      partes.push(`${p.accesosUsados} de ${p.maxAccesos} accesos`);
    }
    const limite = p.validoHasta ?? p.expiraEn;
    const restanMs = limite - Date.now();
    partes.push(
      p.validoHasta === null
        ? `sin abrir, ${this.enTiempo(restanMs)} para abrirlo`
        : `caduca en ${this.enTiempo(restanMs)}`,
    );
    return partes.join(' · ');
  }

  /**
   * Tiempo de lectura, REDONDEADO a propósito.
   *
   * «Unos 4 minutos» es lo que alguien necesita saber para decidir si llamar.
   * «4 min 12 s» sugiere una vigilancia que ni es exacta —el navegador mide a
   * ojo— ni es sana enseñar de una persona identificada.
   */
  enLectura(ms: number): string {
    if (ms < 15_000) return 'unos segundos';
    if (ms < 90_000) return `unos ${Math.round(ms / 15_000) * 15} s`;
    return `unos ${Math.round(ms / 60_000)} min`;
  }

  private enTiempo(ms: number): string {
    if (ms <= 0) return 'un momento';
    const horas = Math.round(ms / 3_600_000);
    if (horas >= 48) return `unos ${Math.round(horas / 24)} días`;
    if (horas >= 1) return `unas ${horas} h`;
    return `unos ${Math.max(1, Math.round(ms / 60_000))} min`;
  }

  /** Deja la lista y el enlace a la vista como recién cargados. */
  limpiarEstado(): void {
    this.pases.set([]);
    this.enlace.set('');
  }
}
