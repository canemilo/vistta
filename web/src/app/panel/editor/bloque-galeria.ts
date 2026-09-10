import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { EditableSection } from '../../core/api';
import { EstadoMedios } from '../estado/estado-medios';
import { EstadoPerfil } from '../estado/estado-perfil';

/**
 * Las fotos de un bloque, y cómo se presentan.
 *
 * Las llevan `galeria` y `proyecto`, y el propio componente decide si se pinta
 * (ver `bloque-texto` para por qué se reparte por capacidad y no por tipo).
 *
 * La presentación se elige AQUÍ, junto a las fotos que afecta, y no en un
 * ajuste general del perfil: la decisión es distinta para cada bloque —una
 * serie de verticales pide carrusel y una selección de apaisadas pide
 * cuadrícula— y verla al lado de lo que cambia evita tener que recordar cuál
 * era cuál.
 *
 * En el contenido solo va el `mediaId`, nunca la clave de almacenamiento: con
 * claves dentro del JSON, un usuario podía escribir la de otro y el backend la
 * firmaba.
 */
@Component({
  selector: 'app-bloque-galeria',
  templateUrl: './bloque-galeria.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BloqueGaleria {
  protected readonly perfil = inject(EstadoPerfil);
  protected readonly medios = inject(EstadoMedios);

  readonly si = input.required<number>();
  readonly seccion = input.required<EditableSection>();

  /** El mismo tope que aplica el servidor en `SectionSchema`. */
  protected readonly TOPE_FOTOS = 60;
}
