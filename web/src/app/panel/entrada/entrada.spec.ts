import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Api } from '../../core/api';
import { Panel } from '../panel';
import { ApiFalsa } from '../panel.fixtures';

/**
 * La pantalla de entrada: quién puede pasar, quién no, y qué se ve mientras.
 *
 * Las tres cosas que se prueban aquí tienen la misma forma: son casos donde lo
 * correcto NO es un error. Una cuenta de administrador tiene credenciales
 * válidas y un rol real, así que se la redirige; quien olvida la contraseña
 * recibe la misma respuesta exista o no su cuenta, para que el formulario no
 * sea un comprobador de usuarios; y el giro de la tarjeta no puede dejar a
 * nadie fuera de su propio panel si la animación no llega a ocurrir.
 */

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

describe('Panel · he olvidado la contraseña', () => {
  let fixture: ComponentFixture<Panel>;
  let api: ApiFalsa;

  const texto = () => fixture.nativeElement.textContent as string;
  const boton = (t: string) =>
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => (b.textContent ?? '').trim().startsWith(t),
    );

  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    sessionStorage.clear();
    api = new ApiFalsa();
    await TestBed.configureTestingModule({
      imports: [Panel],
      providers: [{ provide: Api, useValue: api }, provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Panel);
    await estabiliza();
  });

  afterEach(() => sessionStorage.clear());

  it('la ofrece desde la pantalla de entrada', async () => {
    expect(boton('He olvidado la contraseña')).toBeDefined();
  });

  it('NO promete un correo, porque no se guarda el de nadie', async () => {
    boton('He olvidado la contraseña')!.click();
    await estabiliza();

    // Prometer un correo que no llega nunca es la peor forma de fallar aquí.
    expect(texto()).toContain('No se envía ningún correo');
    expect(texto().toLowerCase()).not.toContain('revisa tu bandeja');
    expect(texto().toLowerCase()).not.toContain('enlace de recuperación');
  });

  it('manda el usuario y enseña la respuesta del servidor', async () => {
    boton('He olvidado la contraseña')!.click();
    await estabiliza();

    const campo = fixture.nativeElement.querySelector('#usuario-olvidado') as HTMLInputElement;
    campo.value = 'marina';
    campo.dispatchEvent(new Event('input'));
    await estabiliza();

    boton('PEDIRLA')!.click();
    await estabiliza();

    expect(api.clavesPedidas).toEqual(['marina']);
    // El mensaje lo decide el SERVIDOR, y es el mismo exista la cuenta o no: si
    // lo compusiera la pantalla, acabaría diciendo si el usuario existe.
    expect(texto()).toContain('Si esa cuenta existe');
  });

  it('sin escribir el usuario no se puede pedir', async () => {
    boton('He olvidado la contraseña')!.click();
    await estabiliza();
    expect(boton('PEDIRLA')!.disabled).toBeTrue();
    expect(api.clavesPedidas).toEqual([]);
  });

  it('se puede cancelar y volver a la entrada', async () => {
    boton('He olvidado la contraseña')!.click();
    await estabiliza();
    boton('CANCELAR')!.click();
    await estabiliza();

    expect(boton('He olvidado la contraseña')).toBeDefined();
    expect(fixture.nativeElement.querySelector('#usuario-olvidado')).toBeNull();
  });
});

describe('Panel · el giro al entrar', () => {
  let fixture: ComponentFixture<Panel>;
  let api: ApiFalsa;

  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    api = new ApiFalsa();
    // Sin sesión guardada: así se ve la pantalla de entrada de verdad.
    sessionStorage.clear();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Panel],
      providers: [{ provide: Api, useValue: api }, provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Panel);
    await estabiliza();
  });

  afterEach(() => sessionStorage.clear());

  /*
   * LO QUE ESTA PRUEBA PROTEGE no es la animación, es que la animación no
   * impida entrar. El giro mete una espera entre la contraseña correcta y el
   * panel; si esa espera se rompiera —o dependiera de un evento que no llega—,
   * alguien con sus credenciales bien puestas se quedaría mirando una pantalla
   * parada. Un adorno no puede dejar a nadie fuera de su propio panel.
   */
  /**
   * Entrar y volver a salir. La animación de salida lleva `forwards`, así que
   * deja la tarjeta girada y a opacidad cero: si al salir no se deshace, la
   * pantalla de entrada vuelve ya desaparecida y lo que se ve es un rectángulo
   * negro. Ocurrió, y por eso esto mira que el formulario se vea otra vez y que
   * la clase del giro no se haya quedado puesta.
   */
  it('al salir, la pantalla de entrada vuelve a verse', async () => {
    const usuario = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const clave = fixture.nativeElement.querySelector('input[type="password"]') as HTMLInputElement;
    usuario.value = 'marina';
    usuario.dispatchEvent(new Event('input'));
    clave.value = 'una-contrasena-larga';
    clave.dispatchEvent(new Event('input'));
    await estabiliza();
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((b) => (b.textContent ?? '').trim().startsWith('ENTRAR'))!
      .click();
    await new Promise((listo) => setTimeout(listo, 700));
    await estabiliza();

    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((b) => (b.textContent ?? '').trim().startsWith('SALIR'))!
      .click();
    await estabiliza();

    expect(fixture.nativeElement.querySelector('input[type="password"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.gira-salida')).toBeNull();
  });

  it('tras entrar bien, el panel acaba apareciendo', async () => {
    const usuario = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const clave = fixture.nativeElement.querySelector('input[type="password"]') as HTMLInputElement;
    usuario.value = 'marina';
    usuario.dispatchEvent(new Event('input'));
    clave.value = 'una-contrasena-larga';
    clave.dispatchEvent(new Event('input'));
    await estabiliza();

    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((b) => (b.textContent ?? '').trim().startsWith('ENTRAR'))!
      .click();

    // Más de lo que dura el giro: si hiciera falta esperar más, es que el
    // adorno se ha vuelto un obstáculo.
    await new Promise((listo) => setTimeout(listo, 700));
    await estabiliza();

    expect(sessionStorage.getItem('vistta.sesion')).toBe('sesion-nueva');
    const texto = (fixture.nativeElement.textContent ?? '') as string;
    expect(texto).toContain('VER COMO EL CLIENTE');
  });
});
