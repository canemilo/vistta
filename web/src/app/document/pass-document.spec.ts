import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { PassDocument, type DocSection } from './pass-document';

/**
 * La ampliación de foto del viewer.
 *
 * Se prueba por el DOM y no llamando a los métodos: lo que hay que demostrar es
 * que un cliente puede abrir una foto y recorrerlas, no que existan unas
 * funciones con esos nombres. Es también la primera prueba de frontend del
 * proyecto; el arnés (Karma + ChromeHeadless) ya estaba configurado y sin usar.
 */
const SECCIONES: DocSection[] = [
  {
    type: 'proyecto',
    title: 'Litoral',
    items: [
      { url: '/m/uno', caption: 'Primera luz', width: 1600, height: 1067 },
      { url: '/m/dos', width: 1000, height: 1500 },
    ],
  },
  {
    type: 'galeria',
    title: 'Interiores',
    items: [{ url: '/m/tres', caption: 'Patio', width: 1200, height: 800 }],
  },
];

describe('PassDocument · ampliar una foto', () => {
  let fixture: ComponentFixture<PassDocument>;

  const dialogo = () => fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
  const fotos = () =>
    Array.from(fixture.nativeElement.querySelectorAll('figure button')) as HTMLButtonElement[];
  const botonDe = (etiqueta: string) =>
    fixture.nativeElement.querySelector(`dialog [aria-label="${etiqueta}"]`) as HTMLButtonElement;
  const ampliadaSrc = () =>
    (fixture.nativeElement.querySelector('dialog img') as HTMLImageElement | null)?.getAttribute(
      'src',
    ) ?? null;

  /** `showModal()` es asíncrono respecto al pintado: hay un microtask de por medio. */
  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PassDocument] }).compileComponents();
    fixture = TestBed.createComponent(PassDocument);
    fixture.componentRef.setInput('profile', { displayName: 'Marina' });
    fixture.componentRef.setInput('secciones', SECCIONES);
    fixture.detectChanges();
  });

  it('cada foto se puede abrir con el teclado, no solo con el ratón', () => {
    // Si fueran `div` con un click, quien navega con teclado no ampliaría ninguna.
    expect(fotos().length).toBe(3);
    for (const boton of fotos()) {
      expect(boton.tagName).toBe('BUTTON');
      expect(boton.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('el diálogo empieza cerrado y se abre al pulsar una foto', async () => {
    expect(dialogo().open).toBeFalse();

    fotos()[0].click();
    await estabiliza();

    expect(dialogo().open).toBeTrue();
    expect(ampliadaSrc()).toBe('/m/uno');
  });

  it('se recorre el documento entero, no solo la sección de la que se salió', async () => {
    // La tercera foto está en OTRA sección: quien lee de arriba abajo espera
    // que «siguiente» siga, y no que se acabe al final del primer bloque.
    fotos()[1].click();
    await estabiliza();
    expect(ampliadaSrc()).toBe('/m/dos');

    botonDe('Foto siguiente').click();
    await estabiliza();
    expect(ampliadaSrc()).toBe('/m/tres');

    botonDe('Foto anterior').click();
    await estabiliza();
    expect(ampliadaSrc()).toBe('/m/dos');
  });

  it('no da la vuelta: en los bordes el botón se apaga', async () => {
    fotos()[0].click();
    await estabiliza();
    expect(botonDe('Foto anterior').disabled).toBeTrue();
    expect(botonDe('Foto siguiente').disabled).toBeFalse();

    fotos()[2].click();
    await estabiliza();
    expect(botonDe('Foto siguiente').disabled).toBeTrue();
  });

  it('al cerrarlo no queda ninguna foto ampliada', async () => {
    fotos()[0].click();
    await estabiliza();

    // `close` es el evento que emite el `<dialog>` nativo también con Escape, y
    // lo emite en una TAREA aparte, no en un microtask: hay que esperarlo de
    // verdad. Es la misma vía por la que se cierra con Escape, así que probar
    // el botón en su lugar dejaría sin cubrir la forma más habitual de cerrar.
    const cerrado = new Promise<void>((listo) =>
      dialogo().addEventListener('close', () => listo(), { once: true }),
    );
    dialogo().close();
    await cerrado;
    await estabiliza();

    expect(dialogo().open).toBeFalse();
    expect(ampliadaSrc()).toBeNull();
  });

  it('la foto ampliada no se recorta', async () => {
    // Aquí es donde vive ahora esa promesa. En la cuadrícula del documento SÍ
    // se recorta, a propósito, para que las filas cierren iguales; quien no
    // quiera recorte tiene el carrusel. Pero al ampliar se ve entera siempre,
    // venga del modo que venga.
    fotos()[1].click(); // la vertical
    await estabiliza();

    const img = fixture.nativeElement.querySelector('dialog img') as HTMLImageElement;
    expect(img.className).toContain('object-contain');
    expect(img.className).not.toContain('object-cover');
  });
});

describe('PassDocument · cómo se presentan las fotos', () => {
  let fixture: ComponentFixture<PassDocument>;

  function monta(secciones: DocSection[]): void {
    fixture = TestBed.createComponent(PassDocument);
    fixture.componentRef.setInput('profile', { displayName: 'Marina' });
    fixture.componentRef.setInput('secciones', secciones);
    fixture.detectChanges();
  }

  const cuadricula = () => fixture.nativeElement.querySelector('.grid.grid-cols-2');
  const carrusel = () => fixture.nativeElement.querySelector('[role="group"].snap-x');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PassDocument] }).compileComponents();
  });

  it('sin decir nada, cuadrícula', () => {
    // Todo el contenido anterior a esta función no trae el campo. Que el valor
    // por defecto sea la cuadrícula es lo que hace que siga viéndose ordenado.
    monta([{ type: 'galeria', title: 'X', items: SECCIONES[0].items }]);
    expect(cuadricula()).not.toBeNull();
    expect(carrusel()).toBeNull();
  });

  it('en cuadrícula, todas las celdas tienen la misma proporción', () => {
    monta([{ type: 'galeria', title: 'X', display: 'cuadricula', items: SECCIONES[0].items }]);
    const cajas = Array.from(
      fixture.nativeElement.querySelectorAll('figure button'),
    ) as HTMLElement[];
    // Es lo que arregla el fallo original: antes cada caja llevaba la
    // proporción REAL de su foto, así que una vertical al lado de una apaisada
    // dejaba la fila desigual.
    expect(cajas.length).toBe(2);
    expect(cajas[0].className).toContain('aspect-4/3');
    expect(cajas[1].className).toContain('aspect-4/3');
  });

  it('en carrusel, cada foto conserva su proporción', () => {
    monta([{ type: 'galeria', title: 'X', display: 'carrusel', items: SECCIONES[0].items }]);
    expect(carrusel()).not.toBeNull();
    expect(cuadricula()).toBeNull();

    // 1600/1067 apaisada y 1000/1500 vertical: si el carrusel recortara, las
    // dos medirían lo mismo. No recortar es su razón de existir.
    const cajas = Array.from(
      fixture.nativeElement.querySelectorAll('figure button'),
    ) as HTMLElement[];
    const ancho = (el: HTMLElement) => parseFloat(el.style.width);
    expect(ancho(cajas[0])).toBeGreaterThan(ancho(cajas[1]));
  });

  it('en los dos modos se puede ampliar con el teclado', () => {
    for (const display of ['cuadricula', 'carrusel'] as const) {
      monta([{ type: 'galeria', title: 'X', display, items: SECCIONES[0].items }]);
      const botones = Array.from(
        fixture.nativeElement.querySelectorAll('figure button'),
      ) as HTMLButtonElement[];
      expect(botones.length).withContext(display).toBe(2);
      for (const b of botones) {
        expect(b.tagName).withContext(display).toBe('BUTTON');
        expect(b.getAttribute('aria-label')).withContext(display).toBeTruthy();
      }
    }
  });

  it('cada bloque elige por su cuenta', () => {
    monta([
      { type: 'galeria', title: 'Uno', display: 'cuadricula', items: SECCIONES[0].items },
      { type: 'galeria', title: 'Dos', display: 'carrusel', items: SECCIONES[1].items },
    ]);
    expect(cuadricula()).not.toBeNull();
    expect(carrusel()).not.toBeNull();
  });
});
