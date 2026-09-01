import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Api, type PassView } from '../core/api';
import { PassDocument } from '../document/pass-document';

type Estado = 'cargando' | 'abierto' | 'denegado';

/**
 * Viewer público: abre el pase (lo consume) y monta el documento.
 * Si el enlace ya se usó o caducó, solo queda el estado denegado.
 */
@Component({
  selector: 'app-viewer',
  imports: [PassDocument],
  templateUrl: './viewer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class Viewer {
  private readonly api = inject(Api);
  private readonly ruta = inject(ActivatedRoute);

  protected readonly estado = signal<Estado>('cargando');
  protected readonly vista = signal<PassView | null>(null);
  protected readonly enlace = signal('');

  constructor() {
    const token = this.ruta.snapshot.paramMap.get('token') ?? '';
    this.enlace.set(`${location.host}/v/${token.slice(0, 4)}…`);
    void this.abrir(token);
  }

  private async abrir(token: string): Promise<void> {
    try {
      this.vista.set(await this.api.open(token));
      this.estado.set('abierto');
    } catch {
      // Usado, caducado o inexistente: para el cliente es lo mismo.
      this.estado.set('denegado');
    }
  }
}
