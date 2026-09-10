import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BotonTema } from '../../core/boton-tema';
import { Marca } from '../../core/marca';
import { AccionesPanel } from '../estado/acciones-panel';
import { EstadoCuenta } from '../estado/estado-cuenta';
import { EstadoPerfil } from '../estado/estado-perfil';

/**
 * La barra de arriba: quién eres, qué perfil tocas y qué puedes hacer.
 *
 * Ordenada por lo que se hace más veces, no por lo que es más fácil de colocar.
 * A la izquierda el CONTEXTO; a la derecha las ACCIONES, y de ellas solo dos a
 * la vista: ver como el cliente, que es a lo que se viene, y salir. El resto
 * vive en un desplegable, porque cambiar de plan o de contraseña se hace dos
 * veces al año y no merece ocupar sitio los otros trescientos sesenta y tres.
 */
@Component({
  selector: 'app-barra-panel',
  imports: [FormsModule, RouterLink, BotonTema, Marca],
  templateUrl: './barra-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarraPanel {
  protected readonly cuenta = inject(EstadoCuenta);
  protected readonly perfil = inject(EstadoPerfil);
  protected readonly acciones = inject(AccionesPanel);

  /**
   * «Ver como el cliente» sale por un `output` y no por el estado compartido, a
   * diferencia de todo lo demás: no es un dato de la aplicación, es qué
   * pantalla del panel se está mirando, y de eso manda el panel.
   */
  readonly verComoElCliente = output<void>();
}
