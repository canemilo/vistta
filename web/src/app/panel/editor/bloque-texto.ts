import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { EditableSection } from '../../core/api';
import { EstadoPerfil } from '../estado/estado-perfil';

/**
 * El cuerpo de un bloque: el texto que se lee.
 *
 * Lo llevan `texto` y `proyecto`, y el propio componente decide si se pinta.
 * Por CAPACIDAD y no por tipo de bloque: `proyecto` tiene cuerpo Y fotos, así
 * que un componente por tipo obligaría a que el de proyecto fuera una copia de
 * este pegada a una copia del de galería, y la siguiente corrección se haría en
 * una de las tres.
 *
 * El índice llega por `input` y no por el servicio, y es la excepción a la
 * regla del estado compartido: qué posición ocupa este bloque dentro del bucle
 * es información de la VISTA, no de la aplicación. En el servicio habría que
 * mantenerla sincronizada con el orden real a mano.
 */
@Component({
  selector: 'app-bloque-texto',
  templateUrl: './bloque-texto.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BloqueTexto {
  protected readonly perfil = inject(EstadoPerfil);

  readonly si = input.required<number>();
  readonly seccion = input.required<EditableSection>();

  /** El mismo tope que aplica el servidor en `SectionSchema`. */
  protected readonly TOPE = 5000;

  protected readonly escrito = computed(() => {
    const s = this.seccion();
    return 'body' in s ? (s.body ?? '').length : 0;
  });
}
