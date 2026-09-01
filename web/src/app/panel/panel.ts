import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Api,
  type EditableSection,
  type MediaRef,
  type ProfileContent,
  type ProfileRow,
  type Usuario,
} from '../core/api';
import { PassDocument, type DocSection } from '../document/pass-document';

/** Panel: entrar con PIN, montar el contenido y generar el enlace. */
@Component({
  selector: 'app-panel',
  imports: [FormsModule, PassDocument],
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

  /** La sesión sobrevive a un F5 dentro de la misma pestaña, no más allá. */
  private static readonly CLAVE_SESION = 'vistta.sesion';

  protected usuarioId = '';
  protected contrasena = '';
  protected readonly sesion = signal<string | null>(null);
  protected readonly usuario = signal<Usuario | null>(null);
  protected readonly perfiles = signal<ProfileRow[]>([]);
  protected readonly perfilId = signal('');
  protected readonly nombre = signal('');
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

  private async abrirPanel(token: string, user: Usuario): Promise<void> {
    this.sesion.set(token);
    this.usuario.set(user);
    const { profiles } = await this.api.profiles(token);
    this.perfiles.set(profiles);
    if (profiles[0]) await this.elegirPerfil(profiles[0].id);
  }

  protected async salir(): Promise<void> {
    const token = this.sesion();
    sessionStorage.removeItem(Panel.CLAVE_SESION);
    this.sesion.set(null);
    this.usuario.set(null);
    this.perfiles.set([]);
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
    await this.cargarMiniaturas();
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
      const { url } = await this.api.createPass(sesion, this.perfilId());
      this.enlace.set(url);
    } catch {
      this.error.set('No se pudo generar el enlace. Vuelve a entrar con el PIN.');
    } finally {
      this.ocupado.set(false);
    }
  }

  protected async copiar(): Promise<void> {
    await navigator.clipboard.writeText(this.enlace());
    this.copiado.set(true);
  }
}
