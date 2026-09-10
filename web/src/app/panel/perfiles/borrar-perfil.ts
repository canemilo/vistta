import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccionesPanel } from '../estado/acciones-panel';
import { EstadoPerfil } from '../estado/estado-perfil';
import { NucleoPanel } from '../estado/nucleo';

/**
 * Borrar el perfil abierto.
 *
 * Va al final, separado y en rojo: lo destructivo tiene que parecerlo. Y exige
 * teclear el nombre, como el borrado de cuenta exige teclear el identificador.
 * El aviso dice las dos consecuencias que no se ven: que se va el contenido y
 * que los enlaces ya enviados dejan de abrirse.
 */
@Component({
  selector: 'app-borrar-perfil',
  imports: [FormsModule],
  templateUrl: './borrar-perfil.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BorrarPerfil {
  protected readonly nucleo = inject(NucleoPanel);
  protected readonly perfil = inject(EstadoPerfil);
  protected readonly acciones = inject(AccionesPanel);
}
