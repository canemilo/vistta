import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccionesPanel } from '../estado/acciones-panel';
import { EstadoCuenta } from '../estado/estado-cuenta';
import { NucleoPanel } from '../estado/nucleo';
import { PLANTILLAS } from '../plantillas';

/**
 * Crear un perfil: cómo se llama y de qué se parte.
 *
 * La elección de plantilla es lo que hace que este componente exista. Antes
 * aquí solo había un campo de texto y un botón, y lo que salía era un lienzo
 * vacío: quien lo creaba tenía que decidir a la vez qué apartados hacer, en qué
 * orden, qué escribir y cómo enseñar las fotos.
 */
@Component({
  selector: 'app-nuevo-perfil',
  imports: [FormsModule],
  templateUrl: './nuevo-perfil.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NuevoPerfil {
  protected readonly nucleo = inject(NucleoPanel);
  protected readonly cuenta = inject(EstadoCuenta);
  protected readonly acciones = inject(AccionesPanel);

  protected readonly PLANTILLAS = PLANTILLAS;

  /** Cómo se llama cada tipo de bloque cuando hay que decirlo con palabras. */
  protected readonly NOMBRE_DE_BLOQUE: Record<string, string> = {
    texto: 'Texto',
    galeria: 'Galería',
    proyecto: 'Proyecto',
  };
}
