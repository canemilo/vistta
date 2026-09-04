import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Admin } from './admin';
import type { CuentaAdmin } from '../core/api';
import { Api, type Usuario } from '../core/api';

/**
 * La puerta del panel de administración.
 *
 * Lo que se prueba aquí no es el aspecto: es lo que la pantalla NO deja
 * averiguar. El formulario responde lo mismo a unas credenciales incorrectas
 * que a una cuenta correcta sin el rol, así que probar usuarios no sirve para
 * saber quién es administrador. Es la mitad de la defensa; la otra es que la API responde 404
 * en todo /api/admin/* a quien no lo sea, y eso vive en test/admin.spec.ts.
 */

class ApiFalsa {
  rol: Usuario['role'] = 'admin';
  fallaLogin = false;
  sesionesCerradas: string[] = [];

  login = (id: string) => {
    if (this.fallaLogin) return Promise.reject({ status: 401 });
    return Promise.resolve({
      token: 'sesion-nueva',
      expiresAt: Date.now() + 3_600_000,
      user: { id, displayName: id, role: this.rol },
    });
  };

  me = () => Promise.resolve({ user: { id: 'soporte', displayName: 'Soporte', role: this.rol } });

  cuentas: CuentaAdmin[] = [];
  adminCuentas = () =>
    Promise.resolve({ cuentas: this.cuentas, planes: ['prueba', 'pro', 'boveda'] });
  adminAuditoria = () => Promise.resolve({ registros: [] });
  adminPagos = () => Promise.resolve({ pagos: [] });

  logout = (t: string) => {
    this.sesionesCerradas.push(t);
    return Promise.resolve({ ok: true });
  };
}

