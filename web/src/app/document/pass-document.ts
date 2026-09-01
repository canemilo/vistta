import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface DocMedia {
  url: string;
  type?: 'image' | 'video' | 'doc';
  caption?: string;
  /** Medidas en el servidor al subir: el cliente nunca las declara. */
  width?: number | null;
  height?: number | null;
  /** Miniatura de 16 px en data URI, para el hueco mientras carga la de verdad. */
  lqip?: string | null;
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

  /**
   * Lo que se ve en el hueco mientras carga la foto.
   *
   * Si el medio trae su miniatura de 16 px, se usa esa: es un borrón con los
   * colores reales de la foto, así que la página no cambia de tono al terminar
   * de cargar. Cuando no la hay —un medio sembrado antes del bloque D, o un
   * vídeo—, queda el degradado de siempre.
   */
  protected fondo(i: number, foto?: DocMedia): string {
    if (foto?.lqip) return `url("${foto.lqip}")`;
    const verde = 'linear-gradient(150deg, #24413f 0%, #2f5a4f 55%, #3a6b5c 100%)';
    const azul = 'linear-gradient(150deg, #22384a 0%, #2c4a63 55%, #375a76 100%)';
    return i % 3 === 1 ? azul : verde;
  }

  /**
   * Proporción real de la foto, para que el hueco tenga ya la forma buena y la
   * página no dé un salto al cargar. Sin dimensiones se cae a la rejilla fija.
   */
  protected relacion(foto: DocMedia): string | null {
    return foto.width && foto.height ? `${foto.width} / ${foto.height}` : null;
  }
}
