import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Api, type FilaDeComparativa } from '../core/api';
import { CLAVE_SESION } from '../core/sesion';
import { Actividad } from './actividad';

/**
 * La comparativa de la cartera, y la nota de cada ficha dentro de ella.
 *
 * Esta pantalla es donde el agente decide a quién llama hoy. La nota que
 * escribe en la ficha del inmueble —«el propietario aprieta», «bajar precio en
 * octubre»— vivía en el formulario del informe y no aparecía en ninguna otra
 * parte: se escribía y solo se reencontraba volviendo allí. Su sitio es este,
 * al lado de las cifras de esa propiedad.
 */

const FILA = (extra: Partial<FilaDeComparativa> = {}): FilaDeComparativa => ({
  profileId: 'p_uno',
  displayName: 'Piso centro',
  referencia: null,
  propietarioNota: null,
  enviados: 5,
  abiertos: 4,
  pctApertura: 80,
  msMedio: 60_000,
  llegaronAlFinal: 2,
  pctFinal: 50,
  datosSuficientes: true,
  destacado: null,
  ...extra,
});

class ApiFalsa {
  filas: FilaDeComparativa[] = [FILA()];
  avisos = () => Promise.resolve({ avisos: [], activos: true, conexionApagada: false });
  termometro = () => Promise.resolve({ pases: [] });
  comparativa = () => Promise.resolve({ periodo: { desde: 0, hasta: 1 }, filas: this.filas });
}

describe('Actividad · la ficha en la comparativa', () => {
  let fixture: ComponentFixture<Actividad>;
  let api: ApiFalsa;

  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function monta(): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Actividad],
      providers: [{ provide: Api, useValue: api }, provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Actividad);
    await estabiliza();
  }

  beforeEach(() => {
    api = new ApiFalsa();
    sessionStorage.setItem(CLAVE_SESION, 'sesion-de-prueba');
  });

  afterEach(() => sessionStorage.clear());

  it('la referencia se lee junto al nombre del inmueble', async () => {
    api.filas = [FILA({ referencia: 'REF-42' })];
    await monta();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Piso centro');
    expect(texto).toContain('REF-42');
  });

  /*
   * LO QUE RESUELVE LA QUEJA. Sin esto, la nota era un cajón: se escribía en un
   * formulario y no se volvía a ver.
   */
  it('la nota de la ficha se ve en la fila de su propiedad', async () => {
    api.filas = [FILA({ propietarioNota: 'Aprieta con el precio' })];
    await monta();

    expect(fixture.nativeElement.textContent).toContain('Aprieta con el precio');
  });

  it('sin nota no se pinta un hueco', async () => {
    api.filas = [FILA()];
    await monta();

    const fila = fixture.nativeElement.querySelector('tbody tr') as HTMLElement;
    expect(fila.querySelectorAll('span.italic').length).toBe(0);
  });
});
