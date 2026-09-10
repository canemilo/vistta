import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { PassDocument, type Estilo } from './pass-document';

/**
 * Los tres estilos del documento, MEDIDOS.
 *
 * PASÓ, y por eso existe este archivo. La primera versión del estilo eran dos
 * factores que multiplicaban un margen y un tamaño de letra: 80, 116 y 52
 * píxeles de separación, y 16, 17,9 y 15 de cuerpo. El mecanismo funcionaba
 * —la clase se ponía, las variables resolvían— y aun así los tres enlaces se
 * veían iguales, porque en pantalla esa diferencia no existe. Lo dijo quien lo
 * probó, no una prueba.
 *
 * De ahí la forma de este archivo: no comprueba que la clase esté puesta, que
 * es lo que ya pasaba estando roto. Lee los ESTILOS CALCULADOS del navegador de
 * verdad y exige que las medidas se separen lo suficiente como para verse. Si
 * alguien vuelve a dejar los tres estilos en un ajuste fino, esto se pone rojo.
 *
 * Lo que NO se puede comprobar aquí: que las tres presentaciones sean bonitas o
 * apropiadas. Eso se mira con los ojos y con un dosier real delante.
 */
describe('El estilo del documento se ve', () => {
  const SECCIONES = [
    { type: 'texto' as const, title: 'Uno', body: 'Un párrafo.\n\nY otro.', items: [] },
    {
      type: 'galeria' as const,
      title: 'Dos',
      items: [
        { url: 'a.jpg', width: 1200, height: 800 },
        { url: 'b.jpg', width: 1200, height: 800 },
      ],
    },
  ];

  let montados: HTMLElement[] = [];

  async function monta(estilo: Estilo): Promise<ComponentFixture<PassDocument>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [PassDocument] }).compileComponents();
    const f = TestBed.createComponent(PassDocument);
    f.componentRef.setInput('profile', { displayName: 'Estudio', intro: 'Una entradilla.' });
    f.componentRef.setInput('secciones', SECCIONES);
    f.componentRef.setInput('estilo', estilo);
    // Al DOM de verdad: `getComputedStyle` de un elemento que no está en la
    // página no resuelve las variables heredadas, y la prueba pasaría en vacío.
    document.body.appendChild(f.nativeElement);
    montados.push(f.nativeElement);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return f;
  }

  /** Las medidas que de verdad hacen que un documento se lea distinto. */
  async function medidas(estilo: Estilo) {
    const f = await monta(estilo);
    const host = f.nativeElement as HTMLElement;
    const dentro = (sel: string) => host.querySelector(sel) as HTMLElement;
    const px = (v: string) => parseFloat(v);
    return {
      aire: px(getComputedStyle(dentro('.doc-apartado')).marginTop),
      cuerpo: px(getComputedStyle(dentro('.doc-lectura')).fontSize),
      entradilla: px(getComputedStyle(dentro('.doc-entradilla')).fontSize),
      hueco: px(getComputedStyle(dentro('.doc-rejilla')).columnGap),
      columnas: getComputedStyle(dentro('.doc-rejilla')).gridTemplateColumns.split(' ').length,
      titulo: px(getComputedStyle(dentro('.doc-titulo-apartado')).fontSize),
      tituloCaja: getComputedStyle(dentro('.doc-titulo-apartado')).textTransform,
    };
  }

  afterEach(() => {
    for (const el of montados) el.remove();
    montados = [];
  });

  it('sobrio es el de siempre y es el que sale sin pedir nada', async () => {
    const puesto = await medidas('sobrio');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [PassDocument] }).compileComponents();
    const f = TestBed.createComponent(PassDocument);
    f.componentRef.setInput('profile', { displayName: 'Estudio', intro: 'Una entradilla.' });
    f.componentRef.setInput('secciones', SECCIONES);
    document.body.appendChild(f.nativeElement);
    montados.push(f.nativeElement);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const host = f.nativeElement as HTMLElement;
    expect(parseFloat(getComputedStyle(host.querySelector('.doc-lectura')!).fontSize)).toBe(
      puesto.cuerpo,
    );
  });

  /*
   * LA PRUEBA QUE FALTABA. Cada medida tiene que separarse lo bastante como
   * para que se note al mirar, no al medir. Los mínimos no son redondos por
   * gusto: son lo que había antes y no se veía, con margen.
   */
  it('las tres se separan lo suficiente como para verse', async () => {
    const sobrio = await medidas('sobrio');
    const editorial = await medidas('editorial');
    const compacto = await medidas('compacto');

    // El aire entre apartados: editorial al menos 1,5 veces el de sobrio, y
    // compacto la mitad o menos. Con 1,45 y 0,65 no se distinguía.
    expect(editorial.aire).toBeGreaterThanOrEqual(sobrio.aire * 1.5);
    expect(compacto.aire).toBeLessThanOrEqual(sobrio.aire * 0.55);

    // El cuerpo del texto, al menos dos píxeles arriba y dos abajo.
    expect(editorial.cuerpo).toBeGreaterThanOrEqual(sobrio.cuerpo + 2);
    expect(compacto.cuerpo).toBeLessThanOrEqual(sobrio.cuerpo - 1.5);

    // La entradilla es lo primero que se ve, y en editorial manda.
    expect(editorial.entradilla).toBeGreaterThan(sobrio.entradilla);
    expect(compacto.entradilla).toBeLessThan(sobrio.entradilla);
  });

  /*
   * Y lo que de verdad cambia la página: cuántas piezas caben a la vez. Un
   * catálogo con tres fotos por fila y un dosier con tres fotos por fila son el
   * mismo documento por mucho que la letra mida distinto.
   */
  it('cambia cuántas fotos caben en una fila', async () => {
    const sobrio = await medidas('sobrio');
    const editorial = await medidas('editorial');
    const compacto = await medidas('compacto');

    expect(editorial.columnas).toBeLessThan(sobrio.columnas);
    expect(compacto.columnas).toBeGreaterThan(sobrio.columnas);
    // Y el aire ENTRE fotos acompaña: apretadas en compacto, sueltas en editorial.
    expect(editorial.hueco).toBeGreaterThan(sobrio.hueco);
    expect(compacto.hueco).toBeLessThan(sobrio.hueco);
  });

  /*
   * El cambio de forma, que es el que hace que «editorial» merezca el nombre:
   * el título del apartado deja de ser una etiqueta técnica en mayúsculas y
   * pasa a ser un titular.
   */
  it('en editorial el título del apartado es un titular, no una etiqueta', async () => {
    const sobrio = await medidas('sobrio');
    const editorial = await medidas('editorial');

    expect(sobrio.tituloCaja).toBe('uppercase');
    expect(editorial.tituloCaja).toBe('none');
    expect(editorial.titulo).toBeGreaterThanOrEqual(sobrio.titulo * 2);
  });

  /*
   * Y NINGUNO toca el color. Es lo que separa este ajuste del tema del pase:
   * claro y oscuro los elige quien manda el enlace, y un estilo del perfil que
   * los pisara le quitaría esa decisión sin decírselo.
   */
  it('ningún estilo cambia el color del documento', async () => {
    const fondos: string[] = [];
    const tintas: string[] = [];
    for (const e of ['sobrio', 'editorial', 'compacto'] as Estilo[]) {
      const f = await monta(e);
      const cs = getComputedStyle(f.nativeElement as HTMLElement);
      fondos.push(cs.backgroundColor);
      tintas.push(cs.color);
    }
    expect(new Set(fondos).size).toBe(1);
    expect(new Set(tintas).size).toBe(1);
  });
});
