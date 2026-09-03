import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface MediaItem {
  url: string;
  type?: 'image' | 'video' | 'doc';
  caption?: string;
  /** Dimensiones reales, medidas en el servidor al subir. Nunca las declara el cliente. */
  width?: number | null;
  height?: number | null;
  /** Miniatura minúscula en data URI para pintar el hueco mientras carga. */
  lqip?: string | null;
}

export interface SectionView {
  type: 'texto' | 'galeria' | 'proyecto';
  title?: string;
  body?: string;
  items: MediaItem[];
}

export interface PassView {
  profile: {
    id: string;
    displayName: string;
    brandColor: string | null;
    tagline?: string;
    intro?: string;
  };
  sections: SectionView[];
  watermark: string;
}

export interface Usuario {
  id: string;
  displayName: string;
  role: 'cliente' | 'admin';
}

/** Una cuenta vista desde administración. Sin una línea de contenido del cliente. */
export interface CuentaAdmin {
  id: string;
  displayName: string;
  plan: 'prueba' | 'pro' | 'boveda';
  status: 'activa' | 'suspendida';
  role: 'cliente' | 'admin';
  createdAt: number;
  suspendedAt: number | null;
  perfilesActivos: number;
  perfilesCongelados: number;
  pasesAbiertos: number;
  bytesUsados: number;
  /** Cuándo pidió una contraseña nueva, o null si no la ha pedido. */
  clavePedidaEl: number | null;
}

export interface Pago {
  id: string;
  code: string;
  userId: string;
  plan: 'prueba' | 'pro' | 'boveda';
  periodo: 'mensual' | 'anual';
  /** En céntimos y entero: un importe en coma flotante acaba cobrando 11,999999. */
  importe: number;
  moneda: string;
  status: 'pendiente' | 'cobrado' | 'anulado';
  expiresAt: number;
  createdAt: number;
  confirmedAt: number | null;
  confirmedBy: string | null;
  metodo: string | null;
  nota: string | null;
}

export interface EstadoFacturacion {
  plan: 'prueba' | 'pro' | 'boveda' | null;
  /** null = sin caducidad. */
  planHasta: number | null;
  porVencer: boolean;
  pendiente: Pago | null;
  catalogo: {
    planes: string[];
    periodos: string[];
    precios: Record<string, Record<string, number>>;
    moneda: string;
  };
  pago: { bizum: string | null; paypal: string | null };
}

export interface RegistroAuditoria {
  id: string;
  adminId: string;
  accion: string;
  objetivo: string | null;
  detalle: Record<string, unknown>;
  createdAt: number;
}

export interface Sesion {
  token: string;
  expiresAt: number;
  user: Usuario;
}

export interface ProfileRow {
  id: string;
  displayName: string;
  status: 'activo' | 'congelado';
  /** Fecha en que se borrará si nadie lo rescata. null si está activo. */
  purgeAt: number | null;
}

export type ModoDePase = 'unico' | 'accesos' | 'ventana';

export interface LimitesDePlan {
  perfiles: number;
  /** null = sin límite. */
  pasesSimultaneos: number | null;
  cuotaPorPerfil: number;
  /** null = no caduca nunca. Las dos cosas son lo que se paga en Bóveda. */
  retencionMs: number | null;
  /** Modos que admite el plan. `unico` está en todos. */
  modosDePase: ModoDePase[];
  /** null = el plan no admite el modo por accesos. */
  maxAccesos: number | null;
  /** null = el plan no admite ventana. */
  ventanaMaxMs: number | null;
  plazoPrimeraAperturaMaxMs: number;
}

/**
 * Un pase en la lista del panel. El estado lo calcula el servidor: aquí no se
 * deduce, porque dos ideas distintas de «todavía se abre» acaban con el panel
 * mintiendo sobre un enlace que ya se mandó.
 */
export interface PaseListado {
  id: string;
  modo: ModoDePase;
  estado: 'abrible' | 'agotado' | 'caducado';
  creadoEn: number;
  expiraEn: number;
  validoHasta: number | null;
  accesosUsados: number;
  maxAccesos: number | null;
}

/** Lo que se pide al crear un pase. Sin `modo`, sale de un solo uso. */
export interface OpcionesDePase {
  modo?: ModoDePase;
  maxAccesos?: number;
  ventanaMs?: number;
}

export interface EstadoDeCuenta {
  profiles: ProfileRow[];
  plan: { nombre: 'prueba' | 'pro' | 'boveda'; limites: LimitesDePlan } | null;
  uso: { perfilesActivos: number; pasesAbiertos: number };
}

