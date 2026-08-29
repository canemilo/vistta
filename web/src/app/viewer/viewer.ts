import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Api, type MediaItem } from '../core/api';
import { PassCard, type EstadoPase } from '../pass-card/pass-card';

/**
 * Viewer público: abre el pase (lo consume) y muestra el trabajo.
 * Si el enlace ya se usó o caducó, solo queda el estado denegado.
 */
@Component({
  selector: 'app-viewer',
  imports: [PassCard],
  templateUrl: './viewer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      width: 100%;
    }
  `,
})
export class Viewer {
  private readonly api = inject(Api);
  private readonly ruta = inject(ActivatedRoute);

  protected readonly estado = signal<EstadoPase>('cargando');
  protected readonly medios = signal<MediaItem[]>([]);
  protected readonly marca = signal('');
  protected readonly titulo = signal('');
  protected readonly enlace = signal('');

  constructor() {
    const token = this.ruta.snapshot.paramMap.get('token') ?? '';
    this.enlace.set(`${location.host}/v/${token.slice(0, 4)}…`);
    void this.abrir(token);
  }

  private async abrir(token: string): Promise<void> {
    try {
      const vista = await this.api.open(token);
      this.titulo.set(vista.profile.displayName);
      this.medios.set(vista.media);
      this.marca.set(vista.watermark);
      this.estado.set('activo');
    } catch {
      // Usado, caducado o inexistente: para el cliente es lo mismo.
      this.estado.set('caducado');
    }
  }
}
