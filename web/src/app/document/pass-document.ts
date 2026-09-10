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

/**
 * Con cuánto aire se lee el documento. Ausente = `sobrio`.
 *
 * No decide claro u oscuro: eso es el tema del PASE. Aquí solo cambian el aire
 * y el cuerpo de la letra, que es lo que separa un dosier que se LEE de un
 * catálogo que se HOJEA.
 */
export type Estilo = 'sobrio' | 'editorial' | 'compacto';

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
  host: {
    '[class.tema-claro]': "tema() === 'claro'",
    '[class.estilo-editorial]': "estilo() === 'editorial'",
    '[class.estilo-compacto]': "estilo() === 'compacto'",
  },
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

    /*
     * ====================== LAS MEDIDAS DEL DOCUMENTO ======================
     *
     * Todas las que cambian de un estilo a otro, en un solo sitio y con valores
     * ABSOLUTOS, no factores.
     *
     * La primera versión de esto eran dos factores —aire y letra— que
     * multiplicaban un margen y un tamaño. En pantalla no se distinguía nada:
     * 80, 116 y 52 píxeles de separación y 16, 17,9 y 15 de letra se leen como
     * el mismo documento tres veces, y con razón. Si un ajuste se llama
     * «editorial» y «compacto», tiene que verse desde el otro lado de la mesa.
     *
     * Lo que de verdad separa un dosier que se LEE de un catálogo que se HOJEA
     * no es el tamaño de la letra: es cuántas piezas caben a la vez, cuánto
     * aire hay alrededor y qué manda en la página, si el texto o las fotos. Por
     * eso hay ocho medidas y no dos.
     *
     * Y ninguna toca el COLOR. El claro y el oscuro los decide quien manda el
     * enlace, no quien monta el perfil: eso es el tema del pase.
     */
    :host {
      /* SOBRIO: el de siempre. Equilibrado entre texto y foto. */
      --doc-aire: 5rem;
      --doc-cuerpo: 17px;
      --doc-interlineado: 1.8;
      --doc-parrafos: 1.25em;
      --doc-medida: 58ch;
      --doc-entradilla: clamp(1.05rem, 1.6vw, 1.2rem);
      --doc-lado: 180px;
      --doc-columnas: 3;
      --doc-hueco: 0.75rem;
      --doc-tira: 260px;
      --doc-pie: 13px;
      /* El título del apartado: etiqueta de maquinaria, en mono y pequeña. */
      --doc-titulo-familia: var(--font-mono);
      --doc-titulo-tam: 11px;
      --doc-titulo-espaciado: 0.24em;
      --doc-titulo-caja: uppercase;
      --doc-titulo-peso: 400;
      --doc-titulo-margen: 0;
      --doc-titulo-filete: 0;

      /* DOSIER: el título va en su columna y se queda anclado al recorrer. */
      --doc-rejilla-apartado: var(--doc-lado) 1fr;
      --doc-lado-posicion: sticky;
      --doc-lado-alineacion: start;
      --doc-numero: none;

      /* El texto cuenta y luego se enseña. */
      --doc-orden-texto: 1;
      --doc-orden-fotos: 2;

      /* Las fotos van enmarcadas: es lo que hace que se lea ordenado. */
      --doc-foto-radio: 0.5rem;
      --doc-foto-borde: 1px solid var(--color-borde-2);

      /* Sin capitular: es una firma de revista y aquí no toca. */
      --doc-capitular: 1em;
      --doc-capitular-flota: none;
      --doc-capitular-peso: inherit;

      /* Los apartados se numeran desde uno en cada documento. */
      counter-reset: apartado;
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

    /*
     * El mismo documento, en claro. Mismos nombres, otros valores.
     *
     * Los valores son LOS MISMOS que el tema claro de web/src/styles.css, y
     * hay una prueba que se pone roja si dejan de serlo. No se pueden heredar:
     * cuando el navegador de quien lee está en oscuro, esos tokens ya vienen
     * reasignados, y heredarlos traería justo lo que hay que deshacer. Así que
     * es una copia a la fuerza, y por eso está vigilada.
     *
     * Lo que cambió con ellos: el suelo dejó de ser casi blanco. Con #f7f9fa
     * bajo tarjetas #ffffff no había dónde apoyarse y el documento salía plano;
     * un suelo de verdad también hace que las fotos respiren, que es lo que
     * este documento existe para enseñar.
     */
    :host(.tema-claro) {
      --color-fondo: #e3ebee;
      --color-sup: #ffffff;
      --color-sup-2: #eaf1f3;
      --color-sup-3: #d7e2e6;
      --color-borde: #c2d2d7;
      --color-borde-2: #d5e0e3;
      --color-borde-3: #e6edef;
      --color-titulo: #062330;
      --color-texto: #0d2a35;
      --color-texto-2: #294b56;
      --color-texto-3: #3d5c66;
      --color-texto-4: #46646d;
      --color-acento: #166534;
      --color-acento-tenue: #15803d;
      --color-sobre-acento: #ffffff;
    }

    /*
     * EDITORIAL: para dosieres que se LEEN.
     *
     * El cambio que se nota no es el cuerpo de letra: es que el título del
     * apartado deja de ser una etiqueta técnica en mayúsculas y pasa a ser un
     * titular en serif, y que las fotos bajan a dos por fila con aire de
     * verdad alrededor. La página deja de parecer una ficha y pasa a parecer
     * una página.
     */
    :host(.estilo-editorial) {
      --doc-aire: 8.5rem;
      /* Una sola columna: el titular va SOBRE el texto, como en una página. */
      --doc-rejilla-apartado: 1fr;
      --doc-lado-posicion: static;
      --doc-lado-alineacion: stretch;
      --doc-titulo-peso: 500;
      --doc-titulo-margen: 0.35em;
      --doc-titulo-filete: 1px;
      /* Los apartados van numerados, que es la otra firma de una revista. */
      --doc-numero: counter(apartado, decimal-leading-zero) ' · ';
      /* Sin marco ni esquinas: la foto es la página, no una tarjeta. */
      --doc-foto-radio: 0;
      --doc-foto-borde: none;
      /* Capitular en la entradilla. */
      --doc-capitular: 3.1em;
      --doc-capitular-flota: left;
      --doc-capitular-peso: 500;
      --doc-cuerpo: 20px;
      --doc-interlineado: 1.95;
      --doc-parrafos: 1.5em;
      --doc-medida: 60ch;
      --doc-entradilla: clamp(1.35rem, 2.8vw, 2rem);
      --doc-lado: 230px;
      --doc-columnas: 2;
      --doc-hueco: 1.75rem;
      --doc-tira: 360px;
      --doc-pie: 14px;
      --doc-titulo-familia: var(--font-serif);
      --doc-titulo-tam: clamp(1.45rem, 2.4vw, 1.9rem);
      --doc-titulo-espaciado: -0.01em;
      --doc-titulo-caja: none;
    }

    /*
     * COMPACTO: para catálogos largos, que se HOJEAN.
     *
     * Cuatro fotos por fila, huecos mínimos y apartados casi pegados: lo que se
     * busca es que quepan muchas piezas a la vista y que haya que desplazarse
     * lo menos posible. El texto se aparta: la columna se ensancha para que
     * ocupe menos alto.
     */
    :host(.estilo-compacto) {
      --doc-aire: 2.5rem;
      /* Banda con filete arriba, ancho completo, y la mercancía debajo. */
      --doc-rejilla-apartado: 1fr;
      --doc-lado-posicion: static;
      --doc-lado-alineacion: stretch;
      --doc-titulo-margen: 0.5em;
      --doc-titulo-filete: 1px;
      /* LAS FOTOS PRIMERO: un catálogo enseña y luego explica. */
      --doc-orden-texto: 3;
      --doc-orden-fotos: 2;
      --doc-foto-radio: 0.25rem;
      --doc-foto-borde: 1px solid var(--color-borde-3);
      --doc-cuerpo: 15px;
      --doc-interlineado: 1.55;
      --doc-parrafos: 0.9em;
      --doc-medida: 76ch;
      --doc-entradilla: 1rem;
      --doc-lado: 140px;
      --doc-columnas: 4;
      --doc-hueco: 0.375rem;
      --doc-tira: 190px;
      --doc-pie: 11px;
      --doc-titulo-familia: var(--font-mono);
      --doc-titulo-tam: 10px;
      --doc-titulo-espaciado: 0.18em;
      --doc-titulo-caja: uppercase;
    }

    /*
     * Dónde se aplican.
     *
     * Estas reglas sustituyen a las utilidades que antes llevaban los mismos
     * elementos escritas a mano: el 17px del cuerpo, el hueco de la rejilla, el
     * ancho de la columna del título. Es
     * a propósito: con las dos cosas a la vez habría dos fuentes para la misma
     * medida y el estilo solo cambiaría la mitad de la página, que es
     * exactamente lo que hacía antes.
     */
    .doc-entradilla {
      max-width: var(--doc-medida);
      font-size: var(--doc-entradilla);
      line-height: 1.55;
    }

    .doc-apartado {
      margin-top: var(--doc-aire);
      column-gap: 2.5rem;
      counter-increment: apartado;
    }

    @media (min-width: 768px) {
      .doc-apartado {
        grid-template-columns: var(--doc-rejilla-apartado);
      }
    }

    /*
     * El encabezado. Anclado en el dosier —se queda a la vista mientras se
     * recorre un bloque largo— y quieto en las otras dos, donde va encima del
     * contenido y anclarlo solo taparía la página.
     */
    @media (min-width: 768px) {
      .doc-lado {
        position: var(--doc-lado-posicion);
        top: 5rem;
        align-self: var(--doc-lado-alineacion);
      }
    }

    .doc-titulo-apartado {
      font-family: var(--doc-titulo-familia);
      font-size: var(--doc-titulo-tam);
      font-weight: var(--doc-titulo-peso);
      letter-spacing: var(--doc-titulo-espaciado);
      text-transform: var(--doc-titulo-caja);
      line-height: 1.25;
      padding-top: var(--doc-titulo-margen);
      border-top: var(--doc-titulo-filete) solid var(--color-borde-3);
    }

    /*
     * El número del apartado. Es una firma de maqueta, no información, y por eso
     * va en un pseudoelemento y no en la plantilla: así no entra en el HTML que
     * se guarda ni depende de que alguien lo escriba bien.
     *
     * OJO, sin embargo: el contenido generado por CSS SÍ lo anuncian la mayoría
     * de los lectores de pantalla actuales, así que quien use uno oirá «cero uno
     * punto» antes del título. Es ruido menor y localizado —solo en esta
     * maqueta, solo en los títulos de apartado— y se acepta a sabiendas; lo que
     * no se puede es decir que no ocurre.
     */
    .doc-titulo-apartado::before {
      content: var(--doc-numero);
      color: var(--color-texto-4);
    }

    .doc-orden-texto {
      order: var(--doc-orden-texto);
    }

    .doc-orden-fotos {
      order: var(--doc-orden-fotos);
    }

    /*
     * En el catálogo las fotos van primero, así que el margen superior que
     * separa la foto del texto sobra arriba y falta abajo.
     */
    :host(.estilo-compacto) .doc-orden-fotos {
      margin-top: 0;
    }

    :host(.estilo-compacto) .doc-orden-texto {
      margin-top: 1.25rem;
    }

    .doc-foto {
      border-radius: var(--doc-foto-radio);
      border: var(--doc-foto-borde);
    }

    .doc-foto:focus-visible {
      border-color: var(--color-acento);
      outline: 2px solid var(--color-acento);
      outline-offset: 2px;
    }

    /*
     * La capitular de la entradilla: solo en revista, y solo ahí.
     *
     * Es el detalle que hace que se lea como una página impresa y no como una
     * ficha. En las otras dos maquetas mide un cuadratín y no flota, o sea, no existe:
     * una capitular en un catálogo es un adorno fuera de sitio.
     */
    .doc-entradilla::first-letter {
      font-size: var(--doc-capitular);
      float: var(--doc-capitular-flota);
      font-weight: var(--doc-capitular-peso);
      line-height: 0.85;
      padding-right: 0.08em;
      padding-top: 0.06em;
      color: var(--color-titulo);
    }

    .doc-lectura {
      max-width: var(--doc-medida);
      font-size: var(--doc-cuerpo);
      line-height: var(--doc-interlineado);
    }

    .doc-lectura > p + p {
      margin-top: var(--doc-parrafos);
    }

    /*
     * Dos columnas hasta el móvil ancho pase lo que pase: cuatro fotos en una
     * pantalla de teléfono no son un catálogo, son sellos.
     */
    .doc-rejilla {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--doc-hueco);
    }

    @media (min-width: 640px) {
      .doc-rejilla {
        grid-template-columns: repeat(var(--doc-columnas), minmax(0, 1fr));
      }
    }

    .doc-tira {
      gap: var(--doc-hueco);
    }

    .doc-pie {
      font-size: var(--doc-pie);
      line-height: 1.55;
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
  /**
   * El aire con el que se lee. Va por clase en el host, como el tema, y lo
   * único que toca son dos variables de escala: ni una regla suelta por
   * estilo. Con reglas sueltas, el tercer estilo se olvida en la mitad de los
   * sitios y el documento sale a medias.
   */
  readonly estilo = input<Estilo>('sobrio');
  /** Enlace mostrado en la barra de estado. */
  readonly enlace = input('');

  /**
   * Alto de las fotos del carrusel, en píxeles.
   *
   * Vive en TypeScript y no en el CSS porque el ANCHO de cada foto se calcula
   * multiplicándolo por su proporción real, que es lo que hace que el carrusel
   * no recorte nada. Con el alto en una variable de CSS y el ancho aquí, los
   * dos se separarían al primer cambio y las fotos saldrían deformadas.
   */
  protected readonly altoDeTira = computed(
    () => ({ sobrio: 260, editorial: 360, compacto: 190 })[this.estilo()],
  );

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
