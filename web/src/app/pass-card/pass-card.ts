import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { MediaItem } from '../core/api';

export type EstadoPase = 'activo' | 'caducado' | 'cargando';

/**
 * Tarjeta del pase: cabecera con el enlace y su estado, mosaico de medios y
 * marca de agua por visita superpuesta.
 */
@Component({
  selector: 'app-pass-card',
  templateUrl: './pass-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      width: 100%;
    }
  `,
})
export class PassCard {
  readonly enlace = input.required<string>();
  readonly estado = input<EstadoPase>('activo');
  readonly medios = input<MediaItem[]>([]);
  readonly marca = input<string>('');

  protected readonly etiquetaEstado = computed(
    () => ({ activo: 'ACTIVO', caducado: 'CADUCADO', cargando: 'ABRIENDO' })[this.estado()],
  );

  protected readonly activo = computed(() => this.estado() === 'activo');

  /** El primer medio de cada bloque de cuatro ocupa el doble de alto (mosaico). */
  protected destacado(i: number): boolean {
    return i % 4 === 0;
  }

  /** Degradado de reserva: se ve mientras carga el medio y si no hay imagen. */
  protected degradado(i: number): string {
    const verde = 'linear-gradient(150deg, #4f9f7f 0%, #58b49b 55%, #6cc3a8 100%)';
    const azul = 'linear-gradient(150deg, #5b87b0 0%, #6e9cbe 55%, #86b1cd 100%)';
    return i % 4 === 1 || i % 4 === 2 ? azul : verde;
  }

  protected ocultar(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }
}
