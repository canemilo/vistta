import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Viewer } from './viewer';
import { Api, type PassView } from '../core/api';

/**
 * El aviso a quien lee no es adorno: la EIPD declara que no se mide a nadie sin
 * decírselo. Si alguien lo quita para «limpiar» el pie del documento, esto se
 * pone rojo, que es exactamente para lo que está.
 */
const VISTA = (eventos: string | null): PassView => ({
  profile: { id: 'p1', displayName: 'Estudio', brandColor: null },
  sections: [],
  watermark: 'PASE · abcdef12 · 10:15',
  eventos,
});

class ApiFalsa {
  vista: PassView = VISTA(null);
  open = () => Promise.resolve(this.vista);
}

describe('Viewer · se mide, y se dice', () => {
  let fixture: ComponentFixture<Viewer>;
  let api: ApiFalsa;

  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function montar(eventos: string | null): Promise<void> {
    api = new ApiFalsa();
    api.vista = VISTA(eventos);
    await TestBed.configureTestingModule({
      imports: [Viewer],
      providers: [{ provide: Api, useValue: api }, provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Viewer);
    await estabiliza();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('si se mide la lectura, el documento lo dice', async () => {
    await montar('un-testigo-firmado');
    const texto = (fixture.nativeElement.textContent ?? '') as string;
    expect(texto).toContain('verá cuánto tiempo has mirado cada apartado');
    // Y dice qué NO se guarda, que es la otra mitad del aviso.
    expect(texto).toContain('No se registra tu nombre, tu dirección IP ni tu dispositivo');
  });

  it('si no se mide, no se dice: no se avisa de algo que no ocurre', async () => {
    await montar(null);
    const texto = (fixture.nativeElement.textContent ?? '') as string;
    expect(texto).not.toContain('verá cuánto tiempo has mirado');
  });
});
