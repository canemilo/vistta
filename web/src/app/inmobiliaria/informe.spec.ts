import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Api, type FichaDePropiedad, type Informe as InformeDto } from '../core/api';
import { CLAVE_SESION } from '../core/sesion';
import { Informe } from './informe';

/**
 * La ficha del inmueble, dentro del informe.
 *
 * Es la única pantalla del producto donde el cliente escribe algo que NO se
 * enseña a nadie: la referencia interna, desde cuándo tiene la exclusiva y una
 * nota privada. Y por eso mismo es la que más fácil deja la sensación de que no
 * ha pasado nada: no cambia el documento que se entrega, así que la única señal
 * de que se ha guardado es la que ponga la pantalla.
 */

const CIFRAS = { enviados: 3, abiertos: 2, pctApertura: 66, msMedio: 60_000 };

const INFORME: InformeDto = {
  profileId: 'p_uno',
  displayName: 'Piso Mayor',
  brandColor: null,
  logo: null,
  propiedad: null,
  periodo: { desde: 0, hasta: 1 },
  generadoEn: 1,
  mideLectura: true,
  datosSuficientes: true,
  cifras: CIFRAS,
  relecturas: 0,
  llegaronAlFinal: 1,
  pctFinal: 50,
  apartados: [],
  saltados: [],
  anterior: null,
};

class ApiFalsa {
  ficha: FichaDePropiedad | null = null;
  guardadas: unknown[] = [];
  fallaAlGuardar = false;

  vecesQuePidioElInforme = 0;
  informe = () => {
    this.vecesQuePidioElInforme++;
    return Promise.resolve(INFORME);
  };
  fichaDePropiedad = () => Promise.resolve({ ficha: this.ficha });
  guardarFicha = (_s: string, _p: string, ficha: Record<string, unknown>) => {
    if (this.fallaAlGuardar) return Promise.reject(new Error('no'));
    this.guardadas.push(ficha);
    this.ficha = {
      referencia: (ficha['referencia'] as string | null) ?? null,
      propietarioNota: (ficha['propietarioNota'] as string | null) ?? null,
      exclusivaDesde: (ficha['exclusivaDesde'] as number | null) ?? null,
      actualizadoEn: 123,
    };
    return Promise.resolve({ ficha: this.ficha });
  };
}

describe('Informe · la ficha del inmueble', () => {
  let fixture: ComponentFixture<Informe>;
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
  const campo = (marcador: string) =>
    fixture.nativeElement.querySelector(`input[placeholder="${marcador}"]`) as HTMLInputElement;

  beforeEach(async () => {
    api = new ApiFalsa();
    sessionStorage.setItem(CLAVE_SESION, 'sesion-de-prueba');
    await TestBed.configureTestingModule({
      imports: [Informe],
      providers: [
        { provide: Api, useValue: api },
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'p_uno' } } },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Informe);
    await estabiliza();
  });

  afterEach(() => sessionStorage.clear());

  it('lo que se escribe llega al servidor', async () => {
    const ref = campo('REF-118');
    ref.value = 'REF-42';
    ref.dispatchEvent(new Event('input'));
    await estabiliza();

    boton('Guardar ficha')!.click();
    await estabiliza();

    expect(api.guardadas.length).toBe(1);
    expect(api.guardadas[0]).toEqual({
      referencia: 'REF-42',
      propietarioNota: null,
      exclusivaDesde: null,
    });
  });

  /*
   * LO QUE SE NOTA. Guardar aquí no cambia el documento que se entrega, así que
   * sin una confirmación al lado del botón el cliente no tiene forma de saber
   * si ha pasado algo: el mismo formulario, con lo mismo escrito.
   */
  it('lo dice al lado del botón, no en otra parte de la página', async () => {
    boton('Guardar ficha')!.click();
    await estabiliza();

    const aviso = fixture.nativeElement.querySelector('[role="status"]') as HTMLElement | null;
    expect(aviso).withContext('no hay confirmación en ninguna parte').not.toBeNull();
    expect(aviso!.textContent).toContain('guardada');

    // Y al lado del botón: el mismo contenedor, no a tres pantallas de scroll.
    expect(boton('Guardar ficha')!.parentElement!.contains(aviso!)).toBeTrue();
  });

  /*
   * Y SI FALLA, TAMBIÉN AL LADO. El fallo se pintaba arriba del todo, encima
   * del documento: quien pulsa «Guardar ficha» está al final de un informe
   * largo y no ve nada. Desde ahí, un guardado que falla y uno que funciona son
   * exactamente lo mismo.
   */
  it('si falla, el fallo se lee donde se pulsó', async () => {
    api.fallaAlGuardar = true;
    boton('Guardar ficha')!.click();
    await estabiliza();

    const aviso = boton('Guardar ficha')!.parentElement!.querySelector(
      '[role="alert"]',
    ) as HTMLElement | null;
    expect(aviso).withContext('el fallo no se ve junto al botón').not.toBeNull();
    expect(aviso!.textContent).toContain('No se ha podido guardar');
  });

  /*
   * EL FALLO QUE SE VEÍA COMO «no hace nada».
   *
   * Guardar recargaba el informe entero, y la plantilla sustituye el bloque
   * completo —documento y ficha— por un «Preparando el informe…» mientras
   * carga. Al pulsar Guardar desaparecía el formulario recién rellenado, la
   * página saltaba arriba y volvía a montarse un segundo después. Eso no se lee
   * como «guardado», se lee como «se ha ido algo».
   *
   * De la ficha solo salen en el papel la referencia y la fecha de exclusiva, y
   * las dos vienen en la respuesta del guardado: no hay nada que volver a
   * pedir.
   */
  it('guardar no vuelve a pedir el informe: la pantalla no parpadea', async () => {
    expect(api.vecesQuePidioElInforme).toBe(1);

    boton('Guardar ficha')!.click();
    await estabiliza();

    expect(api.vecesQuePidioElInforme).toBe(1);
    // Y el formulario sigue ahí, no sustituido por «Preparando el informe…».
    expect(campo('REF-118')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Preparando el informe');
  });

  /*
   * Pero la cabecera del papel SÍ se entera: la referencia sale impresa, y
   * quedarse con la vieja hasta la próxima recarga sería mentir en el
   * documento que se entrega.
   */
  it('la referencia nueva aparece en la cabecera del informe', async () => {
    const ref = campo('REF-118');
    ref.value = 'REF-42';
    ref.dispatchEvent(new Event('input'));
    await estabiliza();
    boton('Guardar ficha')!.click();
    await estabiliza();

    expect(fixture.nativeElement.textContent).toContain('Referencia REF-42');
  });

  it('al volver a cargar, lo guardado sigue ahí', async () => {
    const ref = campo('REF-118');
    ref.value = 'REF-42';
    ref.dispatchEvent(new Event('input'));
    await estabiliza();
    boton('Guardar ficha')!.click();
    await estabiliza();

    // Se monta de nuevo, como quien vuelve a entrar al informe mañana.
    fixture = TestBed.createComponent(Informe);
    await estabiliza();
    expect(campo('REF-118').value).toBe('REF-42');
  });

  /*
   * Dónde vive. Es la pregunta que hizo quien lo usó —«no sé dónde está
   * guardada»— y la pantalla tiene que responderla sola: es del inmueble, no
   * del informe, y no viaja en ningún pase.
   */
  it('la pantalla dice dónde vive y quién la ve', () => {
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Ficha del inmueble');
    expect(texto).toContain('No sale en el dosier');
  });
});
