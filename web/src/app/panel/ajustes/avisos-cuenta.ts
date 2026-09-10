import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EstadoCuenta } from '../estado/estado-cuenta';
import { NucleoPanel } from '../estado/nucleo';

/**
 * Las cuentas atrás: cuándo se limpia el contenido y cuándo vence el plan.
 *
 * Solo aparecen si hay algo que contar. Y los días se redondean hacia ABAJO:
 * en avisos que existen para que nadie pierda su trabajo, redondear hacia
 * arriba regala un día que no existe y el cliente se confía justo el que no
 * debe.
 */
@Component({
  selector: 'app-avisos-cuenta',
  templateUrl: './avisos-cuenta.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AvisosCuenta {
  protected readonly nucleo = inject(NucleoPanel);
  protected readonly cuenta = inject(EstadoCuenta);
}
