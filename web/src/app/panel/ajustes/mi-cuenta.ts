import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EstadoCuenta } from '../estado/estado-cuenta';
import { EstadoMedios } from '../estado/estado-medios';
import { EstadoPerfil } from '../estado/estado-perfil';
import { NucleoPanel } from '../estado/nucleo';

/**
 * La ficha de la cuenta y el cambio de contraseña.
 *
 * No hay alta pública ni recuperación por correo, y no es un olvido: las
 * cuentas las crea un administrador y no se guarda el correo de nadie. Lo que
 * sí existe es cambiar la contraseña temporal, y eso exige la actual y cierra
 * las demás sesiones.
 */
@Component({
  selector: 'app-mi-cuenta',
  imports: [FormsModule],
  templateUrl: './mi-cuenta.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiCuenta {
  protected readonly nucleo = inject(NucleoPanel);
  protected readonly cuenta = inject(EstadoCuenta);
  protected readonly perfil = inject(EstadoPerfil);
  protected readonly medios = inject(EstadoMedios);
}
