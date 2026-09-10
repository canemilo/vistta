import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EstadoPases } from '../estado/estado-pases';

/**
 * Los enlaces ya generados de este perfil, con su estado real y su lectura.
 *
 * Limpiar solo se lleva los CERRADOS: uno todavía abrible está en manos de otra
 * persona —ya se lo mandaste—, así que no puede desaparecer desde un botón que
 * dice «limpiar».
 *
 * Y lo que se enseña de la lectura va redondeado: «unos 4 minutos» es lo que
 * hace falta para decidir si llamar. «4 min 12 s» sugiere una vigilancia que ni
 * es exacta —el navegador mide a ojo— ni es sana enseñar de nadie.
 */
@Component({
  selector: 'app-lista-pases',
  templateUrl: './lista-pases.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListaPases {
  protected readonly pases = inject(EstadoPases);
}
