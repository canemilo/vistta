import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  Api,
  type CatalogoPublico,
  type CuentaAdmin,
  type Pago,
  type RegistroAuditoria,
  type Sesion,
  type Usuario,
} from '../core/api';
import { BotonTema } from '../core/boton-tema';
import { Marca } from '../core/marca';
import { TemaApp } from '../core/tema';
import { CLAVE_SESION } from '../core/sesion';

/**
 * Panel de administración.
 *
 * Gestiona CUENTAS, no contenido: no hay ninguna vista que enseñe los perfiles,
 * las fotos ni los pases de un cliente, porque la API no ofrece ninguna forma de
 * pedirlos. Vistta es encargado del tratamiento, no espectador.
 *
 * El otro criterio que ordena esta pantalla: **lo destructivo tiene que
 * parecerlo**. Suspender es reversible y va como un botón normal; borrar exige
 * teclear el identificador de la cuenta y avisa de lo que se lleva por delante.
 */
@Component({
  selector: 'app-admin',
  imports: [FormsModule, BotonTema, Marca],
  /*
   * Oscura por defecto, pero no a la fuerza: la clase solo se pone si el
   * usuario NO ha elegido tema. En cuanto toca el botón, manda su elección.
   * Es una herramienta interna que se usa a todas horas y su aspecto es este.
   */
  host: { '[class.paleta-oscura]': "tema.tema() === 'sistema'" },
  templateUrl: './admin.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class Admin {
  protected readonly tema = inject(TemaApp);

  /**
   * Días hasta una fecha, hacia ABAJO. Misma regla que en el panel del cliente:
   * en un aviso sobre perder algo, redondear hacia arriba regala un día que no
   * existe.
   */
  protected diasHasta(cuando: number | null): number {
    if (cuando === null) return 0;
    return Math.max(0, Math.floor((cuando - Date.now()) / 86_400_000));
  }

  /** Quién debe pagar: tiene un código emitido y sin cobrar. */
  protected readonly conPagoPendiente = computed(() =>
    this.cuentas().filter((c) => c.pagoPendiente !== null),
  );

  /**
   * Quién se va a caer de plan si no paga, dentro de una semana.
   *
   * Es la lista que hace falta para trabajar: no dice quién ha pagado —eso ya
   * se ve en el plan— sino a quién hay que perseguir antes de que baje.
   */
  protected readonly porVencer = computed(() =>
    this.cuentas()
      .filter((c) => c.planHasta !== null && this.diasHasta(c.planHasta) <= 7)
      .sort((a, b) => (a.planHasta ?? 0) - (b.planHasta ?? 0)),
  );

  private readonly api = inject(Api);
  private readonly router = inject(Router);

  protected readonly sesion = signal<string | null>(null);
  protected readonly usuario = signal<Usuario | null>(null);
  protected readonly cuentas = signal<CuentaAdmin[]>([]);
  protected readonly auditoria = signal<RegistroAuditoria[]>([]);
  protected readonly pagos = signal<Pago[]>([]);

  /** El catálogo público, solo por la retención de cada plan. */
  protected readonly catalogo = signal<CatalogoPublico | null>(null);

  // --- Registro de administración ----------------------------------------
  //
  // El registro dejó de ser una lista sin fin. Se navega por tres ejes —qué
  // día, qué acción, qué cuenta— porque son las tres preguntas que se le hacen
  // de verdad: «¿qué pasó el martes?», «¿quién ha tocado los planes?», «¿qué se
  // le hizo a esta cuenta?». Sin ellos había que leerlo entero con los ojos.
  protected readonly dia = signal<string | null>(null);
  protected readonly accionFiltro = signal<string | null>(null);
  protected cuentaFiltro = '';
  protected readonly dias = signal<{ dia: string; total: number }[]>([]);
  protected readonly acciones = signal<string[]>([]);
  protected readonly hayMas = signal(false);
  protected readonly cargandoRegistro = signal(false);

  /** Cuántos apuntes hay en total, para decirlo sin obligar a contarlos. */
  protected readonly totalRegistros = computed(() => this.dias().reduce((n, d) => n + d.total, 0));

  protected readonly hayFiltro = computed(
    () => this.dia() !== null || this.accionFiltro() !== null || this.cuentaFiltro.trim() !== '',
  );

  /** Lo que hay que cotejar con el extracto. Es lo primero que se mira. */
  protected readonly pendientes = computed(() =>
    this.pagos().filter((p) => p.status === 'pendiente'),
  );

  /** Método de cobro elegido por código, para no obligar a uno por defecto. */
  protected metodos: Record<string, string> = {};
  protected readonly planes = signal<string[]>([]);
  protected readonly ocupado = signal(false);
  protected readonly error = signal('');

  /** Contraseña recién generada. Se enseña UNA vez y no se puede recuperar. */
  protected readonly credencial = signal<{ id: string; password: string } | null>(null);

  /** Cuenta cuyo borrado se está confirmando, con lo que lleva tecleado. */
  protected readonly borrando = signal<string | null>(null);
  protected confirmacion = '';

  // Formulario de alta.
  protected nuevoId = '';
  protected nuevoNombre = '';
  protected nuevoPlan = 'prueba';

  protected readonly usuarioId = 'usuario';
  protected id = '';
  protected password = '';

  protected readonly suspendidas = computed(
    () => this.cuentas().filter((c) => c.status === 'suspendida').length,
  );

  constructor() {
    const guardada = sessionStorage.getItem(CLAVE_SESION);
    if (guardada) void this.recuperar(guardada);
  }

  private async recuperar(token: string): Promise<void> {
    try {
      const { user } = await this.api.me(token);
      // Una sesión de cliente no pinta nada aquí: se le manda A SU PANEL —que
      // desde que hay portada pública vive en /panel— y no a la raíz, que ahora
      // es la página de producto. Mandarlo allí sería sacarlo de la aplicación.
      if (user.role !== 'admin') {
        void this.router.navigate(['/panel']);
        return;
      }
      this.sesion.set(token);
      this.usuario.set(user);
      await this.cargar();
    } catch {
      sessionStorage.removeItem(CLAVE_SESION);
    }
  }

  protected async entrar(): Promise<void> {
    this.error.set('');
    this.ocupado.set(true);
    try {
      const sesion: Sesion = await this.api.login(this.id.trim(), this.password);
      this.password = '';
      if (sesion.user.role !== 'admin') {
        // Mismo mensaje que unas credenciales incorrectas: quien no es
        // administrador no tiene por qué averiguar si esta pantalla existe.
        this.error.set('No se pudo entrar con esos datos.');
        return;
      }
      sessionStorage.setItem(CLAVE_SESION, sesion.token);
      this.sesion.set(sesion.token);
      this.usuario.set(sesion.user);
      await this.cargar();
    } catch {
      this.error.set('No se pudo entrar con esos datos.');
    } finally {
      this.ocupado.set(false);
    }
  }

  protected async salir(): Promise<void> {
    const token = this.sesion();
    sessionStorage.removeItem(CLAVE_SESION);
    this.sesion.set(null);
    this.usuario.set(null);
    this.cuentas.set([]);
    this.auditoria.set([]);
    this.dias.set([]);
    if (token) await this.api.logout(token).catch(() => undefined);
  }

  private async cargar(): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;
    const [lista, pagos, catalogo] = await Promise.all([
      this.api.adminCuentas(sesion),
      this.api.adminPagos(sesion),
      // Sin sesión y público: solo se usa para leer la retención de cada plan,
      // que es lo que caduca en Prueba —el contenido— cuando no caduca el plan.
      this.api.planes().catch(() => null),
    ]);
    this.cuentas.set(lista.cuentas);
    this.planes.set(lista.planes);
    this.pagos.set(pagos.pagos);
    this.catalogo.set(catalogo);
    await this.cargarRegistro();
  }

  /** Envuelve una acción: ocupa la pantalla, recarga y traduce el error. */
  private async accion(fn: (sesion: string) => Promise<unknown>, fallo: string): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;
    this.ocupado.set(true);
    this.error.set('');
    try {
      await fn(sesion);
      await this.cargar();
    } catch (err: unknown) {
      const mensaje = (err as { error?: { error?: string } }).error?.error;
      this.error.set(mensaje ?? fallo);
    } finally {
      this.ocupado.set(false);
    }
  }

  protected async crear(): Promise<void> {
    const id = this.nuevoId.trim();
    const nombre = this.nuevoNombre.trim();
    if (!id || !nombre) {
      this.error.set('Hacen falta el identificador y el nombre.');
      return;
    }
    await this.accion(async (sesion) => {
      const creada = await this.api.adminCrearCuenta(sesion, {
        id,
        displayName: nombre,
        plan: this.nuevoPlan,
      });
      // La contraseña viaja una sola vez: se enseña hasta que la cierren.
      this.credencial.set({ id: creada.id, password: creada.password });
      this.nuevoId = '';
      this.nuevoNombre = '';
    }, 'No se pudo crear la cuenta.');
  }

  protected async cambiarPlan(cuenta: CuentaAdmin, plan: string): Promise<void> {
    if (plan === cuenta.plan) return;
    await this.accion(
      (sesion) => this.api.adminPlan(sesion, cuenta.id, plan),
      'No se pudo cambiar el plan.',
    );
  }

  protected async renombrar(cuenta: CuentaAdmin, displayName: string): Promise<void> {
    const nombre = displayName.trim();
    if (!nombre || nombre === cuenta.displayName) return;
    await this.accion(
      (sesion) => this.api.adminEditarCuenta(sesion, cuenta.id, nombre),
      'No se pudo cambiar el nombre.',
    );
  }

  protected async nuevaPassword(cuenta: CuentaAdmin): Promise<void> {
    await this.accion(async (sesion) => {
      const { password } = await this.api.adminPassword(sesion, cuenta.id);
      this.credencial.set({ id: cuenta.id, password });
    }, 'No se pudo reiniciar la contraseña.');
  }

  /**
   * Cierra la petición sin tocar la contraseña.
   *
   * Hace falta porque no toda petición se atiende: alguien puede pedirla por
   * error, o por la cuenta de otro. Sin esto, la única forma de quitar la marca
   * sería reiniciar una contraseña que nadie ha pedido de verdad.
   */
  protected async descartarSolicitud(cuenta: CuentaAdmin): Promise<void> {
    await this.accion(
      (sesion) => this.api.adminDescartarSolicitud(sesion, cuenta.id),
      'No se pudo descartar la solicitud.',
    );
  }

  protected async alternarSuspension(cuenta: CuentaAdmin): Promise<void> {
    await this.accion(
      (sesion) => this.api.adminSuspension(sesion, cuenta.id, cuenta.status === 'activa'),
      'No se pudo cambiar el estado.',
    );
  }

  protected pedirBorrado(id: string): void {
    this.borrando.set(id);
    this.confirmacion = '';
  }

  protected cancelarBorrado(): void {
    this.borrando.set(null);
    this.confirmacion = '';
  }

  protected async confirmarBorrado(): Promise<void> {
    const id = this.borrando();
    if (!id) return;
    await this.accion(async (sesion) => {
      await this.api.adminBorrarCuenta(sesion, id, this.confirmacion.trim());
      this.cancelarBorrado();
    }, 'No se pudo borrar la cuenta.');
  }

  /**
   * Da un pago por cobrado. Exige elegir el método —Bizum, PayPal— porque es lo
   * que ata este apunte al extracto donde se ha visto el ingreso: sin eso, la
   * auditoría diría que alguien activó un plan, no por qué.
   */
  protected async cobrar(pago: Pago): Promise<void> {
    const metodo = this.metodos[pago.code];
    if (!metodo) {
      this.error.set('Elige por dónde llegó el dinero antes de darlo por cobrado.');
      return;
    }
    await this.accion(async (sesion) => {
      await this.api.adminConfirmarPago(sesion, pago.code, metodo);
      delete this.metodos[pago.code];
    }, 'No se pudo confirmar el pago.');
  }

  protected async anular(pago: Pago): Promise<void> {
    await this.accion(
      (sesion) => this.api.adminAnularPago(sesion, pago.code),
      'No se pudo anular el código.',
    );
  }

  protected euros(centimos: number): string {
    return (centimos / 100).toFixed(2).replace('.', ',') + ' €';
  }

  protected megas(bytes: number): string {
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }

  protected fecha(ms: number): string {
    return new Date(ms).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  }

  // -------------------------------------------------------------------------
  // Registro de administración
  // -------------------------------------------------------------------------

  /**
   * El día empieza y acaba en el reloj de QUIEN MIRA.
   *
   * Se resuelve aquí, en el navegador, y al servidor le llegan dos instantes ya
   * calculados. Con el corte hecho en UTC, todo lo que se hiciera de noche en
   * España aparecería fechado al día siguiente: el registro contradiría al
   * reloj de quien lo escribió, que es justo lo que un registro no puede hacer.
   */
  private franja(dia: string | null): { desde?: number; hasta?: number } {
    if (!dia) return {};
    const [a, m, d] = dia.split('-').map(Number);
    const inicio = new Date(a, m - 1, d, 0, 0, 0, 0).getTime();
    const fin = new Date(a, m - 1, d + 1, 0, 0, 0, 0).getTime();
    return { desde: inicio, hasta: fin };
  }

  private get zona(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }

  /**
   * Trae una página del registro.
   *
   * `mas` distingue las dos formas de pedirlo: aplicar un filtro EMPIEZA de
   * cero, y continuar AÑADE por debajo. El cursor es el instante de la última
   * línea que ya se tiene, no un número de página: si mientras se lee alguien
   * escribe un apunte nuevo, con OFFSET la página siguiente repetiría una línea
   * o se saltaría otra.
   */
  protected async cargarRegistro(mas = false): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;
    this.cargandoRegistro.set(true);
    try {
      const previos = this.auditoria();
      const pagina = await this.api.adminAuditoria(sesion, {
        ...this.franja(this.dia()),
        accion: this.accionFiltro(),
        objetivo: this.cuentaFiltro.trim() || null,
        antes: mas && previos.length ? previos[previos.length - 1].createdAt : null,
        zona: this.zona,
      });
      this.auditoria.set(mas ? [...previos, ...pagina.registros] : pagina.registros);
      this.hayMas.set(pagina.hayMas);
      this.dias.set(pagina.dias);
      this.acciones.set(pagina.acciones);
    } catch {
      this.error.set('No se pudo leer el registro.');
    } finally {
      this.cargandoRegistro.set(false);
    }
  }

  protected async filtrarPorDia(dia: string): Promise<void> {
    this.dia.set(dia || null);
    await this.cargarRegistro();
  }

  protected async filtrarPorAccion(accion: string): Promise<void> {
    this.accionFiltro.set(accion || null);
    await this.cargarRegistro();
  }

  protected async limpiarFiltros(): Promise<void> {
    this.dia.set(null);
    this.accionFiltro.set(null);
    this.cuentaFiltro = '';
    await this.cargarRegistro();
  }

  /**
   * Las líneas agrupadas por día, con su encabezado.
   *
   * Un registro se lee por jornadas: repetir la fecha entera en cada línea la
   * convierte en ruido y obliga a comparar cadenas con la vista para saber
   * dónde cambia el día.
   */
  protected readonly porDias = computed(() => {
    const grupos: { dia: string; etiqueta: string; registros: RegistroAuditoria[] }[] = [];
    for (const r of this.auditoria()) {
      const dia = this.claveDeDia(r.createdAt);
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.dia === dia) ultimo.registros.push(r);
      else grupos.push({ dia, etiqueta: this.etiquetaDeDia(dia), registros: [r] });
    }
    return grupos;
  });

  /** `YYYY-MM-DD` en hora local, que es como se agrupa y como se filtra. */
  private claveDeDia(ms: number): string {
    const f = new Date(ms);
    const dos = (n: number) => String(n).padStart(2, '0');
    return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}`;
  }

  /** «hoy», «ayer» o la fecha. Un registro se consulta en esos términos. */
  protected etiquetaDeDia(dia: string): string {
    const hoy = this.claveDeDia(Date.now());
    const ayer = this.claveDeDia(Date.now() - 86_400_000);
    if (dia === hoy) return 'hoy';
    if (dia === ayer) return 'ayer';
    const [a, m, d] = dia.split('-').map(Number);
    return new Date(a, m - 1, d).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  protected hora(ms: number): string {
    return new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Cómo se llama cada acción en castellano.
   *
   * El nombre técnico (`reiniciar_password`) es el que va en la base y el que
   * no cambia; este es el que se lee. Una acción sin traducir cae en su propio
   * nombre en vez de desaparecer de la pantalla: si mañana se añade una al
   * servidor, aquí se verá fea pero se verá.
   */
  private static readonly NOMBRES: Record<string, string> = {
    crear_cuenta: 'Alta de cuenta',
    editar_cuenta: 'Cambio de nombre',
    cambiar_plan: 'Cambio de plan',
    reiniciar_password: 'Contraseña reiniciada',
    suspender: 'Suspensión',
    reactivar: 'Reactivación',
    borrar_cuenta: 'Cuenta borrada',
    cobrar_pago: 'Pago cobrado',
    anular_pago: 'Código anulado',
    descartar_solicitud: 'Solicitud descartada',
  };

  protected nombreAccion(accion: string): string {
    return Admin.NOMBRES[accion] ?? accion;
  }

  /**
   * El color dice de qué clase es cada apunte, de un vistazo.
   *
   * Solo tres, y a propósito: lo IRREVERSIBLE en rojo, el DINERO en verde y el
   * resto en gris. Un registro donde cada línea tiene su color no destaca nada.
   */
  protected tonoAccion(accion: string): string {
    if (accion === 'borrar_cuenta') return 'text-peligro';
    if (accion === 'suspender') return 'text-aviso';
    if (accion === 'cobrar_pago') return 'text-acento';
    return 'text-texto';
  }

  /**
   * Cuánto aguanta el contenido en un plan, en días.
   *
   * Es lo que se enseña en Prueba, donde el plan no vence: ahí lo que caduca es
   * el trabajo del cliente, y esa es la fecha que hay que tener delante. La
   * cifra sale del catálogo del servidor, nunca escrita en la plantilla.
   */
  protected retencionDias(plan: string): number | null {
    const entrada = this.catalogo()?.planes.find((p) => p.nombre === plan);
    const ms = entrada?.limites.retencionMs ?? null;
    return ms === null ? null : Math.round(ms / 86_400_000);
  }

  protected detalle(registro: RegistroAuditoria): string {
    const entradas = Object.entries(registro.detalle);
    return entradas.length ? entradas.map(([k, v]) => `${k}: ${v}`).join(', ') : '';
  }
}
