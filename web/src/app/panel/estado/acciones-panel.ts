import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api, type Usuario } from '../../core/api';
import { PLANTILLAS, contenidoDe, plantillaPorId } from '../plantillas';
import { EstadoCuenta } from './estado-cuenta';
import { EstadoPases } from './estado-pases';
import { EstadoPerfil } from './estado-perfil';
import { EstadoSesion } from './estado-sesion';
import { NucleoPanel } from './nucleo';

/**
 * Lo que CRUZA áreas, y solo eso.
 *
 * Cada una de las cuatro áreas —sesión, cuenta, perfil, pases— sabe lo suyo y
 * no importa a ninguna de las otras. Eso deja fuera cinco acciones que por su
 * naturaleza tocan varias a la vez: entrar (sesión → cuenta → perfil), elegir
 * perfil (perfil → pases), crear, borrar y rescatar (cuenta ↔ perfil). Viven
 * aquí.
 *
 * Es lo que impide que las dependencias den la vuelta. Si «elegir perfil»
 * viviera en el área del perfil, esa tendría que conocer los pases; y los pases
 * ya conocen el perfil, porque necesitan saber de cuál generan un enlace. Con
 * las dos cosas a la vez, Angular no puede construir ninguno de los dos.
 */
@Injectable({ providedIn: 'root' })
export class AccionesPanel {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly nucleo = inject(NucleoPanel);
  private readonly sesionEstado = inject(EstadoSesion);
  private readonly cuenta = inject(EstadoCuenta);
  private readonly perfil = inject(EstadoPerfil);
  private readonly pases = inject(EstadoPases);

  // --- crear un perfil ------------------------------------------------------
  /*
   * SEÑALES y no campos sueltos, y la diferencia se ve o no se ve en pantalla.
   * La aplicación va sin zona (`provideZonelessChangeDetection`): Angular
   * repinta al despachar un evento de plantilla, pero no después de un `await`.
   * Todo lo que se escribe al volver de una petición —un error del servidor,
   * cerrar la tarjeta— tiene que ser señal o no se pinta hasta que el usuario
   * toque otra cosa. Lo que se escribe con `ngModel` sí puede ser un campo
   * normal, porque su cambio viene siempre de un evento.
   */
  readonly errorPerfil = signal('');
  /** Si la tarjeta de «Nuevo perfil» está abierta. */
  readonly creando = signal(false);
  /** Perfil cuyo borrado se está confirmando. */
  readonly borrando = signal(false);
  /** De qué plantilla se parte. La primera viene elegida; ver `plantillas.ts`. */
  readonly plantillaElegida = signal(PLANTILLAS[0].id);
  nombrePerfilNuevo = '';
  confirmacionPerfil = '';

  /** Retoma la sesión guardada, si la hay. La llama el panel al construirse. */
  async retomarSesion(): Promise<void> {
    const guardada = this.sesionEstado.guardada();
    if (!guardada) return;
    const user = await this.sesionEstado.retomar(guardada);
    if (user) await this.abrirPanel(guardada, user);
  }

  async entrar(): Promise<void> {
    const entrada = await this.sesionEstado.entrar();
    if (entrada) await this.abrirPanel(entrada.token, entrada.user);
  }

  /**
   * Monta el panel del cliente, o manda al administrador al suyo.
   *
   * Un administrador no tiene perfiles: `admin:create` le borra el que crea el
   * alta, porque gestiona cuentas y no contenido. Sin esta comprobación, entrar
   * aquí con una cuenta de administrador montaba el editor sin ningún perfil
   * detrás: se veía la pantalla entera, se podía escribir, y no se guardaba
   * nada. Un panel que acepta lo que escribes y lo tira es peor que uno que no
   * te deja entrar.
   *
   * Se REDIRIGE en vez de dar error, y es el reverso exacto de lo que ya hacía
   * el panel de administración con una sesión de cliente. Dar un error aquí
   * sería además mentir: las credenciales son correctas y el rol es real; lo
   * que no encaja es la pantalla. Y no revela nada, porque solo ocurre después
   * de que la sesión haya demostrado ser de administrador.
   */
  private async abrirPanel(token: string, user: Usuario): Promise<void> {
    if (user.role === 'admin') {
      void this.router.navigate(['/admin']);
      return;
    }
    this.nucleo.sesion.set(token);
    this.nucleo.usuario.set(user);
    await this.cuenta.recargar(token);
    const perfiles = this.cuenta.perfiles();
    const primero = perfiles.find((p) => p.status === 'activo') ?? perfiles[0];
    if (primero) await this.elegirPerfil(primero.id);
  }

  async salir(): Promise<void> {
    await this.sesionEstado.cerrar();
    this.nucleo.limpiar();
    this.cuenta.limpiar();
    this.perfil.limpiar();
    this.pases.limpiarEstado();
  }

  /**
   * Abre un perfil y trae con él sus enlaces.
   *
   * El orden importa y se conserva del panel de una pieza: primero se olvida el
   * enlace recién generado, luego se carga el perfil, luego se VACÍA la lista de
   * enlaces del anterior y solo entonces se piden las miniaturas y los enlaces
   * nuevos. Vaciar después dejaría a la vista, durante todo lo que tardan las
   * miniaturas, los enlaces de otro perfil bajo el nombre de este.
   */
  async elegirPerfil(id: string): Promise<void> {
    if (!this.nucleo.token()) return;
    this.pases.enlace.set('');
    if (!(await this.perfil.cargar(id))) return;
    this.pases.pases.set([]);
    await this.perfil.cargarMiniaturas();
    await this.pases.cargar();
  }

