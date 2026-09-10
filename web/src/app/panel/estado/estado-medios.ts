import { Injectable, inject, signal } from '@angular/core';
import { Api } from '../../core/api';
import { EstadoPerfil } from './estado-perfil';
import { NucleoPanel } from './nucleo';

/**
 * Subir cosas: las fotos de un bloque y el logotipo del perfil.
 *
 * Está aparte del contenido a propósito. Editar un texto es cambiar un dato que
 * ya se tiene; subir un archivo es una conversación con el servidor en dos
 * pasos —se reserva cuota y se firma, y solo después se mandan los bytes— con
 * sus propios modos de fallar: el archivo no es lo que dice ser, pasa del
 * límite por tipo, o el perfil ya no tiene sitio. Mezclarlo con la edición hacía
 * que esos tres casos acabaran bajo el mismo «no se pudo guardar».
 *
 * Dos reglas que se conservan íntegras del panel de una pieza:
 *
 *   - En el contenido solo va el `mediaId`, nunca la clave de almacenamiento.
 *     La fila manda: un medio existe porque hay fila en `vistta.media` y la fila
 *     dice de qué perfil es. Con claves dentro del JSON, un usuario podía
 *     escribir la de otro y el backend la firmaba.
 *   - El logotipo lo reduce el SERVIDOR. Hacerlo en el navegador daría un
 *     resultado distinto según el equipo, y lo que hay que creerse es lo que
 *     guarda el servidor, no lo que dice el cliente que subió.
 */
@Injectable({ providedIn: 'root' })
export class EstadoMedios {
  private readonly api = inject(Api);
  private readonly nucleo = inject(NucleoPanel);
  private readonly perfil = inject(EstadoPerfil);

  readonly subiendoLogo = signal(false);
  readonly errorLogo = signal('');

  async subirFotos(i: number, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const sesion = this.nucleo.token();
    if (!sesion || !input.files?.length) return;

    this.nucleo.ocupado.set(true);
    this.nucleo.error.set('');
    try {
      for (const file of Array.from(input.files)) {
        const medio = await this.api.uploadMedia(sesion, this.perfil.perfilId(), file);
        this.perfil.miniaturas.update((m) => ({ ...m, [medio.id]: URL.createObjectURL(file) }));
        // En el contenido solo va el id: el tipo y las dimensiones los sabe el
        // servidor, que es el único que ha mirado los bytes.
        this.perfil.editarSeccion(i, {
          items: [...this.perfil.itemsDe(i), { mediaId: medio.id, caption: '' }],
        });
      }
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      // El 413 tiene dos causas —el archivo o la cuota— y el mensaje del
      // servidor distingue cuál: repetirlo aquí a ciegas mandaría al cliente a
      // reducir una foto cuando el problema es que ya no le queda sitio.
      const motivo = (err as { error?: { error?: string } }).error?.error ?? '';
      this.nucleo.error.set(
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
      this.nucleo.ocupado.set(false);
    }
  }

  /**
   * Sube el logotipo del perfil.
   *
   * Se manda el archivo tal cual y el servidor devuelve el data URI ya
   * reducido: aquí no se comprime nada.
   */
  async elegirLogo(evento: Event): Promise<void> {
    const archivo = (evento.target as HTMLInputElement).files?.[0];
    if (!archivo) return;
    const sesion = this.nucleo.token();
    if (!sesion) return;

    this.subiendoLogo.set(true);
    this.errorLogo.set('');
    try {
      const { logo } = await this.api.subirLogo(sesion, this.perfil.perfilId(), archivo);
      this.perfil.logo.set(logo);
    } catch {
      this.errorLogo.set('No se pudo usar esa imagen. Prueba con un PNG o un SVG rasterizado.');
    } finally {
      this.subiendoLogo.set(false);
    }
  }

  async quitarLogo(): Promise<void> {
    const sesion = this.nucleo.token();
    if (!sesion) return;
    try {
      await this.api.quitarLogo(sesion, this.perfil.perfilId());
      this.perfil.logo.set(null);
    } catch {
      this.errorLogo.set('No se pudo quitar el logotipo.');
    }
  }

  /** Megabytes con un decimal. En bytes no lo entiende nadie. */
  enMegas(bytes: number): string {
    return (bytes / 1048576).toFixed(1);
  }
}
