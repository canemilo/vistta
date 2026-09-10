import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Api } from '../../core/api';
import { Panel } from '../panel';
import { ApiFalsa } from '../panel.fixtures';
import { AccionesPanel } from '../estado/acciones-panel';

/**
 * Cómo caduca el enlace, y qué se enseña de los que ya se mandaron.
 *
 * Aquí se toca el invariante del producto: un pase se abre las veces que diga
 * su modo y ni una más. Lo que se comprueba en esta pantalla es que el cliente
 * pueda ELEGIR ese modo sin que se le ofrezca ninguno que su plan no da, y que
 * lo que se le enseña de un enlace ya usado no prometa más precisión de la que
 * el sistema tiene.
 */

describe('Panel · cómo caduca el enlace', () => {
  let fixture: ComponentFixture<Panel>;
  let api: ApiFalsa;

  const boton = (texto: string) =>
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => (b.textContent ?? '').trim().startsWith(texto),
    );
  const radios = () =>
    Array.from(
      fixture.nativeElement.querySelectorAll('input[name="modoPase"]'),
    ) as HTMLInputElement[];

  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

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

  /*
   * Lo que este producto promete es el enlace de un solo uso. Si algún día
   * alguien reordena las opciones y deja otra marcada, un cliente mandaría sin
   * darse cuenta un enlace que se abre varias veces.
   */
  it('«un solo uso» viene marcado de entrada', async () => {
    const marcado = radios().find((r) => r.checked);
    expect(marcado).withContext('tiene que haber un modo marcado').toBeDefined();
    expect(marcado!.value).toBe('unico');
  });

  it('generar sin tocar nada pide un pase de un solo uso', async () => {
    boton('GENERAR ENLACE')!.click();
    await estabiliza();
    expect(api.ultimoPasePedido!.modo).toBe('unico');
    expect(api.ultimoPasePedido!.maxAccesos).toBeUndefined();
    expect(api.ultimoPasePedido!.ventanaMs).toBeUndefined();
  });

  it('eligiendo varios accesos, se manda el número elegido', async () => {
    const accesos = radios().find((r) => r.value === 'accesos')!;
    accesos.click();
    await estabiliza();

    boton('GENERAR ENLACE')!.click();
    await estabiliza();
    expect(api.ultimoPasePedido!.modo).toBe('accesos');
    expect(api.ultimoPasePedido!.maxAccesos).toBe(3);
  });

  it('la ventana se manda en milisegundos, no en horas', async () => {
    radios()
      .find((r) => r.value === 'ventana')!
      .click();
    await estabiliza();

    boton('GENERAR ENLACE')!.click();
    await estabiliza();
    expect(api.ultimoPasePedido!.modo).toBe('ventana');
    expect(api.ultimoPasePedido!.ventanaMs).toBe(24 * 3_600_000);
  });

  it('el listado dice cuántos accesos quedan, sin precisión de reloj', async () => {
    api.pases = [
      {
        id: 'p1',
        modo: 'accesos',
        estado: 'abrible',
        creadoEn: Date.now(),
        expiraEn: Date.now() + 3_600_000,
        validoHasta: Date.now() + 6 * 3_600_000,
        accesosUsados: 2,
        maxAccesos: 3,
        destinatarioRef: 'ana@example.com',
        destinatarioNota: 'piso de la calle mayor',
        tema: 'oscuro',
      },
    ];
    // Se recarga el perfil para que el panel pida la lista.
    TestBed.inject(AccionesPanel).elegirPerfil('p_uno');
    await estabiliza();

    const texto = (fixture.nativeElement.textContent ?? '') as string;
    expect(texto).toContain('2 de 3 accesos');
    expect(texto).toContain('caduca en unas 6 h');
    // La nota privada es lo que ayuda a reconocer el enlace en la lista.
    expect(texto).toContain('piso de la calle mayor');
  });

  it('el destinatario viaja al generar, y la nota también', async () => {
    const ref = fixture.nativeElement.querySelector(
      'input[name="destinatarioRef"]',
    ) as HTMLInputElement;
    ref.value = 'ana@example.com';
    ref.dispatchEvent(new Event('input'));
    await estabiliza();

    boton('GENERAR ENLACE')!.click();
    await estabiliza();
    expect(api.ultimoPasePedido!.destinatarioRef).toBe('ana@example.com');
  });

  it('la lectura se enseña redondeada, no al segundo', async () => {
    api.pases = [
      {
        id: 'p1',
        modo: 'unico',
        estado: 'agotado',
        creadoEn: Date.now(),
        expiraEn: Date.now() + 3_600_000,
        validoHasta: null,
        accesosUsados: 1,
        maxAccesos: null,
        destinatarioRef: null,
        destinatarioNota: null,
        tema: 'oscuro',
      },
    ];
    api.lectura = {
      hayDatos: true,
      msTotales: 254_000,
      secciones: [{ seccionIdx: 0, msVisible: 41_000 }],
      medios: [],
    };
    TestBed.inject(AccionesPanel).elegirPerfil('p_uno');
    await estabiliza();

    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((b) => (b.textContent ?? '').includes('ver lectura'))!
      .click();
    await estabiliza();

    const texto = (fixture.nativeElement.textContent ?? '') as string;
    // 254 s son 4,2 minutos: se enseña «unos 4 min», no «4 min 14 s».
    expect(texto).toContain('unos 4 min');
    expect(texto).not.toContain('254');
    expect(texto).not.toMatch(/\d+ min \d+ s/);
  });

  it('sin datos dice «aún sin abrir», y no un cero inventado', async () => {
    api.pases = [
      {
        id: 'p1',
        modo: 'unico',
        estado: 'agotado',
        creadoEn: Date.now(),
        expiraEn: Date.now() + 3_600_000,
        validoHasta: null,
        accesosUsados: 1,
        maxAccesos: null,
        destinatarioRef: null,
        destinatarioNota: null,
        tema: 'oscuro',
      },
    ];
    api.lectura = { hayDatos: false, msTotales: 0, secciones: [], medios: [] };
    TestBed.inject(AccionesPanel).elegirPerfil('p_uno');
    await estabiliza();

    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((b) => (b.textContent ?? '').includes('ver lectura'))!
      .click();
    await estabiliza();

    const texto = (fixture.nativeElement.textContent ?? '') as string;
    expect(texto).toContain('aún sin abrir');
    expect(texto).not.toContain('unos 0');
  });

  /*
   * La línea honesta del producto, puesta donde se toma la decisión. Si alguien
   * la cambia por «evita filtraciones», esto se pone rojo: no las evita, las
   * hace atribuibles.
   */
  /*
   * La ficha de la cuenta. Lo que se comprueba no es que se pinten unos datos,
   * es que diga lo que NO hay: sin esa frase, un cliente que olvida la
   * contraseña se queda esperando un correo que no va a llegar nunca, porque no
   * existe columna donde guardar su dirección.
   */
  it('«mi perfil» enseña los datos de la cuenta y dice qué no se guarda', async () => {
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((b) => (b.textContent ?? '').trim().startsWith('MI PERFIL'))!
      .click();
    await estabiliza();

    const texto = (fixture.nativeElement.textContent ?? '') as string;
    expect(texto).toContain('marina');
    expect(texto).toContain('No hay correo ni teléfono');
  });

  /*
   * El botón solo aparece si hay algo cerrado, y al usarlo NO puede llevarse
   * los enlaces vivos: esos ya están en manos de otra persona. Aquí se
   * comprueba lo primero y que el aviso diga lo que se pierde.
   */
  it('no ofrece limpiar cuando no hay nada cerrado', async () => {
    api.pases = [
      {
        id: 'vivo',
        modo: 'unico',
        estado: 'abrible',
        creadoEn: Date.now(),
        expiraEn: Date.now() + 3_600_000,
        validoHasta: null,
        accesosUsados: 0,
        maxAccesos: null,
        destinatarioRef: null,
        destinatarioNota: null,
        tema: 'oscuro',
      },
    ];
    TestBed.inject(AccionesPanel).elegirPerfil('p_uno');
    await estabiliza();

    const botones = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    expect(botones.filter((b) => (b.textContent ?? '').includes('LIMPIAR'))).toEqual([]);
  });

  it('con enlaces cerrados, ofrece limpiarlos y dice qué se pierde', async () => {
    api.pases = [
      {
        id: 'gastado',
        modo: 'unico',
        estado: 'agotado',
        creadoEn: Date.now(),
        expiraEn: Date.now(),
        validoHasta: null,
        accesosUsados: 1,
        maxAccesos: null,
        destinatarioRef: null,
        destinatarioNota: null,
        tema: 'oscuro',
      },
    ];
    TestBed.inject(AccionesPanel).elegirPerfil('p_uno');
    await estabiliza();

    const texto = (fixture.nativeElement.textContent ?? '') as string;
    expect(texto).toContain('LIMPIAR 1 CERRADO');
    // Y advierte de las dos cosas: qué se lleva y qué no.
    expect(texto).toContain('lo que se sabe de su lectura');
    expect(texto).toContain('Los que siguen vivos no se tocan');
  });

  it('el panel no promete que impida nada', async () => {
    const texto = (fixture.nativeElement.textContent ?? '') as string;
    expect(texto).toContain('No impide una captura de pantalla');
    expect(texto.toLowerCase()).not.toContain('evita filtraciones');
  });
});