  /**
   * Crea un perfil y se cambia a él: quien lo acaba de crear lo que quiere es
   * empezar a montarlo, no volver a buscarlo en el desplegable.
   *
   * El 409 se traduce en vez de mostrarse crudo. Puede pasar aunque el botón
   * estuviera activo: el recuento de esta pantalla puede haber envejecido —otra
   * pestaña, o un cambio de plan— y quien manda es el servidor.
   */
  async crearPerfil(): Promise<void> {
    const sesion = this.nucleo.token();
    const nombre = this.nombrePerfilNuevo.trim();
    if (!sesion || !nombre) return;
    this.nucleo.ocupado.set(true);
    this.errorPerfil.set('');
    try {
      const creado = await this.api.createProfile(sesion, nombre);
      /*
       * La plantilla se escribe en DOS pasos, y no es un descuido: crear un
       * perfil y guardar su contenido son las dos rutas que ya existen, y
       * meterle contenido a `POST /api/profiles` obligaría a tocar el esquema
       * del alta para algo que el cliente puede hacer un segundo después.
       *
       * Si el segundo paso falla, el perfil EXISTE y está vacío. Se dice tal
       * cual —ocupa plaza de plan y hay que saberlo— en vez de enseñar «no se
       * pudo crear el perfil», que mandaría a intentarlo otra vez y a gastar la
       * segunda plaza.
       */
      const plantilla = plantillaPorId(this.plantillaElegida());
      let plantillaFallida = false;
      if (plantilla.contenido.sections.length > 0 || plantilla.contenido.intro) {
        try {
          await this.api.saveProfile(sesion, creado.id, {
            displayName: nombre,
            data: contenidoDe(plantilla),
          });
        } catch {
          plantillaFallida = true;
        }
      }
      this.nombrePerfilNuevo = '';
      this.creando.set(false);
      await this.cuenta.recargar(sesion);
      await this.elegirPerfil(creado.id);
      /*
       * El aviso va DESPUÉS de abrir el perfil y en `error`, no en
       * `errorPerfil`: el segundo se pinta dentro de la tarjeta de «Nuevo
       * perfil», que acaba de cerrarse, así que el mensaje se escribía en una
       * pantalla que ya no estaba. Aquí se lee justo encima del editor vacío
       * que explica.
       */
      if (plantillaFallida) {
        this.nucleo.error.set(
          `Se creó «${nombre}», pero la plantilla no se pudo guardar. El perfil está vacío: escríbelo a mano o bórralo.`,
        );
      }
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      const tope = this.cuenta.topePerfiles();
      this.errorPerfil.set(
        status === 409
          ? `Tu plan da para ${tope} ${tope === 1 ? 'perfil' : 'perfiles'}. Cambia de plan o congela uno de los que tienes.`
          : 'No se pudo crear el perfil.',
      );
    } finally {
      this.nucleo.ocupado.set(false);
    }
  }

  /**
   * Borra el perfil abierto y se pasa al siguiente que quede.
   *
   * Sin esto, crear un perfil era un callejón sin salida: el límite del plan
   * cuenta perfiles ACTIVOS, así que uno creado por error ocupaba una plaza
   * para siempre, y con el plan Prueba —que da uno— dejaba la cuenta encerrada.
   *
   * Congelarlo no habría servido: la purga se lleva un congelado pasada la
   * gracia, así que ofrecer «congelar para liberar la plaza» sería programar su
   * destrucción sin decirlo.
   */
  async borrarPerfilActual(): Promise<void> {
    const sesion = this.nucleo.token();
    const id = this.perfil.perfilId();
    if (!sesion || !id) return;
    this.nucleo.ocupado.set(true);
    this.errorPerfil.set('');
    try {
      await this.api.borrarPerfil(sesion, id, this.confirmacionPerfil.trim());
      this.confirmacionPerfil = '';
      this.borrando.set(false);
      this.perfil.perfilId.set('');
      this.pases.enlace.set('');
      await this.cuenta.recargar(sesion);
      // Al siguiente que quede; si no queda ninguno, la pantalla lo dice y
      // ofrece crear uno, en vez de montar un editor sin nada detrás.
      const perfiles = this.cuenta.perfiles();
      const siguiente = perfiles.find((p) => p.status === 'activo') ?? perfiles[0];
      if (siguiente) await this.elegirPerfil(siguiente.id);
    } catch (err: unknown) {
      const motivo = (err as { error?: { error?: string } }).error?.error;
      this.errorPerfil.set(motivo ?? 'No se pudo borrar el perfil.');
    } finally {
      this.nucleo.ocupado.set(false);
    }
  }

  /**
   * Rescata un perfil congelado. Si el plan no da para más, el servidor
   * intercambia: entra este y sale el activo más antiguo. Por eso hay que
   * recargar la lista entera y no solo marcar uno.
   */
  async rescatar(id: string): Promise<void> {
    const sesion = this.nucleo.token();
    if (!sesion) return;
    this.nucleo.ocupado.set(true);
    try {
      await this.api.activarPerfil(sesion, id);
      await this.cuenta.recargar(sesion);
      await this.elegirPerfil(id);
    } catch {
      this.nucleo.error.set('No se pudo activar ese perfil.');
    } finally {
      this.nucleo.ocupado.set(false);
    }
  }
}