describe('Admin · la puerta', () => {
  let fixture: ComponentFixture<Admin>;
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

  async function intentaEntrar(usuario: string, clave: string): Promise<void> {
    (fixture.nativeElement.querySelector('#admin-usuario') as HTMLInputElement).value = usuario;
    fixture.nativeElement.querySelector('#admin-usuario').dispatchEvent(new Event('input'));
    (fixture.nativeElement.querySelector('#admin-clave') as HTMLInputElement).value = clave;
    fixture.nativeElement.querySelector('#admin-clave').dispatchEvent(new Event('input'));
    await estabiliza();
    boton('ENTRAR')!.click();
    await estabiliza();
  }

  beforeEach(async () => {
    sessionStorage.clear();
    api = new ApiFalsa();
    await TestBed.configureTestingModule({
      imports: [Admin],
      providers: [{ provide: Api, useValue: api }, provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Admin);
    await estabiliza();
  });

  afterEach(() => sessionStorage.clear());

  it('la puerta se nombra: pone «Administración»', async () => {
    // Decisión tomada a sabiendas: la URL se averigua escribiéndola, así que
    // esconder el rótulo compraba poco y costaba claridad a quien la usa a
    // diario. Lo que sí se protege es OTRA cosa, y va en las dos pruebas de
    // abajo: que probando cuentas no se pueda averiguar quién es administrador.
    expect(texto()).toContain('Administración');
  });

  it('los campos tienen etiqueta visible unida a su control', async () => {
    for (const id of ['admin-usuario', 'admin-clave']) {
      const etiqueta = fixture.nativeElement.querySelector(`label[for="${id}"]`);
      expect(etiqueta).withContext(id).not.toBeNull();
      expect(fixture.nativeElement.querySelector(`#${id}`))
        .withContext(id)
        .not.toBeNull();
    }
  });

  it('una cuenta SIN el rol recibe el mismo mensaje que unas credenciales malas', async () => {
    api.rol = 'cliente';
    await intentaEntrar('marina', 'una-contrasena-larga');
    const conCuentaBuena = texto();

    api.fallaLogin = true;
    await intentaEntrar('marina', 'lo-que-sea');
    const conCredencialesMalas = texto();

    // Si los dos mensajes se distinguieran, el formulario sería un buscador de
    // administradores: se prueban cuentas hasta que una responda distinto.
    expect(conCuentaBuena).toContain('No se pudo entrar con esos datos.');
    expect(conCredencialesMalas).toContain('No se pudo entrar con esos datos.');
  });

  it('a una cuenta sin el rol no se le abre sesión ni se le guarda nada', async () => {
    api.rol = 'cliente';
    await intentaEntrar('marina', 'una-contrasena-larga');

    expect(sessionStorage.getItem('vistta.sesion')).toBeNull();
    // Y sigue en la puerta: el formulario está a la vista, no el panel.
    expect(fixture.nativeElement.querySelector('#admin-clave')).not.toBeNull();
  });

  it('una sesión de cliente que llegue aquí se va a su panel', async () => {
    api.rol = 'cliente';
    sessionStorage.setItem('vistta.sesion', 'sesion-de-cliente');
    const navegado: string[][] = [];
    fixture = TestBed.createComponent(Admin);
    spyOn(TestBed.inject(Router), 'navigate').and.callFake((r: unknown[]) => {
      navegado.push(r as string[]);
      return Promise.resolve(true);
    });
    await estabiliza();

    // A /panel y no a la raíz: desde que hay portada pública, la raíz es la
    // página de producto. Mandar allí a alguien que acaba de identificarse
    // sería sacarlo de la aplicación en vez de llevarlo a lo suyo.
    expect(navegado).toEqual([['/panel']]);
  });

  it('dice que todo queda registrado: es verdad y es la mitad de para qué sirve', async () => {
    expect(texto()).toContain('queda registrada');
    expect(texto()).toContain('desde la máquina que tiene la base');
  });
});

const DIA = 86_400_000;

/** Una cuenta cualquiera, para retocarle solo lo que interesa en cada prueba. */
function cuenta(id: string, extra: Partial<CuentaAdmin> = {}): CuentaAdmin {
  return {
    id,
    displayName: id,
    plan: 'pro',
    status: 'activa',
    role: 'cliente',
    createdAt: Date.now() - 30 * DIA,
    suspendedAt: null,
    perfilesActivos: 1,
    perfilesCongelados: 0,
    pasesAbiertos: 0,
    bytesUsados: 0,
    clavePedidaEl: null,
    planHasta: null,
    pagoPendiente: null,
    ...extra,
  };
}

/**
 * El control del cobro manual.
 *
 * La tabla de cuentas lo tiene todo, pero tenerlo todo no es saber qué toca
 * hoy. Estas dos listas son el trabajo: a quién le emití un código y no he
 * visto el ingreso, y a quién se le acaba el plan antes de que me entere.
 */
describe('Admin · el control del cobro', () => {
  let fixture: ComponentFixture<Admin>;
  let api: ApiFalsa;

  async function estabiliza(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function montar(cuentas: CuentaAdmin[]): Promise<string> {
    api = new ApiFalsa();
    api.rol = 'admin';
    api.cuentas = cuentas;
    sessionStorage.setItem('vistta.sesion', 'sesion-admin');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Admin],
      providers: [{ provide: Api, useValue: api }, provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Admin);
    await estabiliza();
    return (fixture.nativeElement.textContent ?? '') as string;
  }

  afterEach(() => sessionStorage.clear());

  it('enseña quién debe pagar, con su código y su importe', async () => {
    const texto = await montar([
      cuenta('marina', {
        pagoPendiente: {
          codigo: 'VISTTA-ABC123',
          importe: 1200,
          plan: 'pro',
          caduca: Date.now() + 10 * DIA,
        },
      }),
    ]);
    expect(texto).toContain('Esperando cobro');
    expect(texto).toContain('VISTTA-ABC123');
    expect(texto).toContain('12,00 €');
  });

  it('enseña quién baja de plan si no paga, y cuándo', async () => {
    // 2,5 días y no 2 exactos: con el filo justo, los milisegundos que pasan
    // entre montar el doble y pintar bastan para que el redondeo hacia abajo
    // diga «1 día». Que es correcto, pero hace frágil la prueba.
    const texto = await montar([cuenta('marina', { planHasta: Date.now() + 2.5 * DIA })]);
    expect(texto).toContain('Bajan de plan si no pagan');
    expect(texto).toContain('vence en 2 días');
    // Y dice que no se pierde nada, que es lo que evita una llamada asustada.
    expect(texto).toContain('No se borra nada');
  });

  /*
   * Una bandeja vacía permanente enseña a no mirar. Si no hay nada que cobrar
   * ni nadie a punto de caer, estas listas no salen.
   */
  it('sin trabajo pendiente, no enseña listas vacías', async () => {
    const texto = await montar([cuenta('marina', { plan: 'prueba' })]);
    expect(texto).not.toContain('Esperando cobro');
    expect(texto).not.toContain('Bajan de plan');
  });

  it('un plan que vence dentro de un mes todavía no aparece', async () => {
    const texto = await montar([cuenta('marina', { planHasta: Date.now() + 30 * DIA })]);
    expect(texto).not.toContain('Bajan de plan');
  });
});
