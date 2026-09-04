import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  Api,
  type EditableSection,
  type EstadoDeCuenta,
  type EstadoFacturacion,
  type MediaRef,
  type ModoDePase,
  type TemaDePase,
  type PaseListado,
  type ResumenDeLectura,
  type ProfileContent,
  type ProfileRow,
  type Usuario,
} from '../core/api';
import { PassDocument, type DocSection } from '../document/pass-document';
import { BotonTema } from '../core/boton-tema';

/** Panel: entrar con PIN, montar el contenido y generar el enlace. */
@Component({
  selector: 'app-panel',
  imports: [FormsModule, PassDocument, BotonTema],
  templateUrl: './panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class Panel {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  /** La sesión sobrevive a un F5 dentro de la misma pestaña, no más allá. */
  private static readonly CLAVE_SESION = 'vistta.sesion';

  protected usuarioId = '';
  protected contrasena = '';
  protected readonly sesion = signal<string | null>(null);
  protected readonly usuario = signal<Usuario | null>(null);
  protected readonly perfiles = signal<ProfileRow[]>([]);
  protected readonly plan = signal<EstadoDeCuenta['plan']>(null);
  protected readonly facturacion = signal<EstadoFacturacion | null>(null);
  /** Abre el bloque de mejora de plan. Cerrado por defecto: no es lo que vienen a hacer. */
  protected readonly viendoPlanes = signal(false);
  protected periodoElegido = 'mensual';

  // --- contraseña -----------------------------------------------------------
  protected readonly cambiandoClave = signal(false);
  protected readonly claveCambiada = signal('');
  /**
   * El fallo se pinta en el propio formulario, no en el `error` compartido.
   * Ese vive al final de una página larga: quien se equivoca de contraseña
   * arriba del todo no vería nunca por qué no ha pasado nada.
   */
  protected readonly errorClave = signal('');
  protected claveActual = '';
  protected claveNueva = '';
  protected readonly uso = signal<EstadoDeCuenta['uso']>({ perfilesActivos: 0, pasesAbiertos: 0 });

  // --- cómo caduca el enlace ------------------------------------------------
  /**
   * `unico` viene elegido, y no por comodidad: es lo único que este producto
   * promete y lo que el cliente espera si no piensa en ello. Los otros dos
   * modos se eligen a conciencia o no se eligen.
   */
  protected readonly modoPase = signal<ModoDePase>('unico');
  /**
   * Con qué aspecto se enviará el enlace. Oscuro por defecto, que es como se ha
   * visto Vistta siempre; la vista previa de arriba lo refleja al momento, para
   * que no se elija a ciegas.
   */
  protected readonly temaPase = signal<TemaDePase>('oscuro');
  protected accesosPase = 3;
  protected ventanaHoras = 24;
  /** A quién se le enseña. Se pinta dentro de la foto, en cada visita. */
  protected destinatarioRef = '';
  /** Para reconocer el pase en la lista. No se pinta en ninguna parte. */
  protected destinatarioNota = '';
  protected readonly pases = signal<PaseListado[]>([]);
  /** La lectura del pase que se ha desplegado, si se ha desplegado alguno. */
  protected readonly lectura = signal<{ passId: string; resumen: ResumenDeLectura } | null>(null);

  /** Los modos que da el plan. Sin plan (perfil sin dueño), solo el de siempre. */
  protected readonly modosDisponibles = computed<ModoDePase[]>(
    () => this.plan()?.limites.modosDePase ?? ['unico'],
  );
  protected readonly topeAccesos = computed(() => this.plan()?.limites.maxAccesos ?? 0);
  protected readonly topeVentanaHoras = computed(() =>
    Math.floor((this.plan()?.limites.ventanaMaxMs ?? 0) / 3_600_000),
  );

  // --- contraseña olvidada --------------------------------------------------
  protected readonly pidiendoClave = signal(false);
  protected readonly clavePedida = signal('');
  protected usuarioOlvidado = '';

  // --- perfiles -------------------------------------------------------------
  /**
   * Crear perfiles.
   *
   * El plan da 1, 3 o 10, y el backend lo aplica desde el bloque E; lo que
   * faltaba era la forma de pedirlo. Sin esto, una cuenta Pro o Bóveda se
   * quedaba con el único perfil que se crea al dar de alta la cuenta y el
   * límite del plan no significaba nada para el cliente.
   */
  protected readonly creandoPerfil = signal(false);
  protected readonly errorPerfil = signal('');
  protected nombrePerfilNuevo = '';

  /**
   * Cuántos perfiles ACTIVOS admite el plan. `null` es «sin límite», nunca un
   * número grande: el código se salta la comprobación entera.
   */
  protected readonly topePerfiles = computed(() => this.plan()?.limites?.perfiles ?? null);

  /** Perfil cuyo borrado se está confirmando, con lo que lleva tecleado. */
  protected readonly borrandoPerfil = signal(false);
  protected confirmacionPerfil = '';

  protected readonly puedeCrearPerfil = computed(() => {
    const tope = this.topePerfiles();
    return tope === null || this.uso().perfilesActivos < tope;
  });

  /** Los que están de camino a borrarse. Son los que el cliente debe ver primero. */
  protected readonly congelados = computed(() =>
    this.perfiles().filter((p) => p.status === 'congelado'),
  );

  /** Un plazo en milisegundos, contado en días. */
  protected dias(ms: number): number {
    return Math.round(ms / 86_400_000);
  }

  /** Días que faltan para que se borre un perfil congelado. */
  protected diasHasta(purgeAt: number | null): number {
    if (purgeAt === null) return 0;
    return Math.max(0, Math.ceil((purgeAt - Date.now()) / 86_400_000));
  }
  protected readonly perfilId = signal('');
  protected readonly nombre = signal('');
  /** Logotipo del perfil, ya reducido por el servidor. Null si no hay. */
  protected readonly logo = signal<string | null>(null);
  protected readonly subiendoLogo = signal(false);
  protected readonly errorLogo = signal('');
  protected readonly contenido = signal<ProfileContent>({ sections: [] });
  protected readonly miniaturas = signal<Record<string, string>>({});
  protected readonly enlace = signal('');
  protected readonly aviso = signal('');
  protected readonly error = signal('');
  protected readonly ocupado = signal(false);
  protected readonly copiado = signal(false);
  protected readonly vistaPrevia = signal(false);

  protected readonly totalFotos = computed(() =>
    this.contenido().sections.reduce((n, s) => n + ('items' in s ? s.items.length : 0), 0),
  );

  /** El contenido en el formato que consume el documento del cliente. */
  protected readonly seccionesPrevia = computed<DocSection[]>(() =>
    this.contenido().sections.map((s) => ({
      type: s.type,
      title: s.title,
      body: 'body' in s ? s.body : undefined,
      // La vista previa tiene que enseñar la MISMA presentación que verá el
      // cliente; si no, se elige a ciegas.
      display: 'display' in s ? s.display : undefined,
      items:
        'items' in s
          ? s.items.map((it) => ({
              url: this.miniaturas()[it.mediaId] ?? '',
              caption: it.caption,
            }))
          : [],
    })),
  );

  // --- sesión ---------------------------------------------------------------

  constructor() {
    const guardada = sessionStorage.getItem(Panel.CLAVE_SESION);
    if (guardada) void this.retomar(guardada);
  }

  private async retomar(token: string): Promise<void> {
    try {
      const { user } = await this.api.me(token);
      await this.abrirPanel(token, user);
    } catch {
      sessionStorage.removeItem(Panel.CLAVE_SESION);
    }
  }

  protected async entrar(): Promise<void> {
    this.error.set('');
    this.ocupado.set(true);
    try {
      const { token, user } = await this.api.login(this.usuarioId.trim(), this.contrasena);
      this.contrasena = '';
      sessionStorage.setItem(Panel.CLAVE_SESION, token);
      await this.abrirPanel(token, user);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      this.error.set(
        status === 429
          ? 'Demasiados intentos. Espera un rato antes de volver a probar.'
          : 'Ese usuario o esa contraseña no son correctos.',
      );
    } finally {
      this.ocupado.set(false);
    }
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
  protected async pedirClaveNueva(): Promise<void> {
    const usuario = this.usuarioOlvidado.trim();
    if (!usuario) return;
    this.ocupado.set(true);
    this.error.set('');
    try {
      const { mensaje } = await this.api.claveOlvidada(usuario);
      this.usuarioOlvidado = '';
      this.clavePedida.set(mensaje);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      this.error.set(
        status === 429
          ? 'Demasiadas solicitudes. Espera un rato antes de volver a probar.'
          : 'No se pudo enviar la solicitud.',
      );
    } finally {
      this.ocupado.set(false);
    }
  }

  private async abrirPanel(token: string, user: Usuario): Promise<void> {
    if (user.role === 'admin') {
      void this.router.navigate(['/admin']);
      return;
    }
    this.sesion.set(token);
    this.usuario.set(user);
    await this.recargarPerfiles(token);
    const primero = this.perfiles().find((p) => p.status === 'activo') ?? this.perfiles()[0];
    if (primero) await this.elegirPerfil(primero.id);
  }

  private async recargarPerfiles(token: string): Promise<void> {
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
  protected async pedirPlan(plan: string): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;
    this.ocupado.set(true);
    this.error.set('');
    try {
      await this.api.solicitarPlan(sesion, plan, this.periodoElegido);
      this.facturacion.set(await this.api.facturacion(sesion));
      this.viendoPlanes.set(false);
    } catch (err: unknown) {
      const motivo = (err as { error?: { error?: string } }).error?.error;
      this.error.set(motivo ?? 'No se pudo generar el código de pago.');
    } finally {
      this.ocupado.set(false);
    }
  }

  /** Céntimos a euros. El servidor manda enteros para no perder por el camino. */
  protected euros(centimos: number): string {
    return (centimos / 100).toFixed(2).replace('.', ',') + ' €';
  }

  protected precio(plan: string, periodo: string): number {
    return this.facturacion()?.catalogo.precios[plan]?.[periodo] ?? 0;
  }

  protected fechaCorta(ms: number): string {
    return new Date(ms).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  /**
   * Rescata un perfil congelado. Si el plan no da para más, el servidor
   * intercambia: entra este y sale el activo más antiguo. Por eso hay que
   * recargar la lista entera y no solo marcar uno.
   */
  protected async rescatar(id: string): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;
    this.ocupado.set(true);
    try {
      await this.api.activarPerfil(sesion, id);
      await this.recargarPerfiles(sesion);
      await this.elegirPerfil(id);
    } catch {
      this.error.set('No se pudo activar ese perfil.');
    } finally {
      this.ocupado.set(false);
    }
  }

  /**
   * Crea un perfil y se cambia a él: quien lo acaba de crear lo que quiere es
   * empezar a montarlo, no volver a buscarlo en el desplegable.
   *
   * El 409 se traduce en vez de mostrarse crudo. Puede pasar aunque el botón
   * estuviera activo: el recuento de esta pantalla puede haber envejecido —otra
   * pestaña, o un cambio de plan— y quien manda es el servidor.
   */
  protected async crearPerfil(): Promise<void> {
    const sesion = this.sesion();
    const nombre = this.nombrePerfilNuevo.trim();
    if (!sesion || !nombre) return;
    this.ocupado.set(true);
    this.errorPerfil.set('');
    try {
      const creado = await this.api.createProfile(sesion, nombre);
      this.nombrePerfilNuevo = '';
      this.creandoPerfil.set(false);
      await this.recargarPerfiles(sesion);
      await this.elegirPerfil(creado.id);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      this.errorPerfil.set(
        status === 409
          ? `Tu plan da para ${this.topePerfiles()} ${this.topePerfiles() === 1 ? 'perfil' : 'perfiles'}. Cambia de plan o congela uno de los que tienes.`
          : 'No se pudo crear el perfil.',
      );
    } finally {
      this.ocupado.set(false);
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
  protected async borrarPerfilActual(): Promise<void> {
    const sesion = this.sesion();
    const id = this.perfilId();
    if (!sesion || !id) return;
    this.ocupado.set(true);
    this.errorPerfil.set('');
    try {
      await this.api.borrarPerfil(sesion, id, this.confirmacionPerfil.trim());
      this.confirmacionPerfil = '';
      this.borrandoPerfil.set(false);
      this.perfilId.set('');
      this.enlace.set('');
      await this.recargarPerfiles(sesion);
      // Al siguiente que quede; si no queda ninguno, la pantalla lo dice y
      // ofrece crear uno, en vez de montar un editor sin nada detrás.
      const siguiente = this.perfiles().find((p) => p.status === 'activo') ?? this.perfiles()[0];
      if (siguiente) await this.elegirPerfil(siguiente.id);
    } catch (err: unknown) {
      const motivo = (err as { error?: { error?: string } }).error?.error;
      this.errorPerfil.set(motivo ?? 'No se pudo borrar el perfil.');
    } finally {
      this.ocupado.set(false);
    }
  }

  protected async cambiarClave(): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;
    this.ocupado.set(true);
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
      this.ocupado.set(false);
    }
  }

  protected async salir(): Promise<void> {
    const token = this.sesion();
    sessionStorage.removeItem(Panel.CLAVE_SESION);
    this.sesion.set(null);
    this.usuario.set(null);
    this.perfiles.set([]);
    this.plan.set(null);
    this.facturacion.set(null);
    this.contenido.set({ sections: [] });
    this.enlace.set('');
    if (token) await this.api.logout(token).catch(() => undefined);
  }

  // --- contenido ------------------------------------------------------------

  protected async elegirPerfil(id: string): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;
    this.perfilId.set(id);
    this.enlace.set('');
    this.aviso.set('');
    const perfil = await this.api.getProfile(sesion, id);
    this.nombre.set(perfil.displayName);
    this.contenido.set({ ...perfil.data, sections: perfil.data.sections ?? [] });
    this.logo.set(perfil.logo ?? null);
    this.errorLogo.set('');
    // Los enlaces ya generados de este perfil: con pases de varios accesos,
    // saber cuántos quedan es parte de poder usarlos.
    this.pases.set([]);
    await this.cargarMiniaturas();
    await this.cargarPases();
  }

  private async cargarMiniaturas(): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;
    const ids = this.contenido()
      .sections.flatMap((s) => ('items' in s ? s.items.map((i) => i.mediaId) : []))
      .filter((id) => !this.miniaturas()[id]);
    for (const mediaId of ids) {
      try {
        const url = await this.api.preview(sesion, mediaId);
        this.miniaturas.update((m) => ({ ...m, [mediaId]: url }));
      } catch {
        // Una foto que ya no está en el almacén no debe romper la edición.
      }
    }
  }

  protected actualizar(cambio: Partial<ProfileContent>): void {
    this.contenido.update((c) => ({ ...c, ...cambio }));
    this.aviso.set('');
  }

  /** Las dos formas de presentar fotos, con lo que las distingue de verdad. */
  protected readonly PRESENTACIONES = [
    {
      valor: 'cuadricula' as const,
      etiqueta: 'CUADRÍCULA',
      pista: 'Filas ordenadas. Recorta para que las celdas cuadren.',
    },
    {
      valor: 'carrusel' as const,
      etiqueta: 'CARRUSEL',
      pista: 'Tira horizontal. No recorta nada.',
    },
  ];

  protected presentacionDe(seccion: EditableSection): string {
    return 'display' in seccion && seccion.display ? seccion.display : 'cuadricula';
  }

  protected anadirSeccion(type: EditableSection['type']): void {
    const nueva: EditableSection =
      type === 'texto'
        ? { type, title: '', body: '' }
        : type === 'galeria'
          ? { type, title: '', items: [] }
          : { type, title: '', body: '', items: [] };
    this.contenido.update((c) => ({ ...c, sections: [...c.sections, nueva] }));
    this.aviso.set('');
  }

  protected editarSeccion(i: number, cambio: Partial<EditableSection>): void {
    this.contenido.update((c) => ({
      ...c,
      sections: c.sections.map((s, idx) =>
        idx === i ? ({ ...s, ...cambio } as EditableSection) : s,
      ),
    }));
    this.aviso.set('');
  }

  protected moverSeccion(i: number, salto: number): void {
    const destino = i + salto;
    this.contenido.update((c) => {
      if (destino < 0 || destino >= c.sections.length) return c;
      const sections = [...c.sections];
      [sections[i], sections[destino]] = [sections[destino], sections[i]];
      return { ...c, sections };
    });
    this.aviso.set('');
  }

  protected quitarSeccion(i: number): void {
    this.contenido.update((c) => ({ ...c, sections: c.sections.filter((_, idx) => idx !== i) }));
    this.aviso.set('');
  }

  // --- fotos ----------------------------------------------------------------

  protected async subirFotos(i: number, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const sesion = this.sesion();
    if (!sesion || !input.files?.length) return;

    this.ocupado.set(true);
    this.error.set('');
    try {
      for (const file of Array.from(input.files)) {
        const medio = await this.api.uploadMedia(sesion, this.perfilId(), file);
        this.miniaturas.update((m) => ({ ...m, [medio.id]: URL.createObjectURL(file) }));
        // En el contenido solo va el id: el tipo y las dimensiones los sabe el
        // servidor, que es el único que ha mirado los bytes.
        this.editarSeccion(i, {
          items: [...this.itemsDe(i), { mediaId: medio.id, caption: '' }],
        });
      }
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      // El 413 tiene dos causas —el archivo o la cuota— y el mensaje del
      // servidor distingue cuál: repetirlo aquí a ciegas mandaría al cliente a
      // reducir una foto cuando el problema es que ya no le queda sitio.
      const motivo = (err as { error?: { error?: string } }).error?.error ?? '';
      this.error.set(
        status === 415
          ? 'Ese archivo no es lo que parece o no está admitido. Sube JPG, PNG, WebP, AVIF, GIF, PDF o vídeo MP4/WebM.'
          : status === 413
            ? motivo.includes('cuota')
              ? 'Este perfil ha llenado sus 200 MB. Quita algo para hacer sitio.'
              : 'El archivo pasa del límite: 10 MB por imagen, 15 MB por PDF, 50 MB por vídeo.'
            : 'No se pudo subir el archivo.',
      );
    } finally {
      input.value = '';
      this.ocupado.set(false);
    }
  }

  protected itemsDe(i: number): MediaRef[] {
    const seccion = this.contenido().sections[i];
    return seccion && 'items' in seccion ? seccion.items : [];
  }

  protected editarFoto(i: number, j: number, caption: string): void {
    this.editarSeccion(i, {
      items: this.itemsDe(i).map((it, idx) => (idx === j ? { ...it, caption } : it)),
    });
  }

  protected quitarFoto(i: number, j: number): void {
    this.editarSeccion(i, { items: this.itemsDe(i).filter((_, idx) => idx !== j) });
  }

  // --- guardar y compartir --------------------------------------------------

  protected async guardar(): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;
    this.ocupado.set(true);
    this.error.set('');
    try {
      await this.api.saveProfile(sesion, this.perfilId(), {
        displayName: this.nombre(),
        data: this.contenido(),
      });
      this.aviso.set(`Guardado a las ${new Date().toTimeString().slice(0, 5)}`);
    } catch {
      this.error.set('No se pudo guardar. Vuelve a entrar con el PIN.');
    } finally {
      this.ocupado.set(false);
    }
  }

  protected async generar(): Promise<void> {
    const sesion = this.sesion();
    if (!sesion || !this.perfilId()) return;
    this.ocupado.set(true);
    this.error.set('');
    this.copiado.set(false);
    try {
      const modo = this.modoPase();
      const { url } = await this.api.createPass(sesion, this.perfilId(), {
        modo,
        maxAccesos: modo === 'accesos' ? this.accesosPase : undefined,
        ventanaMs: modo === 'ventana' ? this.ventanaHoras * 3_600_000 : undefined,
        tema: this.temaPase(),
        destinatarioRef: this.destinatarioRef.trim() || undefined,
        destinatarioNota: this.destinatarioNota.trim() || undefined,
      });
      this.enlace.set(url);
      await this.cargarPases();
    } catch {
      this.error.set('No se pudo generar el enlace. Vuelve a entrar con el PIN.');
    } finally {
      this.ocupado.set(false);
    }
  }

  /** Los enlaces ya generados de este perfil, con su estado real. */
  /**
   * Sube el logotipo del perfil.
   *
   * Se manda el archivo tal cual y el servidor devuelve el data URI ya
   * reducido: aquí no se comprime nada. Reducirlo en el navegador daría un
   * resultado distinto según el equipo, y además lo que hay que creerse es lo
   * que guarda el servidor, no lo que dice el cliente que subió.
   */
  protected async elegirLogo(evento: Event): Promise<void> {
    const archivo = (evento.target as HTMLInputElement).files?.[0];
    if (!archivo) return;
    const sesion = this.sesion();
    if (!sesion) return;

    this.subiendoLogo.set(true);
    this.errorLogo.set('');
    try {
      const { logo } = await this.api.subirLogo(sesion, this.perfilId(), archivo);
      this.logo.set(logo);
    } catch {
      this.errorLogo.set('No se pudo usar esa imagen. Prueba con un PNG o un SVG rasterizado.');
    } finally {
      this.subiendoLogo.set(false);
    }
  }

  protected async quitarLogo(): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;
    try {
      await this.api.quitarLogo(sesion, this.perfilId());
      this.logo.set(null);
    } catch {
      this.errorLogo.set('No se pudo quitar el logotipo.');
    }
  }

  protected async cargarPases(): Promise<void> {
    const sesion = this.sesion();
    if (!sesion || !this.perfilId()) return;
    try {
      const { passes } = await this.api.listPasses(sesion, this.perfilId());
      this.pases.set(passes);
    } catch {
      // El listado es información, no funcionalidad: si falla, no se estropea
      // nada de lo que el usuario está haciendo.
      this.pases.set([]);
    }
  }

  /**
   * Lo que se enseña de cada enlace, en una línea.
   *
   * Redondeado a propósito: «caduca en unas 6 h» es lo que alguien necesita
   * saber. Un contador al segundo daría una precisión que no aporta.
   */
  protected estadoDelPase(p: PaseListado): string {
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
   * Abre (o cierra) el detalle de lectura de un pase.
   *
   * Se pide al desplegar y no con la lista: la mayoría de los enlaces no se
   * miran nunca en detalle, y esto es una consulta de agregación por pase.
   */
  protected async verLectura(passId: string): Promise<void> {
    if (this.lectura()?.passId === passId) {
      this.lectura.set(null);
      return;
    }
    const sesion = this.sesion();
    if (!sesion) return;
    try {
      this.lectura.set({ passId, resumen: await this.api.lecturaDelPase(sesion, passId) });
    } catch {
      this.lectura.set(null);
    }
  }

  /**
   * Tiempo de lectura, REDONDEADO a propósito.
   *
   * «Unos 4 minutos» es lo que alguien necesita saber para decidir si llamar.
   * «4 min 12 s» sugiere una vigilancia que ni es exacta —el navegador mide a
   * ojo— ni es sana enseñar de una persona identificada.
   */
  protected enLectura(ms: number): string {
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

  protected async copiar(): Promise<void> {
    await navigator.clipboard.writeText(this.enlace());
    this.copiado.set(true);
  }
}