/**
 * Referencia a un medio dentro del contenido. Guarda un ID, no una clave de
 * almacenamiento: la clave la conoce solo el servidor, que es quien sabe de
 * quién es cada objeto.
 */
export interface MediaRef {
  mediaId: string;
  caption?: string;
}

/** Lo que el servidor sabe de un medio: dimensiones y tipo salen de los bytes. */
export interface MediaInfo {
  id: string;
  kind: 'image' | 'video' | 'doc';
  width: number | null;
  height: number | null;
  lqip: string | null;
}

/** Cómo se presentan las fotos de un bloque. Ausente = cuadrícula. */
export type Presentacion = 'cuadricula' | 'carrusel';

export type EditableSection =
  | { type: 'texto'; title?: string; body: string }
  | { type: 'galeria'; title?: string; items: MediaRef[]; display?: Presentacion }
  | { type: 'proyecto'; title?: string; body?: string; items: MediaRef[]; display?: Presentacion };

export interface ProfileContent {
  tagline?: string;
  intro?: string;
  sections: EditableSection[];
}

export interface ProfileDetail {
  id: string;
  displayName: string;
  brandColor: string | null;
  data: ProfileContent;
  /** Los medios del perfil, aparte del contenido, que solo guarda ids. */
  media: MediaInfo[];
  quota: { usados: number; total: number };
}

