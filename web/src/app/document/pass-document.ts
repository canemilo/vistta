import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface DocMedia {
  url: string;
  type?: 'image' | 'video' | 'doc';
  caption?: string;
}

export interface DocSection {
  type: 'texto' | 'galeria' | 'proyecto';
  title?: string;
  body?: string;
  items: DocMedia[];
}

export interface DocProfile {
  displayName: string;
  tagline?: string;
  intro?: string;
}

/**
 * El documento que ve el cliente. Recibe bloques y monta la estructura: no hay
 * plantillas por perfil, la misma composición sirve para cualquier contenido.
 */
@Component({
  selector: 'app-pass-document',
  templateUrl: './pass-document.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class PassDocument {
  readonly profile = input.required<DocProfile>();
  readonly secciones = input<DocSection[]>([]);
  readonly marca = input('');
  /** Enlace mostrado en la barra de estado. */
  readonly enlace = input('');

  protected readonly totalFotos = computed(() =>
    this.secciones().reduce((n, s) => n + s.items.length, 0),
  );

  protected readonly hora = computed(() => {
    const partes = this.marca().split('·');
    return partes.length ? partes[partes.length - 1].trim() : '';
  });

  /**
   * Mosaico de seis columnas: cada fila cierra a seis y las proporciones de las
   * piezas que la componen casan en altura (3/2 junto a 3/4, o 3/2 y 3/2).
   * El ancho va en la celda y la proporción en la caja de la foto, para que el
   * pie de foto tenga su propio sitio debajo.
   */
  private readonly ANCHOS = [
    'md:col-span-4',
    'md:col-span-2',
    'md:col-span-2',
    'md:col-span-4',
    'md:col-span-3',
    'md:col-span-3',
  ];
  private readonly PROPORCIONES = [
    'md:aspect-3/2',
    'md:aspect-3/4',
    'md:aspect-3/4',
    'md:aspect-3/2',
    'md:aspect-3/2',
    'md:aspect-3/2',
  ];

  protected ancho(i: number): string {
    return this.ANCHOS[i % this.ANCHOS.length];
  }

  protected proporcion(i: number): string {
    return this.PROPORCIONES[i % this.PROPORCIONES.length];
  }

  protected ocultar(event: Event): void {
    (event.target as HTMLImageElement).style.opacity = '0';
  }

  /** Degradado de reserva mientras carga la foto (o si falta el objeto). */
  protected fondo(i: number): string {
    const verde = 'linear-gradient(150deg, #24413f 0%, #2f5a4f 55%, #3a6b5c 100%)';
    const azul = 'linear-gradient(150deg, #22384a 0%, #2c4a63 55%, #375a76 100%)';
    return i % 3 === 1 ? azul : verde;
  }
}
