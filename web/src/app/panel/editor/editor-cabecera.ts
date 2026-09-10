import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { Estilo } from '../../core/api';
import { EstadoMedios } from '../estado/estado-medios';
import { EstadoPerfil } from '../estado/estado-perfil';
import { NucleoPanel } from '../estado/nucleo';

/**
 * La cabecera del dosier: nombre, logotipo, la línea de arriba y la entradilla.
 *
 * Es lo que verá primero quien abra el enlace, y por eso va antes que los
 * bloques en la pantalla. El logotipo lo reduce el SERVIDOR y no el navegador:
 * reducirlo aquí daría un resultado distinto según el equipo, y lo que hay que
 * creerse es lo que guarda el servidor, no lo que dice el cliente que subió.
 */
@Component({
  selector: 'app-editor-cabecera',
  templateUrl: './editor-cabecera.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditorCabecera {
  protected readonly nucleo = inject(NucleoPanel);
  protected readonly perfil = inject(EstadoPerfil);
  protected readonly medios = inject(EstadoMedios);

  /**
   * Los tres estilos, con lo que los distingue de verdad.
   *
   * Nombrados por lo que HACEN y no por un adjetivo de diseño: «editorial» sin
   * la frase de al lado no le dice nada a quien va a elegir, que no es
   * diseñador y está montando un dosier para un cliente concreto.
   */
  protected readonly ESTILOS: { valor: Estilo; etiqueta: string; pista: string }[] = [
    { valor: 'sobrio', etiqueta: 'Sobrio', pista: 'El de siempre. Equilibrado.' },
    { valor: 'editorial', etiqueta: 'Editorial', pista: 'Más aire y letra mayor, para leer.' },
    { valor: 'compacto', etiqueta: 'Compacto', pista: 'Más piezas a la vista, para hojear.' },
  ];

  /** Ausente es `sobrio`: el contenido anterior a este campo sigue siendo válido. */
  protected readonly estiloActual = computed<Estilo>(
    () => this.perfil.contenido().estilo ?? 'sobrio',
  );
}
