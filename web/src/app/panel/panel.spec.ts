import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Panel } from './panel';
import { Api, type EstadoDeCuenta, type ProfileRow } from '../core/api';

/**
 * Crear perfiles y salir de la cuenta.
 *
 * Las dos existían en el servidor y en `Api` desde hace bloques, y ninguna
 * estaba conectada a la plantilla: toda cuenta se quedaba con el único perfil
 * que se crea al darla de alta —dijera lo que dijera su plan— y no había forma
 * de cerrar la sesión. Por eso se prueba por el DOM: lo que falló no fue la
 * lógica, fue que nadie la llamaba.
 */

const PERFIL = (id: string, nombre: string): ProfileRow => ({
  id,
  displayName: nombre,
  status: 'activo',
  purgeAt: null,
});

const LIMITES = (perfiles: number) => ({
  perfiles,
  pasesSimultaneos: 30,
  cuotaPorPerfil: 200 * 1024 * 1024,
  retencionMs: 15 * 86_400_000,
});

class ApiFalsa {
  perfiles: ProfileRow[] = [PERFIL('p_uno', 'Primero')];
  tope = 3;
  creados: string[] = [];
  sesionesCerradas: string[] = [];
  /** Lo que devolverá el próximo `createProfile`, si es un fallo. */
  fallaAlCrear: { status: number } | null = null;

  me = () => Promise.resolve({ user: { id: 'marina', displayName: 'Marina', role: 'cliente' } });

  profiles = (): Promise<EstadoDeCuenta> =>
    Promise.resolve({
      profiles: this.perfiles,
      plan: { nombre: 'pro' as const, limites: LIMITES(this.tope) },
      uso: {
        perfilesActivos: this.perfiles.filter((p) => p.status === 'activo').length,
        pasesAbiertos: 0,
      },
    });

  facturacion = () => Promise.reject(new Error('no hace falta para estas pruebas'));

  getProfile = (_s: string, id: string) =>
    Promise.resolve({
      id,
      displayName: this.perfiles.find((p) => p.id === id)?.displayName ?? '',
      data: { sections: [] },
    });

  createProfile = (_s: string, displayName: string) => {
    if (this.fallaAlCrear) return Promise.reject(this.fallaAlCrear);
    const fila = PERFIL(`p_${this.creados.length + 2}`, displayName);
    this.creados.push(displayName);
    this.perfiles = [...this.perfiles, fila];
    return Promise.resolve(fila);
  };

  logout = (token: string) => {
    this.sesionesCerradas.push(token);
    return Promise.resolve({ ok: true });
  };

  preview = () => Promise.resolve('');
}

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
      providers: [{ provide: Api, useValue: api }],
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
