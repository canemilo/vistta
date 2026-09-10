import { CdkDrag, CdkDragHandle, CdkDragPlaceholder, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { EditableSection } from '../../core/api';
import { EstadoPerfil } from '../estado/estado-perfil';
import { BloqueGaleria } from './bloque-galeria';
import { BloqueTexto } from './bloque-texto';

/**
 * Los bloques del dosier, en orden, y el botón de añadir.
 *
 * El orden y el tipo de bloque son toda la estructura que el cliente decide: el
 * diseño lo monta el viewer. Por eso aquí no hay ni un ajuste de aspecto que no
 * sea la presentación de las fotos, que sí cambia lo que se ve.
 *
 * Se reordena de DOS formas y las dos hacen falta. El arrastre (CDK) es lo
 * natural con ratón; los botones SUBIR y BAJAR son lo que funciona con teclado
 * y en un móvil, donde arrastrar dentro de una página que también se desplaza
 * es incómodo. Quitar los botones «porque ya se arrastra» dejaría fuera a quien
 * navega con teclado.
 */
@Component({
  selector: 'app-lista-secciones',
  imports: [BloqueTexto, BloqueGaleria, CdkDropList, CdkDrag, CdkDragHandle, CdkDragPlaceholder],
  templateUrl: './lista-secciones.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListaSecciones {
  protected readonly perfil = inject(EstadoPerfil);

  protected readonly TIPOS: EditableSection['type'][] = ['texto', 'proyecto', 'galeria'];

  protected readonly NOMBRE: Record<string, string> = {
    texto: 'Texto',
    galeria: 'Galería',
    proyecto: 'Proyecto',
  };

  /** Cuándo usar cada bloque. Es la diferencia que no se adivina del nombre. */
  protected readonly PARA_QUE: Record<string, string> = {
    texto: 'Solo palabras: una presentación, unas condiciones, una lista.',
    galeria: 'Solo fotos, sin texto. Para enseñar una serie seguida.',
    proyecto: 'Fotos y descripción juntas, para un trabajo concreto.',
  };

  /** El mismo tope que `SectionSchema` en el servidor. */
  protected readonly TOPE_TITULO = 160;

  /** Lo que se ve de un bloque encogido: cuánto lleva dentro. */
  protected resumen(seccion: EditableSection): string {
    if (seccion.type === 'texto') return this.enPalabras(seccion.body);
    const fotos = seccion.items.length;
    const cuenta = `${fotos} ${fotos === 1 ? 'foto' : 'fotos'}`;
    return seccion.type === 'galeria'
      ? cuenta
      : `${cuenta} · ${this.enPalabras(seccion.body ?? '')}`;
  }

  private enPalabras(texto: string): string {
    const palabras = texto.trim() ? texto.trim().split(/\s+/).length : 0;
    return palabras === 0 ? 'vacío' : `${palabras} ${palabras === 1 ? 'palabra' : 'palabras'}`;
  }

  /** Añade y DESPLIEGA el nuevo: lo que se acaba de crear es lo que se va a escribir. */
  protected anadir(tipo: EditableSection['type']): void {
    this.perfil.anadirSeccion(tipo);
    this.perfil.desplegado.set(this.perfil.contenido().sections.length - 1);
  }
}
