import { Injectable, computed, inject, signal } from '@angular/core';
import { Api, type EstadoDeCuenta, type EstadoFacturacion, type ProfileRow } from '../../core/api';
import { NucleoPanel } from './nucleo';

/**
 * La CUENTA: qué perfiles tienes, qué plan, en qué lo estás gastando y cuánto
 * te queda antes de que algo caduque.
 *
 * Lo que no está aquí: el contenido de ningún perfil. Esta área sabe que hay
 * tres perfiles y que el plan da para tres; qué hay dentro de cada uno es cosa
 * de `EstadoPerfil`, y esa separación es la que permitió partir el panel sin
 * que las dos mitades tuvieran que conocerse.
 *
 * Las CIFRAS no se escriben aquí. Salen del plan que manda el servidor, que las
 * lee de `src/lib/planes.ts`, que es el único sitio del proyecto donde vive un
 * número de plan. Y «ilimitado» viaja como `null`, jamás como un número grande:
 * las comprobaciones se saltan enteras cuando es `null`.
 */
@Injectable({ providedIn: 'root' })
export class EstadoCuenta {
  private readonly api = inject(Api);
  private readonly nucleo = inject(NucleoPanel);

  readonly perfiles = signal<ProfileRow[]>([]);
  readonly plan = signal<EstadoDeCuenta['plan']>(null);
  readonly uso = signal<EstadoDeCuenta['uso']>({ perfilesActivos: 0, pasesAbiertos: 0 });
  readonly facturacion = signal<EstadoFacturacion | null>(null);

  /** Abre el bloque de mejora de plan. Cerrado por defecto: no es lo que vienen a hacer. */
  readonly viendoPlanes = signal(false);
  /** La ficha de la cuenta: quién eres, qué plan tienes y en qué lo estás gastando. */
  readonly miCuenta = signal(false);
  periodoElegido = 'mensual';

  // --- contraseña -----------------------------------------------------------
  readonly cambiandoClave = signal(false);
  readonly claveCambiada = signal('');
  /**
   * El fallo se pinta en el propio formulario, no en el `error` compartido.
   * Ese vive al final de una página larga: quien se equivoca de contraseña
   * arriba del todo no vería nunca por qué no ha pasado nada.
   */
  readonly errorClave = signal('');
  claveActual = '';
  claveNueva = '';

  /**
   * Cuántos perfiles ACTIVOS admite el plan. `null` es «sin límite», nunca un
   * número grande: el código se salta la comprobación entera.
   */
  readonly topePerfiles = computed(() => this.plan()?.limites?.perfiles ?? null);

  readonly puedeCrearPerfil = computed(() => {
    const tope = this.topePerfiles();
    return tope === null || this.uso().perfilesActivos < tope;
  });

  /** Los que están de camino a borrarse. Son los que el cliente debe ver primero. */
  readonly congelados = computed(() => this.perfiles().filter((p) => p.status === 'congelado'));

  /** Días hasta que la purga se lleve el contenido más antiguo. `null` = no caduca. */
  readonly diasParaLimpieza = computed(() => {
    const c = this.facturacion()?.limpieza?.cuando;
    return c === null || c === undefined ? null : this.diasHasta(c);
  });

  /** Días hasta que venza el plan. `null` = sin plazo. */
  readonly diasParaVencer = computed(() => {
    const h = this.facturacion()?.planHasta;
    return h === null || h === undefined ? null : this.diasHasta(h);
  });

  async recargar(token: string): Promise<void> {
    const estado = await this.api.profiles(token);
    this.perfiles.set(estado.profiles);
    this.plan.set(estado.plan);
    this.uso.set(estado.uso);
    // La facturación se pide aparte y no bloquea el panel: si fallara, el
    // cliente tiene que poder seguir trabajando igual.
    this.api
      .facturacion(token)
      .then((f) => this.facturacion.set(f))
      .catch(() => undefined);
  }

