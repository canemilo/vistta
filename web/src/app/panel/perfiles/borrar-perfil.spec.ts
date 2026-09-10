import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Api } from '../../core/api';
import { Panel } from '../panel';
import { ApiFalsa, PERFIL } from '../panel.fixtures';

/**
 * Borrar un perfil, y qué pasa cuando era el último.
 *
 * Sin esto, crear un perfil era un callejón sin salida: el límite del plan
 * cuenta perfiles ACTIVOS, así que uno creado por error ocupaba plaza para
 * siempre y, con el plan Prueba —que da uno—, dejaba la cuenta encerrada.
 */

describe('Panel · borrar un perfil y quedarse sin ninguno', () => {
  let fixture: ComponentFixture<Panel>;
  let api: ApiFalsa;

  const boton = (texto: string) =>
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => (b.textContent ?? '').trim().startsWith(texto),
    );
  const texto = () => fixture.nativeElement.textContent as string;

  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function tecleaConfirmacion(valor: string): Promise<void> {
    const campo = fixture.nativeElement.querySelector('#confirmar-perfil') as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    await estabiliza();
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

  it('hay que teclear el nombre exacto: el botón no se enciende antes', async () => {
    boton('BORRAR ESTE PERFIL')!.click();
    await estabiliza();

    // Lo destructivo tiene que costar más que un clic de más.
    expect(boton('BORRAR')!.disabled).toBeTrue();
    await tecleaConfirmacion('primer');
    expect(boton('BORRAR')!.disabled).toBeTrue();
    await tecleaConfirmacion('Primero');
    expect(boton('BORRAR')!.disabled).toBeFalse();
  });

  it('avisa de que los enlaces ya enviados dejarán de abrirse', async () => {
    boton('BORRAR ESTE PERFIL')!.click();
    await estabiliza();
    // Es la consecuencia que no se ve mirando la pantalla.
    expect(texto()).toContain('dejarán de abrirse');
  });

  it('borra y manda al servidor el nombre tecleado', async () => {
    boton('BORRAR ESTE PERFIL')!.click();
    await estabiliza();
    await tecleaConfirmacion('Primero');
    boton('BORRAR')!.click();
    await estabiliza();

    expect(api.borrados).toEqual([{ id: 'p_uno', confirmacion: 'Primero' }]);
  });

  it('al borrar el último no queda un editor sin nada detrás', async () => {
    boton('BORRAR ESTE PERFIL')!.click();
    await estabiliza();
    await tecleaConfirmacion('Primero');
    boton('BORRAR')!.click();
    await estabiliza();

    // Era la pantalla rota que veía una cuenta de administrador: el editor
    // montado sin perfil, aceptando lo que escribías y tirándolo.
    expect(texto()).toContain('No tienes ningún perfil');
    expect(boton('CREAR UN PERFIL')).toBeDefined();
    expect(boton('GENERAR ENLACE')).toBeUndefined();
  });

  it('si quedan más, se pasa al siguiente en vez de dejar la pantalla vacía', async () => {
    api.perfiles = [PERFIL('p_uno', 'Primero'), PERFIL('p_dos', 'Segundo')];
    fixture = TestBed.createComponent(Panel);
    await estabiliza();

    boton('BORRAR ESTE PERFIL')!.click();
    await estabiliza();
    await tecleaConfirmacion('Primero');
    boton('BORRAR')!.click();
    await estabiliza();

    const selector = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(selector.value).toBe('p_dos');
    expect(texto()).not.toContain('No tienes ningún perfil');
  });
});
