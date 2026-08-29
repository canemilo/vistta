import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface MediaItem {
  url: string;
  type: 'image' | 'video' | 'doc';
  caption?: string;
}

export interface PassView {
  profile: { id: string; displayName: string; brandColor: string | null; data: unknown };
  media: MediaItem[];
  watermark: string;
}

export interface ProfileRow {
  id: string;
  displayName: string;
}

/** Cliente de la API del Worker. En local lo sirve el proxy de `ng serve`. */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  /** Abre (y consume) un pase. Lanza si el enlace ya no es válido. */
  open(token: string): Promise<PassView> {
    return firstValueFrom(this.http.get<PassView>(`/api/open/${encodeURIComponent(token)}`));
  }

  login(pin: string): Promise<{ token: string; expiresAt: number }> {
    return firstValueFrom(
      this.http.post<{ token: string; expiresAt: number }>('/api/panel/session', { pin }),
    );
  }

  profiles(session: string): Promise<{ profiles: ProfileRow[] }> {
    return firstValueFrom(
      this.http.get<{ profiles: ProfileRow[] }>('/api/profiles', {
        headers: { authorization: `Bearer ${session}` },
      }),
    );
  }

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
