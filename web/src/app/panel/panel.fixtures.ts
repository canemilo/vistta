import {
  type EstadoDeCuenta,
  type LimitesDePlan,
  type OpcionesDePase,
  type PaseListado,
  type ProfileContent,
  type ResumenDeLectura,
  type ProfileRow,
  type Usuario,
} from '../core/api';

/**
 * El doble de la API y el andamio, compartidos por las pruebas del panel.
 *
 * Están aquí y no en cada archivo porque el panel se probó siempre POR EL DOM,
 * y esa decisión no cambia al partirlo en componentes: lo que falló la primera
 * vez no fue la lógica —existía y era correcta—, fue que ninguna pantalla la
 * llamaba. Un doble por área tentaría a probar cada servicio por separado, que
 * es exactamente lo que no detectó aquello.
 *
 * Este archivo NO es `.spec.ts` a propósito: no contiene pruebas, y con esa
 * extensión el runner lo cargaría como una suite vacía.
 */

const PERFIL = (id: string, nombre: string): ProfileRow => ({
  id,
  displayName: nombre,
  status: 'activo',
  purgeAt: null,
});

export const LIMITES = (perfiles: number): LimitesDePlan => ({
  perfiles,
  pasesSimultaneos: 30,
  cuotaPorPerfil: 200 * 1024 * 1024,
  retencionMs: 15 * 86_400_000,
  modosDePase: ['unico', 'accesos', 'ventana'],
  maxAccesos: 5,
  ventanaMaxMs: 2 * 86_400_000,
  plazoPrimeraAperturaMaxMs: 7 * 86_400_000,
  metricasDeLectura: true,
});

export class ApiFalsa {
  /** El rol que devuelven `me` y `login`. Un administrador no pinta aquí. */
  rol: Usuario['role'] = 'cliente';
  perfiles: ProfileRow[] = [PERFIL('p_uno', 'Primero')];
  tope = 3;
  creados: string[] = [];
  borrados: { id: string; confirmacion: string }[] = [];
  clavesPedidas: string[] = [];
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

  /** Lo guardado por perfil: es donde aterriza la plantilla al crear. */
  guardados: Record<string, ProfileContent> = {};
  fallaAlGuardar = false;

  getProfile = (_s: string, id: string) =>
    Promise.resolve({
      id,
      displayName: this.perfiles.find((p) => p.id === id)?.displayName ?? '',
      data: this.guardados[id] ?? { sections: [] },
    });

  saveProfile = (_s: string, id: string, body: { displayName?: string; data: ProfileContent }) => {
    if (this.fallaAlGuardar) return Promise.reject(new Error('no se pudo guardar'));
    this.guardados[id] = body.data;
    return Promise.resolve({ ok: true });
  };

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

  claveOlvidada = (userId: string) => {
    this.clavesPedidas.push(userId);
    return Promise.resolve({
      ok: true,
      mensaje: 'Si esa cuenta existe, hemos avisado a quien la administra.',
    });
  };

  logout = (token: string) => {
    this.sesionesCerradas.push(token);
    return Promise.resolve({ ok: true });
  };

  preview = () => Promise.resolve('');

  /** Enlaces ya generados y opciones con las que se pidió el último. */
  pases: PaseListado[] = [];
  ultimoPasePedido: OpcionesDePase | null = null;

  createPass = (_s: string, _perfil: string, opciones: OpcionesDePase = {}) => {
    this.ultimoPasePedido = opciones;
    return Promise.resolve({
      url: 'https://vistta.example/v/abc',
      expiresAt: Date.now() + 900_000,
      modo: (opciones.modo ?? 'unico') as 'unico' | 'accesos' | 'ventana',
    });
  };

  listPasses = () => Promise.resolve({ passes: this.pases });

  limpiados: string[] = [];
  limpiarPases = (_s: string, perfil: string) => {
    this.limpiados.push(perfil);
    const antes = this.pases.length;
    this.pases = this.pases.filter((p) => p.estado === 'abrible');
    return Promise.resolve({ borrados: antes - this.pases.length });
  };

  lectura: ResumenDeLectura = { hayDatos: false, msTotales: 0, secciones: [], medios: [] };
  lecturaDelPase = () => Promise.resolve(this.lectura);
}

export { PERFIL };
