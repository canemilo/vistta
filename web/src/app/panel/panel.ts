import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, type ProfileRow } from '../core/api';

/** Panel de gestión: entrar con PIN y generar enlaces de un solo uso. */
@Component({
  selector: 'app-panel',
  imports: [FormsModule],
  templateUrl: './panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      width: 100%;
    }
  `,
})
export class Panel {
  private readonly api = inject(Api);

  protected pin = '';
  protected readonly sesion = signal<string | null>(null);
  protected readonly perfiles = signal<ProfileRow[]>([]);
  protected readonly perfilId = signal('');
  protected readonly enlace = signal('');
  protected readonly error = signal('');
  protected readonly ocupado = signal(false);
  protected readonly copiado = signal(false);

  protected async entrar(): Promise<void> {
    this.error.set('');
    this.ocupado.set(true);
    try {
      const { token } = await this.api.login(this.pin);
      this.sesion.set(token);
      this.pin = '';
      const { profiles } = await this.api.profiles(token);
      this.perfiles.set(profiles);
      this.perfilId.set(profiles[0]?.id ?? '');
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      this.error.set(status === 429 ? 'Demasiados intentos. Espera un rato.' : 'PIN incorrecto.');
    } finally {
      this.ocupado.set(false);
    }
  }

  protected async generar(): Promise<void> {
    const sesion = this.sesion();
    if (!sesion || !this.perfilId()) return;
    this.error.set('');
    this.ocupado.set(true);
    this.copiado.set(false);
    try {
      const { url } = await this.api.createPass(sesion, this.perfilId());
      // El Worker lo compone sobre BASE_URL, que apunta al origen del viewer.
      this.enlace.set(url);
    } catch {
      this.error.set('No se pudo generar el enlace. ¿Sigue viva la sesión?');
    } finally {
      this.ocupado.set(false);
    }
  }

  protected async copiar(): Promise<void> {
    await navigator.clipboard.writeText(this.enlace());
    this.copiado.set(true);
  }
}