/** Cliente de la API del Worker. En local lo sirve el proxy de `ng serve`. */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  /** Abre (y consume) un pase. Lanza si el enlace ya no es válido. */
  open(token: string): Promise<PassView> {
    return firstValueFrom(this.http.get<PassView>(`/api/open/${encodeURIComponent(token)}`));
  }

  login(userId: string, password: string): Promise<Sesion> {
    return firstValueFrom(this.http.post<Sesion>('/api/panel/session', { userId, password }));
  }

  /** Recupera la sesión guardada al recargar, sin volver a pedir la contraseña. */
  me(token: string): Promise<{ user: Usuario }> {
    return firstValueFrom(
      this.http.get<{ user: Usuario }>('/api/panel/session', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  }

  /**
   * El cliente cambia su propia contraseña.
   *
   * Existe porque el administrador entrega una temporal y le dice que la
   * cambie: sin esto, esa instrucción no se puede cumplir.
   */
  cambiarPassword(
    session: string,
    actual: string,
    nueva: string,
  ): Promise<{ ok: boolean; sesionesCerradas: number }> {
    return firstValueFrom(
      this.http.put<{ ok: boolean; sesionesCerradas: number }>(
        '/api/panel/password',
        { actual, nueva },
        { headers: { authorization: `Bearer ${session}` } },
      ),
    );
  }

  /**
   * Pide que un administrador genere una contraseña nueva.
   *
   * No manda ningún correo: el sistema no guarda el de nadie. Deja una marca en
   * la cuenta y responde SIEMPRE lo mismo, exista o no, para que esto no sirva
   * de comprobador de usuarios.
   */
  claveOlvidada(userId: string): Promise<{ ok: boolean; mensaje: string }> {
    return firstValueFrom(
      this.http.post<{ ok: boolean; mensaje: string }>('/api/panel/password/olvidada', { userId }),
    );
  }

  logout(token: string): Promise<{ ok: boolean }> {
    return firstValueFrom(
      this.http.delete<{ ok: boolean }>('/api/panel/session', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  }

  profiles(session: string): Promise<EstadoDeCuenta> {
    return firstValueFrom(
      this.http.get<EstadoDeCuenta>('/api/profiles', {
        headers: { authorization: `Bearer ${session}` },
      }),
    );
  }

  /** Elige qué perfil queda activo. Si no hay hueco, intercambia por otro. */
  activarPerfil(session: string, id: string): Promise<{ ok: boolean }> {
    return firstValueFrom(
      this.http.post<{ ok: boolean }>(
        `/api/profiles/${encodeURIComponent(id)}/activar`,
        {},
        { headers: { authorization: `Bearer ${session}` } },
      ),
    );
  }

  createProfile(session: string, displayName: string): Promise<ProfileRow> {
    return firstValueFrom(
      this.http.post<ProfileRow>(
        '/api/profiles',
        { displayName },
        { headers: { authorization: `Bearer ${session}` } },
      ),
    );
  }

  /**
   * Borra un perfil. Inmediato e irreversible.
   *
   * `confirmacion` es el nombre del perfil tecleado por el cliente; el servidor
   * lo compara con el que tiene guardado y rechaza si no coincide.
   */
  borrarPerfil(session: string, id: string, confirmacion: string): Promise<{ ok: boolean }> {
    return firstValueFrom(
      this.http.delete<{ ok: boolean }>(`/api/profiles/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${session}` },
        body: { confirmacion },
      }),
    );
  }

  getProfile(session: string, id: string): Promise<ProfileDetail> {
    return firstValueFrom(
      this.http.get<ProfileDetail>(`/api/profiles/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${session}` },
      }),
    );
  }

  saveProfile(
    session: string,
    id: string,
    body: { displayName?: string; data: ProfileContent },
  ): Promise<{ ok: boolean }> {
    return firstValueFrom(
      this.http.put<{ ok: boolean }>(`/api/profiles/${encodeURIComponent(id)}`, body, {
        headers: { authorization: `Bearer ${session}` },
      }),
    );
  }

  /**
   * Sube un medio en dos pasos: primero se reserva y luego se mandan los bytes.
   *
   * La reserva es la que comprueba sesión, propiedad, tipo, tamaño y cuota, y
   * solo entonces firma la URL de subida. El segundo paso manda el archivo tal
   * cual (sin multipart: no hay más campos que mandar), y es donde el servidor
   * mira los bytes de verdad: si no son lo que dijimos, se rechaza ahí.
   */
  async uploadMedia(session: string, profileId: string, file: File): Promise<MediaInfo> {
    const auth = { authorization: `Bearer ${session}` };
    const kind = tipoDeArchivo(file);

    const reserva = await firstValueFrom(
      this.http.post<{ mediaId: string; uploadUrl: string }>(
        '/api/media/presign',
        { profileId, kind, bytes: file.size },
        { headers: auth },
      ),
    );

    return firstValueFrom(
      this.http.put<MediaInfo>(reserva.uploadUrl, file, {
        headers: { ...auth, 'content-type': file.type || 'application/octet-stream' },
      }),
    );
  }

  /**
   * Miniatura para el panel. El objeto solo se sirve con sesión, así que se pide
   * con la cabecera y se convierte en URL local; se cachea por id.
   */
  async preview(session: string, mediaId: string): Promise<string> {
    const cacheada = this.previews.get(mediaId);
    if (cacheada) return cacheada;
    const blob = await firstValueFrom(
      this.http.get(`/api/media/${encodeURIComponent(mediaId)}`, {
        headers: { authorization: `Bearer ${session}` },
        responseType: 'blob',
      }),
    );
    const url = URL.createObjectURL(blob);
    this.previews.set(mediaId, url);
    return url;
  }

  private readonly previews = new Map<string, string>();

  // --- facturación (cliente) -----------------------------------------------

  facturacion(session: string): Promise<EstadoFacturacion> {
    return firstValueFrom(
      this.http.get<EstadoFacturacion>('/api/billing', {
        headers: { authorization: `Bearer ${session}` },
      }),
    );
  }

  /** Pide un plan y devuelve el código que hay que poner en el concepto del pago. */
  solicitarPlan(
    session: string,
    plan: string,
    periodo: string,
  ): Promise<{ pago: Pago; pago_a: { bizum: string | null; paypal: string | null } }> {
    return firstValueFrom(
      this.http.post<{ pago: Pago; pago_a: { bizum: string | null; paypal: string | null } }>(
        '/api/billing/solicitar',
        { plan, periodo },
        { headers: { authorization: `Bearer ${session}` } },
      ),
    );
  }

  // --- administración ------------------------------------------------------
  //
  // Estas llamadas solo existen para una sesión con rol admin. A cualquier otra
  // el servidor le responde 404: desde fuera, este bloque de la API no existe.

  adminCuentas(session: string): Promise<{ cuentas: CuentaAdmin[]; planes: string[] }> {
    return firstValueFrom(
      this.http.get<{ cuentas: CuentaAdmin[]; planes: string[] }>('/api/admin/cuentas', {
        headers: { authorization: `Bearer ${session}` },
      }),
    );
  }

  adminCrearCuenta(
    session: string,
    body: { id: string; displayName: string; plan?: string },
  ): Promise<{ id: string; displayName: string; password: string }> {
    return firstValueFrom(
      this.http.post<{ id: string; displayName: string; password: string }>(
        '/api/admin/cuentas',
        body,
        { headers: { authorization: `Bearer ${session}` } },
      ),
    );
  }

  adminEditarCuenta(session: string, id: string, displayName: string): Promise<{ ok: boolean }> {
    return firstValueFrom(
      this.http.patch<{ ok: boolean }>(
        `/api/admin/cuentas/${encodeURIComponent(id)}`,
        { displayName },
        { headers: { authorization: `Bearer ${session}` } },
      ),
    );
  }

  adminPlan(session: string, id: string, plan: string): Promise<{ ok: boolean }> {
    return firstValueFrom(
      this.http.put<{ ok: boolean }>(
        `/api/admin/cuentas/${encodeURIComponent(id)}/plan`,
        { plan },
        { headers: { authorization: `Bearer ${session}` } },
      ),
    );
  }

  adminPassword(session: string, id: string): Promise<{ password: string }> {
    return firstValueFrom(
      this.http.post<{ password: string }>(
        `/api/admin/cuentas/${encodeURIComponent(id)}/password`,
        {},
        { headers: { authorization: `Bearer ${session}` } },
      ),
    );
  }

  /** Cierra la solicitud sin tocar la contraseña. */
  adminDescartarSolicitud(session: string, id: string): Promise<{ ok: boolean }> {
    return firstValueFrom(
      this.http.delete<{ ok: boolean }>(`/api/admin/cuentas/${encodeURIComponent(id)}/solicitud`, {
        headers: { authorization: `Bearer ${session}` },
      }),
    );
  }

  adminSuspension(session: string, id: string, suspender: boolean): Promise<{ ok: boolean }> {
    const accion = suspender ? 'suspender' : 'reactivar';
    return firstValueFrom(
      this.http.post<{ ok: boolean }>(
        `/api/admin/cuentas/${encodeURIComponent(id)}/${accion}`,
        {},
        { headers: { authorization: `Bearer ${session}` } },
      ),
    );
  }

  /** Borrado inmediato e irreversible. `confirmacion` debe ser el id tecleado. */
  adminBorrarCuenta(session: string, id: string, confirmacion: string): Promise<{ ok: boolean }> {
    return firstValueFrom(
      this.http.delete<{ ok: boolean }>(`/api/admin/cuentas/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${session}` },
        body: { confirmacion },
      }),
    );
  }

  adminPagos(session: string): Promise<{ pagos: Pago[] }> {
    return firstValueFrom(
      this.http.get<{ pagos: Pago[] }>('/api/admin/pagos', {
        headers: { authorization: `Bearer ${session}` },
      }),
    );
  }

  adminConfirmarPago(
    session: string,
    code: string,
    metodo: string,
    nota?: string,
  ): Promise<{ pago: Pago; planHasta: number }> {
    return firstValueFrom(
      this.http.post<{ pago: Pago; planHasta: number }>(
        `/api/admin/pagos/${encodeURIComponent(code)}/confirmar`,
        { metodo, nota },
        { headers: { authorization: `Bearer ${session}` } },
      ),
    );
  }

  adminAnularPago(session: string, code: string): Promise<{ ok: boolean }> {
    return firstValueFrom(
      this.http.post<{ ok: boolean }>(
        `/api/admin/pagos/${encodeURIComponent(code)}/anular`,
        {},
        { headers: { authorization: `Bearer ${session}` } },
      ),
    );
  }

  adminAuditoria(session: string): Promise<{ registros: RegistroAuditoria[] }> {
    return firstValueFrom(
      this.http.get<{ registros: RegistroAuditoria[] }>('/api/admin/auditoria', {
        headers: { authorization: `Bearer ${session}` },
      }),
    );
  }

  createPass(
    session: string,
    profileId: string,
    opciones: OpcionesDePase = {},
  ): Promise<{ url: string; expiresAt: number; modo: ModoDePase }> {
    return firstValueFrom(
      this.http.post<{ url: string; expiresAt: number; modo: ModoDePase }>(
        '/api/passes',
        { profileId, ...opciones },
        { headers: { authorization: `Bearer ${session}` } },
      ),
    );
  }

  listPasses(session: string, profileId: string): Promise<{ passes: PaseListado[] }> {
    return firstValueFrom(
      this.http.get<{ passes: PaseListado[] }>(`/api/passes?profileId=${profileId}`, {
        headers: { authorization: `Bearer ${session}` },
      }),
    );
  }
}

/**
 * De qué tipo es el archivo, según lo que dice el navegador.
 *
 * Sirve para elegir el hueco que se reserva, y para nada más: el servidor mira
 * los bytes y, si no coinciden con esto, rechaza la subida. Aquí no se está
 * validando nada, solo adivinando bien.
 */
function tipoDeArchivo(file: File): 'image' | 'video' | 'doc' {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type === 'application/pdf') return 'doc';
  return 'image';
}
