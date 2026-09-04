import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  Api,
  type CuentaAdmin,
  type Pago,
  type RegistroAuditoria,
  type Sesion,
  type Usuario,
} from '../core/api';
import { BotonTema } from '../core/boton-tema';
import { Marca } from '../core/marca';
import { TemaApp } from '../core/tema';

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
  private static readonly CLAVE_SESION = 'vistta.sesion';

  private readonly api = inject(Api);
  private readonly router = inject(Router);

  protected readonly sesion = signal<string | null>(null);
  protected readonly usuario = signal<Usuario | null>(null);
  protected readonly cuentas = signal<CuentaAdmin[]>([]);
  protected readonly auditoria = signal<RegistroAuditoria[]>([]);
  protected readonly pagos = signal<Pago[]>([]);

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
    const guardada = sessionStorage.getItem(Admin.CLAVE_SESION);
    if (guardada) void this.recuperar(guardada);
  }

  private async recuperar(token: string): Promise<void> {
    try {
      const { user } = await this.api.me(token);
      // Una sesión de cliente no pinta nada aquí: se le manda a su panel en vez
      // de enseñarle una pantalla que la API le va a negar entera.
      if (user.role !== 'admin') {
        void this.router.navigate(['/']);
        return;
      }
      this.sesion.set(token);
      this.usuario.set(user);
      await this.cargar();
    } catch {
      sessionStorage.removeItem(Admin.CLAVE_SESION);
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
      sessionStorage.setItem(Admin.CLAVE_SESION, sesion.token);
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
    sessionStorage.removeItem(Admin.CLAVE_SESION);
    this.sesion.set(null);
    this.usuario.set(null);
    this.cuentas.set([]);
    this.auditoria.set([]);
    if (token) await this.api.logout(token).catch(() => undefined);
  }

  private async cargar(): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;
    const [lista, registro, pagos] = await Promise.all([
      this.api.adminCuentas(sesion),
      this.api.adminAuditoria(sesion),
      this.api.adminPagos(sesion),
    ]);
    this.cuentas.set(lista.cuentas);
    this.planes.set(lista.planes);
    this.auditoria.set(registro.registros);
    this.pagos.set(pagos.pagos);
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

  protected detalle(registro: RegistroAuditoria): string {
    const entradas = Object.entries(registro.detalle);
    return entradas.length ? entradas.map(([k, v]) => `${k}: ${v}`).join(', ') : '';
  }
}
