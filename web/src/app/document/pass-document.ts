import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';

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

export type Presentacion = 'cuadricula' | 'carrusel';

export interface DocSection {
  type: 'texto' | 'galeria' | 'proyecto';
  title?: string;
  body?: string;
  items: DocMedia[];
  /** Cómo se presentan las fotos. Ausente = cuadrícula. */
  display?: Presentacion;
}

export interface DocProfile {
  /** Logotipo del cliente, ya reducido a data URI por el servidor. */
  logo?: string | null;
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
  host: { '[class.tema-claro]': "tema() === 'claro'" },
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /*
     * El documento trae SU PROPIA paleta, y esto es lo importante de todo el
     * archivo: redefine los mismos tokens que usa el resto de la aplicación,
     * pero acotados a este componente. Así las utilidades de dentro
     * (text-texto-2, bg-sup…) pintan con los colores del PASE.
     *
     * La consecuencia es la que se busca: el aspecto del documento lo decide
     * quien manda el enlace, no el navegador de quien lo abre. Alguien con el
     * móvil en modo oscuro que reciba un pase claro lo verá claro, que es como
     * su remitente quiso enseñar ese trabajo.
     */
    :host {
      display: block;
      min-height: 100%;
      --color-fondo: #060e17;
      --color-sup: #0a1620;
      --color-sup-2: #081420;
      --color-sup-3: #04101a;
      --color-borde: #1c3b44;
      --color-borde-2: #16303a;
      --color-borde-3: #12262f;
      --color-titulo: #e9f6f3;
      --color-texto: #d7e9e6;
      --color-texto-2: #a8c3c5;
      --color-texto-3: #8aa8b0;
      --color-texto-4: #7b989f;
      --color-acento: #34d399;
      --color-acento-tenue: #7fd8bd;
      --color-sobre-acento: #04140e;
      background-color: var(--color-fondo);
      color: var(--color-texto);
    }

    /* El mismo documento, en claro. Mismos nombres, otros valores. */
    :host(.tema-claro) {
      --color-fondo: #f7f9fa;
      --color-sup: #ffffff;
      --color-sup-2: #eef3f4;
      --color-sup-3: #e4ebed;
      --color-borde: #d3dfe2;
      --color-borde-2: #e2eaec;
      --color-borde-3: #edf2f3;
      --color-titulo: #07242f;
      --color-texto: #0f2c37;
      --color-texto-2: #33545e;
      --color-texto-3: #4c6a73;
      --color-texto-4: #556d75;
      --color-acento: #09714f;
      --color-acento-tenue: #0f8f66;
      --color-sobre-acento: #ffffff;
    }
  `,
})
export class PassDocument {
  readonly profile = input.required<DocProfile>();
  readonly secciones = input<DocSection[]>([]);
  readonly marca = input('');
  /**
   * Aspecto del documento. Se aplica como clase en el host, que es donde vive
   * la paleta: `host: { '[class.tema-claro]': ... }` de abajo.
   */
  readonly tema = input<'oscuro' | 'claro'>('oscuro');
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
   * Cómo se presentan las fotos de un bloque.
   *
   * Antes había una sola forma: una rejilla «justificada» que repartía cada
   * fila en proporción a lo apaisada que fuera cada foto. La idea era buena y
   * el resultado no: el tope de ancho que impedía que una foto suelta creciera
   * hasta el ancho completo ROMPÍA esa proporción, así que una vertical
   * quedaba pequeña al lado de una apaisada y las filas salían desiguales. Se
   * midió sobre el documento real: seis fotos daban cuatro filas irregulares.
   *
   * Ahora hay dos, y las elige quien monta el perfil:
   *
   *   cuadrícula — celdas iguales en filas regulares. Es el que da sensación
   *                de orden, y el que se aplica si no se dice nada.
   *   carrusel   — una tira horizontal que se desliza, sin recortar nada.
   *
   * La cuadrícula RECORTA para que las celdas cuadren; el carrusel no recorta
   * nada. Entre las dos está cubierto el compromiso, y en cualquier caso al
   * pulsar una foto se abre entera.
   */
  protected presentacion(seccion: DocSection): Presentacion {
    return seccion.display ?? 'cuadricula';
  }

  /** Proporción real de la foto. Sin dimensiones, se asume apaisada 3:2. */
  protected proporcionDe(foto: DocMedia): number {
    if (!foto.width || !foto.height) return 3 / 2;
    return foto.width / foto.height;
  }

  /** La proporción exacta de la caja, para que el carrusel no recorte nada. */
  protected relacion(foto: DocMedia): string {
    return `${this.proporcionDe(foto)}`;
  }

  // --- ampliar una foto -----------------------------------------------------

  /**
   * Ver una foto en grande.
   *
   * El plan decía «viewer con CDK», y se ha hecho con el `<dialog>` nativo. No
   * es pereza: el CDK entero entraría en el bundle del viewer, que es la única
   * superficie que abre alguien que no es cliente nuestro y desde el móvil,
   * probablemente con datos. `showModal()` ya trae lo que se necesitaba del
   * CDK —atrapa el foco, cierra con Escape, tapa el fondo y devuelve el foco al
   * botón de origen al cerrar— y cuesta cero bytes.
   *
   * Se navega por TODAS las fotos del documento, no por las de su sección: quien
   * lo abre está leyendo de arriba abajo y espera que «siguiente» siga.
   */
  private readonly dialogo = viewChild<ElementRef<HTMLDialogElement>>('ampliador');

  protected readonly ampliada = signal<DocMedia | null>(null);

  /** Todas las fotos del documento en orden de lectura. */
  protected readonly todas = computed(() => this.secciones().flatMap((s) => s.items));

  protected ampliar(foto: DocMedia): void {
    this.ampliada.set(foto);
    // Después de que Angular pinte el contenido del diálogo, no antes.
    queueMicrotask(() => this.dialogo()?.nativeElement.showModal());
  }

  protected cerrarAmpliada(): void {
    this.dialogo()?.nativeElement.close();
    this.ampliada.set(null);
  }

  /**
   * Anterior o siguiente. No da la vuelta a propósito: en un documento con
   * final, llegar al borde y quedarse quieto dice «se acabó» mejor que volver
   * a empezar sin avisar.
   */
  protected mover(paso: number): void {
    const fotos = this.todas();
    const actual = this.ampliada();
    if (!actual) return;
    const i = fotos.indexOf(actual);
    const siguiente = fotos[i + paso];
    if (siguiente) this.ampliada.set(siguiente);
  }

  protected hayVecina(paso: number): boolean {
    const actual = this.ampliada();
    if (!actual) return false;
    const fotos = this.todas();
    return fotos[fotos.indexOf(actual) + paso] !== undefined;
  }

  /** El sitio de la foto en el documento, para anunciarlo al abrirla. */
  protected posicionAmpliada = computed(() => {
    const actual = this.ampliada();
    return actual ? this.todas().indexOf(actual) + 1 : 0;
  });

  protected teclas(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.mover(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.mover(-1);
    }
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
