import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface MediaItem {
  url: string;
  type?: 'image' | 'video' | 'doc';
  caption?: string;
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
}

export interface Sesion {
  token: string;
  expiresAt: number;
  user: Usuario;
}

export interface ProfileRow {
  id: string;
  displayName: string;
}

export interface MediaRef {
  key: string;
  type: 'image' | 'video' | 'doc';
  caption?: string;
}

export type EditableSection =
  | { type: 'texto'; title?: string; body: string }
  | { type: 'galeria'; title?: string; items: MediaRef[] }
  | { type: 'proyecto'; title?: string; body?: string; items: MediaRef[] };

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

  logout(token: string): Promise<{ ok: boolean }> {
    return firstValueFrom(
      this.http.delete<{ ok: boolean }>('/api/panel/session', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  }

  profiles(session: string): Promise<{ profiles: ProfileRow[] }> {
    return firstValueFrom(
      this.http.get<{ profiles: ProfileRow[] }>('/api/profiles', {
        headers: { authorization: `Bearer ${session}` },
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

  uploadMedia(session: string, profileId: string, file: File): Promise<MediaRef> {
    const form = new FormData();
    form.set('file', file);
    form.set('profileId', profileId);
    return firstValueFrom(
      this.http.post<MediaRef>('/api/media', form, {
        headers: { authorization: `Bearer ${session}` },
      }),
    );
  }

  /**
   * Miniatura para el panel. El objeto solo se sirve con sesión, así que se pide
   * con la cabecera y se convierte en URL local; se cachea por clave.
   */
  async preview(session: string, key: string): Promise<string> {
    const cacheada = this.previews.get(key);
    if (cacheada) return cacheada;
    const blob = await firstValueFrom(
      this.http.get(`/api/media/${key}`, {
        headers: { authorization: `Bearer ${session}` },
        responseType: 'blob',
      }),
    );
    const url = URL.createObjectURL(blob);
    this.previews.set(key, url);
    return url;
  }

  private readonly previews = new Map<string, string>();

  createPass(session: string, profileId: string): Promise<{ url: string; expiresAt: number }> {
    return firstValueFrom(
      this.http.post<{ url: string; expiresAt: number }>(
        '/api/passes',
        { profileId },
        { headers: { authorization: `Bearer ${session}` } },
      ),
    );
  }
}
