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
   * Las tres maquetas, con lo que las distingue de verdad.
   *
   * Nombradas por lo que SON y descritas por lo que hacen: «editorial» a secas
   * no le dice nada a quien va a elegir, que no es diseñador y está montando un
   * dosier para un cliente concreto. La frase de al lado es la que decide.
   *
   * Los VALORES no son los nombres. `compacto` se llama «Catálogo» desde que
   * dejó de ser un ajuste de densidad y pasó a ser una maqueta, pero el valor
   * guardado sigue siendo el de siempre: cambiarlo dejaría de validar los
   * perfiles que ya lo tienen escrito, y eso no se hace por un rótulo.
   */
  protected readonly ESTILOS: { valor: Estilo; etiqueta: string; pista: string }[] = [
    {
      valor: 'sobrio',
      etiqueta: 'Dosier',
      pista: 'Título al margen y rejilla ordenada. El de siempre.',
    },
    {
      valor: 'editorial',
      etiqueta: 'Editorial',
      pista: 'Una columna, apartados numerados y fotos grandes sin marco.',
    },
    {
      valor: 'compacto',
      etiqueta: 'Catálogo',
      pista: 'Las fotos primero, muchas y apretadas; el texto debajo.',
    },
  ];

  /** Ausente es `sobrio`: el contenido anterior a este campo sigue siendo válido. */
  protected readonly estiloActual = computed<Estilo>(
    () => this.perfil.contenido().estilo ?? 'sobrio',
  );
}
