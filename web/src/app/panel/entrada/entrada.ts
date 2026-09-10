import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Marca } from '../../core/marca';
import { AccionesPanel } from '../estado/acciones-panel';
import { EstadoSesion } from '../estado/estado-sesion';
import { NucleoPanel } from '../estado/nucleo';

/**
 * La pantalla de entrada: usuario, contraseña y «he olvidado la mía».
 *
 * Es la única parte del panel que ve alguien sin sesión, y por eso está en su
 * propio componente: todo lo demás —perfiles, editor, medios, pases, ajustes—
 * da por hecho que hay sesión, y mezclarlo obligaba al panel entero a
 * defenderse de un caso que aquí ya no existe.
 *
 * Va SIEMPRE en oscuro, con la clase `paleta-oscura` que trae su propia
 * plantilla. Quien está aquí todavía no es nadie: la preferencia de aspecto se
 * guarda por dispositivo, así que en un ordenador compartido esta pantalla
 * cambiaría de color según quién pasó por última vez.
 */
@Component({
  selector: 'app-entrada-panel',
  imports: [FormsModule, RouterLink, Marca],
  templateUrl: './entrada.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntradaPanel {
  protected readonly nucleo = inject(NucleoPanel);
  protected readonly login = inject(EstadoSesion);
  protected readonly acciones = inject(AccionesPanel);
}
