import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Legal } from './legal';

/**
 * La página legal.
 *
 * Lo que se prueba aquí no es el estilo: es que el texto que se enseña sale de
 * `legal/*.md` —su única versión buena— y que los datos del titular se
 * sustituyen con los del despliegue. Y sobre todo, que los documentos INTERNOS
 * no se ofrecen: el registro del art. 30 y el análisis de riesgos se entregan a
 * la autoridad si los pide, no se publican.
 */

const AVISO = {
  titular: {
    nombre: 'Estudio Ejemplo S.L.',
    identificacion: 'B00000000',
    direccion: 'Calle de Ejemplo 1, 28001 Madrid',
  },
  contacto: 'legal@ejemplo.test',
  completo: true,
};

const SIN_CONFIGURAR = {
  titular: { nombre: null, identificacion: null, direccion: null },
  contacto: null,
  completo: false,
};

const MARKDOWN = [
  '# Términos del servicio',
  '',
  '**Titular:** `TITULAR_NOMBRE` · `TITULAR_IDENTIFICACION` · `TITULAR_DIRECCION`',
  '',
  'Escribe a `CONTACTO_LEGAL` para avisar de un contenido.',
].join('\n');

describe('Legal', () => {
  let fixture: ComponentFixture<Legal>;
  let http: HttpTestingController;

  const texto = () => fixture.nativeElement.textContent as string;
  const botonDoc = (titulo: string) =>
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => (b.textContent ?? '').includes(titulo),
    );

  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function arranca(aviso: typeof AVISO | typeof SIN_CONFIGURAR): Promise<void> {
    fixture = TestBed.createComponent(Legal);
    fixture.detectChanges();
    http.expectOne('/api/legal').flush(aviso);
    await estabiliza();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Legal],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  it('ofrece los cuatro documentos públicos', async () => {
    await arranca(AVISO);
    for (const titulo of [
      'Términos del servicio',
      'Privacidad',
      'Encargado del tratamiento',
      'Uso aceptable y retirada',
    ]) {
      expect(botonDoc(titulo)).withContext(titulo).toBeDefined();
    }
  });

  it('NO ofrece los documentos internos', async () => {
    await arranca(AVISO);
    // El registro del art. 30 y el análisis de riesgos se entregan a la
    // autoridad si los pide; no se publican. Si alguien los añade a la lista,
    // esta prueba se pone roja.
    expect(texto()).not.toContain('Registro de actividades');
    expect(texto()).not.toContain('Evaluación de impacto');

    // Cuatro documentos y ni uno más: contar es lo que detecta el quinto.
    const documentos = fixture.nativeElement.querySelectorAll('ul li button');
    expect(documentos.length).toBe(4);

    // Y ninguno pide un archivo interno. `expectNone` falla si se pidiera.
    http.expectNone('/legal/rat.md');
    http.expectNone('/legal/eipd.md');
  });

  it('el correo de avisos se puede pulsar y no hace falta cuenta', async () => {
    await arranca(AVISO);
    const enlace = fixture.nativeElement.querySelector(
      'a[href^="mailto:"]',
    ) as HTMLAnchorElement | null;
    expect(enlace?.getAttribute('href')).toBe('mailto:legal@ejemplo.test');
  });

  it('sustituye los datos del titular en el documento', async () => {
    await arranca(AVISO);
    botonDoc('Términos del servicio')!.click();
    await estabiliza();
    http.expectOne('/legal/terminos.md').flush(MARKDOWN);
    await estabiliza();

    const documento = fixture.nativeElement.querySelector('.documento') as HTMLElement;
    expect(documento.textContent).toContain('Estudio Ejemplo S.L.');
    expect(documento.textContent).toContain('B00000000');
    expect(documento.textContent).toContain('legal@ejemplo.test');
    // Y no queda ningún marcador crudo a la vista.
    expect(documento.textContent).not.toContain('TITULAR_NOMBRE');
    expect(documento.textContent).not.toContain('CONTACTO_LEGAL');
  });

  it('sin configurar avisa, y el hueco lo dice en vez de quedarse en blanco', async () => {
    await arranca(SIN_CONFIGURAR);
    // Un aviso legal con huecos que parece estar en vigor es peor que no tenerlo.
    expect(texto()).toContain('Sin configurar');

    botonDoc('Términos del servicio')!.click();
    await estabiliza();
    http.expectOne('/legal/terminos.md').flush(MARKDOWN);
    await estabiliza();

    const documento = fixture.nativeElement.querySelector('.documento') as HTMLElement;
    expect(documento.textContent).toContain('(pendiente de configurar)');
    expect(documento.textContent).not.toContain('TITULAR_NOMBRE');
  });

  it('configurado no enseña el aviso de sin configurar', async () => {
    await arranca(AVISO);
    expect(texto()).not.toContain('Sin configurar');
  });
});
