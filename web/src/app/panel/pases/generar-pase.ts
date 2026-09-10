import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EstadoPases } from '../estado/estado-pases';
import { EstadoPerfil } from '../estado/estado-perfil';
import { NucleoPanel } from '../estado/nucleo';

/**
 * Guardar, y generar el enlace con sus condiciones.
 *
 * Aquí se toca el invariante del producto, así que las decisiones no son de
 * interfaz: `unico` viene elegido porque es lo único que Vistta promete, los
 * modos que se ofrecen salen del PLAN y no de una lista escrita aquí, y el
 * aviso de «queda texto de ejemplo» avisa sin bloquear.
 */
@Component({
  selector: 'app-generar-pase',
  imports: [FormsModule],
  templateUrl: './generar-pase.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GenerarPase {
  protected readonly nucleo = inject(NucleoPanel);
  protected readonly perfil = inject(EstadoPerfil);
  protected readonly pases = inject(EstadoPases);
}
