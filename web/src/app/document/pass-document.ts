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
   * Rejilla justificada, calculada con las proporciones REALES de cada foto.
   *
   * Antes esto era un ciclo fijo de anchos y proporciones —la foto 1 ocupa
   * cuatro columnas, la 2 dos, y así— con la proporción real superpuesta encima.
   * Tres reglas peleándose por la misma caja: ganaba la última y las otras dos
   * sobraban, y una foto vertical acababa recortada dentro de un hueco
   * apaisado.
   *
   * Ahora se hace como lo hace cualquier galería que se lea bien: cada foto
   * ocupa un ancho PROPORCIONAL a lo apaisada que sea, y la fila se reparte
   * entre las que caben. Como todas crecen en proporción a su ratio, todas
   * acaban con la misma altura y la fila cierra exacta, sin recortar ninguna y
   * sin dejar huecos. Es lo que el bloque D hizo posible al guardar `width` y
   * `height` medidos de los bytes: sin eso, esto no se puede calcular.
   *
   * Todo en CSS, sin medir el contenedor ni escuchar el `resize`: reflota solo
   * al cambiar el ancho de la ventana.
   */
  private static readonly PROPORCION_POR_DEFECTO = 3 / 2;

  /** Alto al que se aspira por fila. Es un objetivo, no una imposición. */
  private static readonly ALTO_OBJETIVO = 260;

  /**
   * Cuánto se deja estirar una foto por encima de su tamaño natural.
   *
   * Sin tope, una foto que se queda sola en la última fila crece hasta el ancho
   * completo: una vertical de dos metros de alto en mitad del documento.
   */
  private static readonly ESTIRAMIENTO_MAXIMO = 1.6;

  protected proporcionDe(foto: DocMedia): number {
    if (!foto.width || !foto.height) return PassDocument.PROPORCION_POR_DEFECTO;
    return foto.width / foto.height;
  }

  /** El reparto de la fila: crece en proporción a lo ancha que sea la foto. */
  protected flex(foto: DocMedia): string {
    const r = this.proporcionDe(foto);
    return `${r} 1 ${Math.round(r * PassDocument.ALTO_OBJETIVO)}px`;
  }

  protected topeDeAncho(foto: DocMedia): string {
    const r = this.proporcionDe(foto);
    return `${Math.round(r * PassDocument.ALTO_OBJETIVO * PassDocument.ESTIRAMIENTO_MAXIMO)}px`;
  }

  /** La proporción exacta de la caja, para que nada se recorte. */
  protected relacion(foto: DocMedia): string {
    return `${this.proporcionDe(foto)}`;
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
}
