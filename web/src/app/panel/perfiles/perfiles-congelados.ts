import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AccionesPanel } from '../estado/acciones-panel';
import { EstadoCuenta } from '../estado/estado-cuenta';
import { NucleoPanel } from '../estado/nucleo';

/**
 * Los perfiles congelados, con su cuenta atrás.
 *
 * Pasarse de un límite no borra nada por sorpresa: lo que sobra se congela, es
 * reversible y el cliente elige qué deja activo. Esta lista existe para que esa
 * elección sea posible; sin ella, congelar sería indistinguible de borrar.
 */
@Component({
  selector: 'app-perfiles-congelados',
  templateUrl: './perfiles-congelados.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PerfilesCongelados {
  protected readonly nucleo = inject(NucleoPanel);
  protected readonly cuenta = inject(EstadoCuenta);
  protected readonly acciones = inject(AccionesPanel);
}
