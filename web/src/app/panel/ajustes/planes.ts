import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EstadoCuenta } from '../estado/estado-cuenta';
import { NucleoPanel } from '../estado/nucleo';

/**
 * El plan y cómo se paga.
 *
 * No hay pasarela: se pide plan, sale un código `VISTTA-XXXXXX`, se pone en el
 * concepto de un Bizum o un PayPal y un administrador coteja el extracto. El
 * código NO es un secreto ni autoriza nada —viaja en el concepto de una
 * transferencia—: solo dice de quién es un ingreso ya visto.
 *
 * Las CIFRAS y los PRECIOS no se escriben aquí. Salen del catálogo que manda el
 * servidor, que los lee de `src/lib/planes.ts`.
 */
@Component({
  selector: 'app-planes',
  imports: [FormsModule],
  templateUrl: './planes.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Planes {
  protected readonly nucleo = inject(NucleoPanel);
  protected readonly cuenta = inject(EstadoCuenta);
}
