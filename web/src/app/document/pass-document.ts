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
