import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Landing } from './landing';
import { Api, type CatalogoPublico } from '../core/api';

const CATALOGO: CatalogoPublico = {
  moneda: 'EUR',
  periodos: ['mensual', 'anual'],
  planes: [
    {
      nombre: 'prueba',
      seVende: false,
      precios: { mensual: 0, anual: 0 },
      limites: {
        perfiles: 1,
        pasesSimultaneos: 5,
        cuotaPorPerfil: 70 * 1024 * 1024,
        retencionMs: 7 * 86_400_000,
        modosDePase: ['unico'],
        maxAccesos: null,
        ventanaMaxMs: null,
        plazoPrimeraAperturaMaxMs: 86_400_000,
        metricasDeLectura: false,
      },
    },
    {
      nombre: 'boveda',
      seVende: true,
      precios: { mensual: 2900, anual: 29000 },
      limites: {
        perfiles: 10,
        pasesSimultaneos: null,
        cuotaPorPerfil: 1024 * 1024 * 1024,
        retencionMs: null,
        modosDePase: ['unico', 'accesos', 'ventana'],
        maxAccesos: 10,
        ventanaMaxMs: 7 * 86_400_000,
        plazoPrimeraAperturaMaxMs: 7 * 86_400_000,
        metricasDeLectura: true,
      },
    },
  ],
};

class ApiFalsa {
  catalogo: CatalogoPublico | null = CATALOGO;
  contacto: string | null = 'hola@vistta.es';
  planes = () =>
    this.catalogo ? Promise.resolve(this.catalogo) : Promise.reject(new Error('sin catálogo'));
  legal = () => Promise.resolve({ completo: true, contacto: this.contacto });
}

describe('Portada pública', () => {
  let fixture: ComponentFixture<Landing>;
  let api: ApiFalsa;

  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function montar(): Promise<string> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Landing],
      providers: [{ provide: Api, useValue: api }, provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Landing);
    await estabiliza();
    return (fixture.nativeElement.textContent ?? '') as string;
  }

  beforeEach(() => {
    api = new ApiFalsa();
    sessionStorage.clear();
  });

  afterEach(() => sessionStorage.clear());

  /*
   * La portada es la puerta de la calle. A quien ya está dentro no se le enseña:
   * verla con un botón de «Entrar» parece que te has salido sin querer.
   */
  it('a quien tiene sesión se le manda a su cuenta', async () => {
    sessionStorage.setItem('vistta.sesion', 'un-testigo');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Landing],
      providers: [{ provide: Api, useValue: api }, provideRouter([])],
    }).compileComponents();
    // El espía va ANTES de crear el componente: la redirección ocurre en el
    // constructor, así que instalarlo después no la ve pasar.
    const navegado: string[][] = [];
    spyOn(TestBed.inject(Router), 'navigate').and.callFake((r: unknown[]) => {
      navegado.push(r as string[]);
      return Promise.resolve(true);
    });
    fixture = TestBed.createComponent(Landing);
    await estabiliza();

    expect(navegado).toEqual([['/panel']]);
  });

  /*
   * LA PRUEBA QUE IMPORTA. Una portada es donde más fácil se cuela una promesa
   * que el producto no cumple, y este producto se sostiene precisamente sobre
   * no hacerla: la honestidad está escrita en `legal/aup.md` y en la EIPD.
   * Si alguien «mejora» el texto comercial prometiendo que se impiden las
   * capturas, esto se pone rojo.
   */
  it('dice lo que NO hace, y no promete impedir una captura', async () => {
    const texto = await montar();
    expect(texto).toContain('No impide una captura de pantalla');
    for (const mentira of [
      'impide que copien',
      'evita capturas',
      'protección total',
      'imposible de copiar',
      '100% seguro',
    ]) {
      expect(texto.toLowerCase()).not.toContain(mentira);
    }
  });

  it('explica que no hay registro público, porque no lo hay', async () => {
    const texto = await montar();
    expect(texto).toContain('Aquí no hay registro público');
    expect(texto.toLowerCase()).not.toContain('crea tu cuenta');
    expect(texto.toLowerCase()).not.toContain('regístrate');
  });

  /*
   * Las cifras vienen del servidor, que las lee de `planes.ts`. Si alguien las
   * escribiera en la plantilla, el día que cambie la oferta la portada seguiría
   * anunciando la vieja.
   */
  it('los planes salen del catálogo del servidor, no del HTML', async () => {
    const texto = await montar();
    expect(texto).toContain('29 €');
    expect(texto).toContain('1 GB');
    // «Sin límite» y «no caduca» se dicen con palabras, no con un número grande.
    expect(texto).toContain('sin límite');
    expect(texto).toContain('no caduca');
  });

  it('si el catálogo no responde, la portada se ve igual', async () => {
    api.catalogo = null;
    const texto = await montar();
    expect(texto).toContain('Un enlace. Una apertura.');
    expect(texto).toContain('Los planes se están cargando');
  });

  it('enseña el invariante del producto, que es lo que lo distingue', async () => {
    const texto = await montar();
    expect(texto).toContain('200');
    expect(texto).toContain('410');
  });

  /*
   * La demostración se retiró para más adelante. Si vuelve, que vuelva a
   * propósito: un enlace a una pantalla que todavía no está lista es peor que
   * no ofrecerla.
   */
  it('no ofrece la demostración mientras no esté lista', async () => {
    await montar();
    const enlaces = Array.from(
      fixture.nativeElement.querySelectorAll('a[href]'),
    ) as HTMLAnchorElement[];
    expect(enlaces.filter((a) => a.getAttribute('href')?.includes('demo'))).toEqual([]);
  });
});
