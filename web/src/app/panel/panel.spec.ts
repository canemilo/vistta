import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Panel } from './panel';
import { Api, type EstadoDeCuenta, type ProfileRow, type Usuario } from '../core/api';

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
  /** El rol que devuelven `me` y `login`. Un administrador no pinta aquí. */
  rol: Usuario['role'] = 'cliente';
  perfiles: ProfileRow[] = [PERFIL('p_uno', 'Primero')];
  tope = 3;
  creados: string[] = [];
  borrados: { id: string; confirmacion: string }[] = [];
  sesionesCerradas: string[] = [];
  /** Lo que devolverá el próximo `createProfile`, si es un fallo. */
  fallaAlCrear: { status: number } | null = null;

  me = () => Promise.resolve({ user: { id: 'marina', displayName: 'Marina', role: this.rol } });

  login = (id: string) =>
    Promise.resolve({
      token: 'sesion-nueva',
      expiresAt: Date.now() + 3_600_000,
      user: { id, displayName: id, role: this.rol },
    });

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

  borrarPerfil = (_s: string, id: string, confirmacion: string) => {
    this.borrados.push({ id, confirmacion });
    this.perfiles = this.perfiles.filter((p) => p.id !== id);
    return Promise.resolve({ ok: true });
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

describe('Panel · una cuenta de administrador no se queda aquí', () => {
  let fixture: ComponentFixture<Panel>;
  let api: ApiFalsa;
  let navegado: string[][];

  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    api = new ApiFalsa();
    api.rol = 'admin';
    await TestBed.configureTestingModule({
      imports: [Panel],
      providers: [{ provide: Api, useValue: api }, provideRouter([])],
    }).compileComponents();
    navegado = [];
    spyOn(TestBed.inject(Router), 'navigate').and.callFake((ruta: unknown[]) => {
      navegado.push(ruta as string[]);
      return Promise.resolve(true);
    });
  });

  afterEach(() => sessionStorage.clear());

  it('al recuperar la sesión se le manda a su panel', async () => {
    // Un administrador no tiene perfiles: `admin:create` le borra el del alta.
    // Sin esto, el editor se montaba sin ningún perfil detrás y lo que
    // escribiera no se guardaba en ninguna parte.
    sessionStorage.setItem('vistta.sesion', 'sesion-de-admin');
    fixture = TestBed.createComponent(Panel);
    await estabiliza();

    expect(navegado).toEqual([['/admin']]);
  });

  it('no llega a pedir los perfiles: no son suyos y no los hay', async () => {
    sessionStorage.setItem('vistta.sesion', 'sesion-de-admin');
    let pedidos = 0;
    api.profiles = () => {
      pedidos++;
      return Promise.resolve({
        profiles: [],
        plan: null,
        uso: { perfilesActivos: 0, pasesAbiertos: 0 },
      });
    };
    fixture = TestBed.createComponent(Panel);
    await estabiliza();

    expect(pedidos).toBe(0);
  });

  it('entrando por el formulario también se le manda a su panel', async () => {
    fixture = TestBed.createComponent(Panel);
    await estabiliza();

    const usuario = fixture.nativeElement.querySelector('#usuario') as HTMLInputElement;
    const clave = fixture.nativeElement.querySelector('input[type="password"]') as HTMLInputElement;
    usuario.value = 'adminprueba';
    usuario.dispatchEvent(new Event('input'));
    clave.value = 'una-contrasena-larga';
    clave.dispatchEvent(new Event('input'));
    await estabiliza();

    const entrar = (
      Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]
    ).find((b) => (b.textContent ?? '').trim().startsWith('ENTRAR'));
    entrar!.click();
    await estabiliza();

    // Redirigir, no dar error: las credenciales son correctas y el rol es real.
    // Lo que no encaja es la pantalla.
    expect(navegado).toEqual([['/admin']]);
    expect(fixture.nativeElement.textContent).not.toContain('no son correctos');
  });

  it('a un cliente no se le redirige a ninguna parte', async () => {
    api.rol = 'cliente';
    sessionStorage.setItem('vistta.sesion', 'sesion-de-cliente');
    fixture = TestBed.createComponent(Panel);
    await estabiliza();

    expect(navegado).toEqual([]);
  });
});

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
