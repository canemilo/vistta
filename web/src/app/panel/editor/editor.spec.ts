import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Api } from '../../core/api';
import { Panel } from '../panel';
import { ApiFalsa } from '../panel.fixtures';
import { EstadoPerfil } from '../estado/estado-perfil';

/**
 * El editor: que se entienda QUÉ se está montando.
 *
 * El problema no era de funciones que faltaran: estaban todas. Era que el
 * editor pintaba los treinta bloques abiertos, uno detrás de otro, y montar un
 * dosier consistía en desplazarse por una columna de campos sin ver nunca la
 * estructura. La estructura es justo lo que hay que ver para poder ordenarla.
 *
 * Se prueba por el DOM, como el resto del panel: lo que se está comprobando es
 * que la pantalla enseñe lo que hay, no que un servicio guarde bien un número.
 */
describe('Editor · la lista de apartados', () => {
  let fixture: ComponentFixture<Panel>;
  let api: ApiFalsa;

  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const filas = () =>
    Array.from(fixture.nativeElement.querySelectorAll('.fila-apartado')) as HTMLButtonElement[];
  const boton = (texto: string) =>
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => (b.textContent ?? '').trim().startsWith(texto),
    );
  const porEtiqueta = (etiqueta: string) =>
    fixture.nativeElement.querySelector(`[aria-label="${etiqueta}"]`) as HTMLButtonElement | null;

  beforeEach(async () => {
    api = new ApiFalsa();
    api.guardados['p_uno'] = {
      intro: 'Una presentación.',
      sections: [
        { type: 'texto', title: 'Sobre mí', body: 'Dos palabras aquí' },
        { type: 'galeria', title: 'Fotos', items: [{ mediaId: 'm1' }, { mediaId: 'm2' }] },
        { type: 'proyecto', title: 'Casa', body: 'Uno', items: [{ mediaId: 'm3' }] },
      ],
    };
    sessionStorage.setItem('vistta.sesion', 'sesion-de-prueba');
    await TestBed.configureTestingModule({
      imports: [Panel],
      providers: [{ provide: Api, useValue: api }, provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Panel);
    await estabiliza();
  });

  afterEach(() => sessionStorage.clear());

  /*
   * LO QUE RESUELVE EL PROBLEMA. Con todos abiertos no se veía la estructura;
   * con uno solo, la lista de arriba ES la estructura.
   */
  it('los apartados nacen encogidos: se ve la estructura, no el formulario', () => {
    expect(filas().length).toBe(3);
    expect(filas().every((f) => f.getAttribute('aria-expanded') === 'false')).toBeTrue();
    // Y no hay ni un cuerpo de texto a la vista.
    expect(
      fixture.nativeElement.querySelectorAll('textarea[aria-label^="Texto del bloque"]').length,
    ).toBe(0);
  });

  it('cada fila dice de qué tipo es y cuánto lleva dentro', () => {
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Sobre mí');
    // «Galería · 2 fotos»: el recuento es lo que evita abrirlo para saberlo.
    expect(texto).toContain('2 fotos');
    // El proyecto lleva las dos cosas, y se dicen las dos.
    expect(texto).toContain('1 foto · 1 palabra');
  });

  it('se despliega uno, y solo uno', async () => {
    filas()[1].click();
    await estabiliza();
    expect(filas()[1].getAttribute('aria-expanded')).toBe('true');

    filas()[0].click();
    await estabiliza();
    expect(filas()[0].getAttribute('aria-expanded')).toBe('true');
    expect(filas()[1].getAttribute('aria-expanded')).toBe('false');
  });

  it('volver a pulsar el desplegado lo cierra', async () => {
    filas()[0].click();
    await estabiliza();
    filas()[0].click();
    await estabiliza();
    expect(filas().every((f) => f.getAttribute('aria-expanded') === 'false')).toBeTrue();
  });

  /*
   * Añadir y NO desplegar sería dejar al usuario mirando una fila encogida
   * recién creada: lo que se acaba de crear es justo lo que se va a escribir.
   */
  it('un apartado nuevo nace desplegado', async () => {
    boton('+ Texto')!.click();
    await estabiliza();
    const abiertas = filas().filter((f) => f.getAttribute('aria-expanded') === 'true');
    expect(abiertas.length).toBe(1);
    expect(filas().length).toBe(4);
    expect(filas()[3].getAttribute('aria-expanded')).toBe('true');
  });

  it('cada botón de añadir dice para qué sirve ese bloque', () => {
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Solo palabras');
    expect(texto).toContain('Solo fotos, sin texto');
    expect(texto).toContain('Fotos y descripción juntas');
  });

  /*
   * Se reordena de DOS formas y las dos hacen falta: el arrastre es lo natural
   * con ratón, y los botones son lo que funciona con teclado y en un móvil.
   * Aquí se prueban los botones, que son los que se pueden pulsar sin simular
   * un gesto; el arrastre llama al mismo `reordenarSeccion`.
   */
  it('los botones reordenan, y lo desplegado sigue al apartado', async () => {
    filas()[0].click();
    await estabiliza();
    porEtiqueta('Bajar el apartado 1')!.click();
    await estabiliza();

    const perfil = TestBed.inject(EstadoPerfil);
    expect(perfil.contenido().sections.map((s) => s.title)).toEqual(['Fotos', 'Sobre mí', 'Casa']);
    // El bloque que se estaba mirando es el que se ha movido: sigue abierto.
    expect(filas()[1].getAttribute('aria-expanded')).toBe('true');
    expect(filas()[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('arrastrar de la primera a la última deja el orden entero, no a saltos', async () => {
    const perfil = TestBed.inject(EstadoPerfil);
    perfil.reordenarSeccion(0, 2);
    await estabiliza();
    expect(perfil.contenido().sections.map((s) => s.title)).toEqual(['Fotos', 'Casa', 'Sobre mí']);
  });
});

describe('Editor · saber si está guardado', () => {
  let fixture: ComponentFixture<Panel>;
  let api: ApiFalsa;

  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const boton = (texto: string) =>
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => (b.textContent ?? '').trim().startsWith(texto),
    );

  beforeEach(async () => {
    api = new ApiFalsa();
    api.guardados['p_uno'] = { sections: [{ type: 'texto', title: 'T', body: 'B' }] };
    sessionStorage.setItem('vistta.sesion', 'sesion-de-prueba');
    await TestBed.configureTestingModule({
      imports: [Panel],
      providers: [{ provide: Api, useValue: api }, provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Panel);
    await estabiliza();
  });

  afterEach(() => sessionStorage.clear());

  /*
   * La duda de si se ha guardado es cara: se guarda otra vez «por si acaso», o
   * peor, se cierra la pestaña creyendo que sí. Se dice SIEMPRE, no solo cuando
   * hay cambios: un indicador que a veces no está no se mira nunca.
   */
  it('recién abierto dice Guardado', () => {
    expect(fixture.nativeElement.textContent).toContain('Guardado');
    expect(fixture.nativeElement.textContent).not.toContain('Sin guardar');
  });

  it('en cuanto se toca algo dice Sin guardar', async () => {
    TestBed.inject(EstadoPerfil).actualizar({ intro: 'algo nuevo' });
    await estabiliza();
    expect(fixture.nativeElement.textContent).toContain('Sin guardar');
  });

  it('y al guardar vuelve a decir Guardado', async () => {
    TestBed.inject(EstadoPerfil).actualizar({ intro: 'algo nuevo' });
    await estabiliza();
    boton('GUARDAR CAMBIOS')!.click();
    await estabiliza();
    expect(fixture.nativeElement.textContent).not.toContain('Sin guardar');
    expect(api.guardados['p_uno'].intro).toBe('algo nuevo');
  });
});

describe('Editor · el estilo del dosier', () => {
  let fixture: ComponentFixture<Panel>;
  let api: ApiFalsa;

  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /*
   * Se busca DENTRO del grupo del estilo, no en la pantalla entera: más abajo
   * hay otro grupo con «Claro» y «Oscuro» que es el tema del PASE, y confundir
   * los dos es justo lo que estas pruebas existen para impedir.
   */
  const estilo = (etiqueta: string) =>
    (
      Array.from(
        fixture.nativeElement.querySelectorAll('.estilo-dosier button'),
      ) as HTMLButtonElement[]
    ).find((b) => (b.textContent ?? '').trim().startsWith(etiqueta));

  beforeEach(async () => {
    api = new ApiFalsa();
    sessionStorage.setItem('vistta.sesion', 'sesion-de-prueba');
    await TestBed.configureTestingModule({
      imports: [Panel],
      providers: [{ provide: Api, useValue: api }, provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Panel);
    await estabiliza();
  });

  afterEach(() => sessionStorage.clear());

  it('se ofrecen tres, y ninguno es claro ni oscuro', () => {
    for (const e of ['Sobrio', 'Editorial', 'Compacto']) {
      expect(estilo(e)).withContext(e).toBeDefined();
    }
    /*
     * Claro y oscuro NO son estilos del perfil: eso lo elige quien MANDA el
     * enlace, pase por pase. Si alguien los añade aquí, la misma decisión pasa
     * a tener dos dueños.
     */
    expect(estilo('Claro')).toBeUndefined();
    expect(estilo('Oscuro')).toBeUndefined();
  });

  it('sin elegir nada, el marcado es sobrio', () => {
    expect(estilo('Sobrio')!.getAttribute('aria-pressed')).toBe('true');
    expect(estilo('Editorial')!.getAttribute('aria-pressed')).toBe('false');
    // Y no se escribe nada en el contenido: ausente sigue siendo válido.
    expect(TestBed.inject(EstadoPerfil).contenido().estilo).toBeUndefined();
  });

  it('elegir uno lo guarda en el contenido del perfil', async () => {
    estilo('Editorial')!.click();
    await estabiliza();
    expect(TestBed.inject(EstadoPerfil).contenido().estilo).toBe('editorial');
    expect(estilo('Editorial')!.getAttribute('aria-pressed')).toBe('true');
  });
});