  /** Pide un plan y deja a la vista el código que va en el concepto del pago. */
  async pedirPlan(plan: string): Promise<void> {
    const sesion = this.nucleo.token();
    if (!sesion) return;
    this.nucleo.ocupado.set(true);
    this.nucleo.error.set('');
    try {
      await this.api.solicitarPlan(sesion, plan, this.periodoElegido);
      this.facturacion.set(await this.api.facturacion(sesion));
      this.viendoPlanes.set(false);
    } catch (err: unknown) {
      const motivo = (err as { error?: { error?: string } }).error?.error;
      this.nucleo.error.set(motivo ?? 'No se pudo generar el código de pago.');
    } finally {
      this.nucleo.ocupado.set(false);
    }
  }

  async cambiarClave(): Promise<void> {
    const sesion = this.nucleo.token();
    if (!sesion) return;
    this.nucleo.ocupado.set(true);
    this.errorClave.set('');
    this.claveCambiada.set('');
    try {
      const { sesionesCerradas } = await this.api.cambiarPassword(
        sesion,
        this.claveActual,
        this.claveNueva,
      );
      this.claveActual = '';
      this.claveNueva = '';
      this.cambiandoClave.set(false);
      // Decir cuántas sesiones se han cerrado no es un detalle: quien cambia la
      // contraseña porque sospecha algo quiere saber si había alguien dentro.
      this.claveCambiada.set(
        sesionesCerradas > 0
          ? `Contraseña cambiada. Se han cerrado ${sesionesCerradas} sesiones abiertas en otros sitios.`
          : 'Contraseña cambiada.',
      );
    } catch (err: unknown) {
      const motivo = (err as { error?: { error?: string } }).error?.error;
      this.errorClave.set(motivo ?? 'No se pudo cambiar la contraseña.');
    } finally {
      this.nucleo.ocupado.set(false);
    }
  }

  // --- formatos -------------------------------------------------------------

  /** Céntimos a euros. El servidor manda enteros para no perder por el camino. */
  euros(centimos: number): string {
    return (centimos / 100).toFixed(2).replace('.', ',') + ' €';
  }

  precio(plan: string, periodo: string): number {
    return this.facturacion()?.catalogo.precios[plan]?.[periodo] ?? 0;
  }

  fechaCorta(ms: number): string {
    return new Date(ms).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  /** Un plazo en milisegundos, contado en días. */
  dias(ms: number): number {
    return Math.round(ms / 86_400_000);
  }

  /**
   * Días que faltan HASTA una fecha, redondeados hacia ABAJO.
   *
   * No confundir con `dias(ms)`, de aquí arriba, que convierte una DURACIÓN.
   *
   * Hacia abajo, y esto se corrigió al añadir los avisos: antes redondeaba
   * hacia arriba, así que con 29 horas por delante decía «2 días». En avisos
   * que existen para que nadie pierda su trabajo, redondear hacia arriba REGALA
   * un día que no existe y el cliente se confía justo el día que no debe. Una
   * sola regla para las tres cuentas atrás —perfil congelado, limpieza del
   * contenido y fin de plan—, y la prudente.
   */
  diasHasta(cuando: number | null): number {
    if (cuando === null) return 0;
    return Math.max(0, Math.floor((cuando - Date.now()) / 86_400_000));
  }

  /**
   * Cuánto apremia una cuenta atrás. De esto depende el color, y el color es lo
   * único que hace que alguien mire un aviso que lleva semanas ahí.
   */
  urgencia(dias: number | null): 'ninguna' | 'aviso' | 'urgente' {
    if (dias === null) return 'ninguna';
    return dias <= 1 ? 'urgente' : dias <= 3 ? 'aviso' : 'ninguna';
  }

  /**
   * Cuándo vence el plan, en fecha corta. `null` es Bóveda: sin caducidad, y se
   * dice con palabras y no con una fecha muy lejana.
   */
  vencimiento(): string {
    const f = this.facturacion();
    if (!f || f.plan === null) return 'sin plan';
    if (f.planHasta === null) return 'sin caducidad';
    return new Date(f.planHasta).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  /** El tope de pases a la vez. `null` en Bóveda: ausencia de límite, no un número. */
  topePases(): number | null {
    return this.plan()?.limites?.pasesSimultaneos ?? null;
  }

  /** Deja la cuenta como recién cargada. Lo usa la salida de sesión. */
  limpiar(): void {
    this.perfiles.set([]);
    this.plan.set(null);
    this.facturacion.set(null);
  }
}
