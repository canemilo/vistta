import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, type FichaDePropiedad } from '../core/api';
import { CLAVE_SESION } from '../core/sesion';

/**
 * La ficha del inmueble: referencia, exclusiva y nota privada.
 *
 * UN componente y dos pantallas. Vivía dentro del informe, que es donde se
 * inventó, y ahí se quedó: para anotar algo de un inmueble había que pasar por
 * una pantalla de actividad que puede estar vacía —un dosier recién montado no
 * tiene lecturas que enseñar—. Ahora también está en el panel, junto al dosier
 * que describe.
 *
 * Copiar el formulario habría sido más rápido y peor: son dos sitios donde
 * corregir el mismo fallo, y esta pantalla ya tuvo uno.
 *
 * La sesión se lee de `sessionStorage` y no se inyecta: así el componente sirve
 * igual dentro del panel —que tiene su propio estado— y dentro del informe, que
 * no lo tiene. Es la misma clave que escribe la entrada al panel.
 */
@Component({
  selector: 'app-ficha-inmueble',
  imports: [FormsModule],
  templateUrl: './ficha-inmueble.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FichaInmueble {
  private readonly api = inject(Api);

  /** De qué dosier es la ficha. Cambiar de perfil recarga la que toca. */
  readonly profileId = input.required<string>();

  /**
   * Se ha guardado. Lo escucha quien tenga algo que refrescar: el informe pinta
   * la referencia en la cabecera del papel y el panel la enseña en el selector
   * de perfiles, así que los dos se quedarían con la vieja.
   */
  readonly guardada = output<FichaDePropiedad | null>();

  /*
   * SEÑALES, y no campos llanos con `[(ngModel)]`.
   *
   * Lo cazó una prueba: al cambiar de dosier en el panel, el formulario seguía
   * enseñando la referencia del anterior. La aplicación va sin zona, así que
   * Angular repinta al despachar un evento de plantilla pero NO al volver de
   * una petición; y estos tres campos se escriben justo ahí, al terminar la
   * carga. En el informe no se notaba porque la pantalla entera se recreaba al
   * cargar, que era otro fallo y tapaba este.
   */
  protected readonly referencia = signal('');
  protected readonly exclusivaDesde = signal('');
  protected readonly propietarioNota = signal('');

  protected readonly guardando = signal(false);
  protected readonly guardado = signal('');
  protected readonly error = signal('');

  constructor() {
    // Al cambiar de perfil se trae la suya. Sin esto, al cambiar de dosier en
    // el panel se quedaría a la vista la ficha del anterior, que es peor que no
    // enseñar ninguna: parece que ese inmueble tiene esos datos.
    effect(() => {
      const id = this.profileId();
      if (id) void this.cargar(id);
    });
  }

  private async cargar(profileId: string): Promise<void> {
    const sesion = sessionStorage.getItem(CLAVE_SESION);
    if (!sesion) return;
    this.guardado.set('');
    this.error.set('');
    try {
      const { ficha } = await this.api.fichaDePropiedad(sesion, profileId);
      this.referencia.set(ficha?.referencia ?? '');
      this.propietarioNota.set(ficha?.propietarioNota ?? '');
      this.exclusivaDesde.set(enFechaDeCampo(ficha?.exclusivaDesde ?? null));
    } catch {
      // Sin ficha no se rompe nada: el formulario queda vacío y se puede
      // escribir. Un aviso aquí sería alarmar por un dato que quizá no existe.
      this.referencia.set('');
      this.propietarioNota.set('');
      this.exclusivaDesde.set('');
    }
  }

  protected async guardar(): Promise<void> {
    const sesion = sessionStorage.getItem(CLAVE_SESION);
    if (!sesion) return;
    this.guardando.set(true);
    this.guardado.set('');
    this.error.set('');
    try {
      const { ficha } = await this.api.guardarFicha(sesion, this.profileId(), {
        referencia: this.referencia().trim() || null,
        propietarioNota: this.propietarioNota().trim() || null,
        exclusivaDesde: deFechaDeCampo(this.exclusivaDesde()),
      });
      this.guardado.set('Ficha guardada.');
      this.guardada.emit(ficha);
    } catch {
      this.error.set('No se ha podido guardar la ficha. Vuelve a intentarlo.');
    } finally {
      this.guardando.set(false);
    }
  }
}

/** Milisegundos a `aaaa-mm-dd`, que es lo que entiende un `input[type=date]`. */
function enFechaDeCampo(ts: number | null): string {
  if (ts === null) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Y la vuelta. Vacío es `null`: borrar la fecha tiene que ser posible. */
function deFechaDeCampo(valor: string): number | null {
  if (!valor) return null;
  const ts = Date.parse(`${valor}T00:00:00`);
  return Number.isNaN(ts) ? null : ts;
}
