import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Api } from '../../core/api';
import { Panel } from '../panel';
import { ApiFalsa, PERFIL } from '../panel.fixtures';
import { AccionesPanel } from '../estado/acciones-panel';
import { EJEMPLOS, PLANTILLAS, plantillaPorId } from '../plantillas';

/**
 * Crear perfiles, elegir de qué se parte, y salir de la cuenta.
 *
 * Crear un perfil y cerrar sesión existían en el servidor y en `Api` desde hacía
 * bloques, y ninguna estaba conectada a la plantilla: toda cuenta se quedaba con
 * el único perfil que se crea al darla de alta —dijera lo que dijera su plan— y
 * no había forma de salir. Por eso se prueba por el DOM: lo que falló no fue la
 * lógica, fue que nadie la llamaba. Al partir el panel en componentes eso no
 * cambia; lo que cambia es que ahora el DOM lo montan varios.
 */

describe('Panel · perfiles y cierre de sesión', () => {
  let fixture: ComponentFixture<Panel>;
  let api: ApiFalsa;

  const boton = (texto: string) =>
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => (b.textContent ?? '').trim().startsWith(texto),
    );
  const campoNuevo = () =>
    fixture.nativeElement.querySelector(
      'input[name="nombrePerfilNuevo"]',
    ) as HTMLInputElement | null;

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

  it('hay un botón para salir, y cierra la sesión en el servidor', async () => {
    const salir = boton('SALIR');
    expect(salir).withContext('el panel tiene que ofrecer cerrar sesión').toBeDefined();

    salir!.click();
    await estabiliza();

    // No basta con olvidarla en el navegador: la sesión vive en la base y hay
    // que decirle al servidor que la tire.
    expect(api.sesionesCerradas).toEqual(['sesion-de-prueba']);
    expect(sessionStorage.getItem('vistta.sesion')).toBeNull();
    // Y se vuelve a la pantalla de entrada.
    expect(boton('ENTRAR') ?? boton('SALIR')).not.toBe(salir);
  });

  it('con el plan a medias se puede crear otro perfil', async () => {
    // Plan Pro: 3 perfiles, hay 1. Antes esto no existía y la cuenta se
    // quedaba en el perfil que se crea al darla de alta.
    expect(boton('+ PERFIL')!.disabled).toBeFalse();

    boton('+ PERFIL')!.click();
    await estabiliza();

    const campo = campoNuevo()!;
    campo.value = 'Segundo';
    campo.dispatchEvent(new Event('input'));
    await estabiliza();

    boton('CREAR')!.click();
    await estabiliza();

    expect(api.creados).toEqual(['Segundo']);
  });

  it('al crearlo se cambia a él: es lo que se va a montar ahora', async () => {
    boton('+ PERFIL')!.click();
    await estabiliza();
    const campo = campoNuevo()!;
    campo.value = 'Segundo';
    campo.dispatchEvent(new Event('input'));
    await estabiliza();
    boton('CREAR')!.click();
    await estabiliza();

    const selector = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(selector.value).toBe('p_2');
  });

  it('en el tope del plan el botón se apaga y se dice por qué', async () => {
    api.perfiles = [PERFIL('p_uno', 'Uno'), PERFIL('p_dos', 'Dos'), PERFIL('p_tres', 'Tres')];
    fixture = TestBed.createComponent(Panel);
    await estabiliza();

    expect(boton('+ PERFIL')!.disabled).toBeTrue();
    // Un botón apagado sin explicación es una pantalla rota, no un límite.
    expect(fixture.nativeElement.textContent).toContain('3 de 3');
  });

  it('un plan de un solo perfil no deja crear el segundo', async () => {
    api.tope = 1;
    fixture = TestBed.createComponent(Panel);
    await estabiliza();
    expect(boton('+ PERFIL')!.disabled).toBeTrue();
  });

  /*
   * LAS PLANTILLAS. El problema que resuelven no es de funciones que falten,
   * es de primera pantalla: quien creaba un perfil se encontraba un lienzo
   * vacío y tenía que decidir a la vez qué apartados hacer, en qué orden, qué
   * escribir y cómo enseñar las fotos. Aquí se comprueba que lo que se elige
   * llega de verdad al perfil, que es lo único que el cliente nota.
   */
  it('al crear se ofrecen todas las plantillas, y «desde cero» la última', async () => {
    boton('+ PERFIL')!.click();
    await estabiliza();

    const radios = Array.from(
      fixture.nativeElement.querySelectorAll('input[name="plantilla"]'),
    ) as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(PLANTILLAS.map((p) => p.id));
    expect(radios[radios.length - 1].value).toBe('vacio');
    // Y arranca con una elegida: un botón CREAR que no hace nada hasta pulsar
    // otra cosa es un callejón sin salida disfrazado de elección.
    expect(radios[0].checked).toBeTrue();
  });

  it('el perfil nace con el contenido de la plantilla elegida', async () => {
    boton('+ PERFIL')!.click();
    await estabiliza();
    const campo = campoNuevo()!;
    campo.value = 'Portfolio de Marina';
    campo.dispatchEvent(new Event('input'));

    const radio = fixture.nativeElement.querySelector(
      'input[name="plantilla"][value="portfolio"]',
    ) as HTMLInputElement;
    radio.click();
    await estabiliza();

    boton('CREAR')!.click();
    await estabiliza();

    const guardado = api.guardados['p_2'];
    expect(guardado).withContext('la plantilla tiene que guardarse al crear').toBeDefined();
    expect(guardado.sections.map((x) => x.type)).toEqual(
      plantillaPorId('portfolio').contenido.sections.map((x) => x.type),
    );
    expect(guardado.intro).toBe(EJEMPLOS.intro);
  });

  it('«desde cero» no guarda nada: el perfil sigue naciendo vacío', async () => {
    boton('+ PERFIL')!.click();
    await estabiliza();
    const campo = campoNuevo()!;
    campo.value = 'A mi manera';
    campo.dispatchEvent(new Event('input'));
    (
      fixture.nativeElement.querySelector(
        'input[name="plantilla"][value="vacio"]',
      ) as HTMLInputElement
    ).click();
    await estabiliza();

    boton('CREAR')!.click();
    await estabiliza();

    expect(api.creados).toEqual(['A mi manera']);
    // Ni un PUT: sin contenido que poner, guardar sería pisar el perfil recién
    // creado con lo mismo que ya tiene.
    expect(api.guardados['p_2']).toBeUndefined();
  });

  /*
   * Y si el segundo paso falla, el perfil EXISTE y está vacío. Decir «no se
   * pudo crear el perfil» mandaría a intentarlo otra vez y a gastar la segunda
   * plaza del plan por un error que ya ocurrió.
   */
  it('si la plantilla no se guarda, se dice que el perfil sí se creó', async () => {
    api.fallaAlGuardar = true;
    boton('+ PERFIL')!.click();
    await estabiliza();
    const campo = campoNuevo()!;
    campo.value = 'Segundo';
    campo.dispatchEvent(new Event('input'));
    await estabiliza();
    boton('CREAR')!.click();
    await estabiliza();

    expect(api.creados).toEqual(['Segundo']);
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Se creó «Segundo»');
    expect(texto).toContain('El perfil está vacío');
  });

  /*
   * El aviso de relleno: avisa, NO bloquea. Lo que se manda con un «Describe
   * aquí…» dentro son instrucciones para uno mismo con el membrete de tu marca
   * encima, y quien lo abre es un cliente.
   */
  it('avisa si queda texto de ejemplo, y no apaga el botón', async () => {
    boton('+ PERFIL')!.click();
    await estabiliza();
    const campo = campoNuevo()!;
    campo.value = 'Piso Mayor';
    campo.dispatchEvent(new Event('input'));
    await estabiliza();
    boton('CREAR')!.click();
    await estabiliza();

    expect(fixture.nativeElement.textContent).toContain('Queda texto de ejemplo');
    expect(boton('GENERAR ENLACE')!.disabled).toBeFalse();
  });

  it('el aviso se va solo en cuanto se escribe encima', async () => {
    boton('+ PERFIL')!.click();
    await estabiliza();
    const campo = campoNuevo()!;
    campo.value = 'Catálogo';
    campo.dispatchEvent(new Event('input'));
    (
      fixture.nativeElement.querySelector(
        'input[name="plantilla"][value="catalogo"]',
      ) as HTMLInputElement
    ).click();
    await estabiliza();
    boton('CREAR')!.click();
    await estabiliza();
    expect(fixture.nativeElement.textContent).toContain('Queda texto de ejemplo');

    // Se escribe encima de TODO lo que era ejemplo: la entradilla y el cuerpo.
    const guardado = api.guardados['p_2'];
    api.guardados['p_2'] = {
      ...guardado,
      intro: 'Colección de 2026.',
      sections: guardado.sections.map((x) =>
        'body' in x ? { ...x, body: 'Escrito por el cliente.' } : x,
      ),
    };
    TestBed.inject(AccionesPanel).elegirPerfil('p_2');
    await estabiliza();

    expect(fixture.nativeElement.textContent).not.toContain('Queda texto de ejemplo');
  });

  /*
   * LA REFERENCIA, DONDE SE TRABAJA.
   *
   * Nació de una pregunta de quien lo usaba: «¿cómo se ven las fichas
   * guardadas?». La referencia se escribía en la ficha del inmueble y no volvía
   * a aparecer en ninguna pantalla del panel, así que con cuatro dosieres
   * llamados «Piso centro» había que abrirlos uno a uno para saber cuál era
   * cuál. Es el nombre con el que el agente los llama de verdad.
   */
  it('el selector enseña la referencia del inmueble junto al nombre', async () => {
    api.perfiles = [PERFIL('p_uno', 'Piso centro', 'REF-42')];
    fixture = TestBed.createComponent(Panel);
    await estabiliza();

    const opcion = fixture.nativeElement.querySelector('option') as HTMLOptionElement;
    expect(opcion.textContent).toContain('Piso centro');
    expect(opcion.textContent).toContain('REF-42');
  });

  it('sin referencia no se inventa un separador colgando', async () => {
    api.perfiles = [PERFIL('p_uno', 'Piso centro')];
    fixture = TestBed.createComponent(Panel);
    await estabiliza();

    const opcion = fixture.nativeElement.querySelector('option') as HTMLOptionElement;
    expect(opcion.textContent!.trim()).toBe('Piso centro');
  });

  it('si el servidor dice 409, se traduce en vez de enseñarlo crudo', async () => {
    // Puede pasar con el botón activo: el recuento de la pantalla envejece si
    // hay otra pestaña o cambia el plan. Manda el servidor.
    api.fallaAlCrear = { status: 409 };
    boton('+ PERFIL')!.click();
    await estabiliza();
    const campo = campoNuevo()!;
    campo.value = 'Segundo';
    campo.dispatchEvent(new Event('input'));
    await estabiliza();
    boton('CREAR')!.click();
    await estabiliza();

    expect(fixture.nativeElement.textContent).toContain('Tu plan da para 3 perfiles');
  });
});
