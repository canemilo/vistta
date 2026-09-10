import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Api,
  type EditableSection,
  type MediaRef,
  type ProfileContent,
  type ProfileDetail,
} from '../../core/api';
import type { DocSection } from '../../document/pass-document';
import { hayTextoDeEjemplo } from '../plantillas';
import { NucleoPanel } from './nucleo';

/**
 * El perfil que se está montando: su nombre, su logotipo, sus bloques y sus
 * fotos.
 *
 * Es el área grande, y la que de verdad justificaba partir el panel: aquí
 * conviven la edición de texto, el orden de los bloques y la subida de medios,
 * que son tres cosas distintas que antes compartían componente con la sesión y
 * la facturación.
 *
 * Sigue habiendo una regla que no cambia al mover el código: **en el contenido
 * solo va el `mediaId`**, nunca la clave de almacenamiento. Un medio existe
 * porque hay fila en `vistta.media` y la fila dice de qué perfil es; con claves
 * dentro del JSON, un usuario podía escribir la de otro y el backend la
 * firmaba.
 */
@Injectable({ providedIn: 'root' })
export class EstadoPerfil {
  private readonly api = inject(Api);
  private readonly nucleo = inject(NucleoPanel);

  readonly perfilId = signal('');
  readonly nombre = signal('');
  /** Logotipo del perfil, ya reducido por el servidor. Null si no hay. */
  readonly logo = signal<string | null>(null);
  readonly contenido = signal<ProfileContent>({ sections: [] });
  readonly miniaturas = signal<Record<string, string>>({});
  /** Cuota del perfil abierto. La devuelve `getProfile`; hasta hace poco se tiraba. */
  readonly cuotaPerfil = signal<{ usados: number; total: number }>({ usados: 0, total: 0 });

  /**
   * Si hay cambios que todavía no están en el servidor.
   *
   * Se dice en pantalla, y no es un adorno: hasta ahora, después de escribir no
   * había ninguna señal de si aquello se había guardado o no. La duda es cara
   * —se guarda otra vez «por si acaso», o peor, se cierra la pestaña creyendo
   * que sí— y sale gratis resolverla: cualquier cambio la enciende y guardar la
   * apaga.
   *
   * No hay guardado automático a propósito. Guardar publica: el pase que ya
   * mandaste enseña el perfil tal y como esté guardado, así que escribir a
   * medias no puede cambiarle el dosier a alguien que lo está mirando.
   */
  readonly sinGuardar = signal(false);

  /**
   * Qué bloque está desplegado. `null` es todos encogidos.
   *
   * UNO a la vez, y esa es la decisión que quita la sensación de caos: con
   * treinta bloques abiertos el editor era un formulario interminable donde no
   * se veía la estructura, que es justo lo que hay que ver para ordenarla.
   * Se guarda el ÍNDICE y no el objeto porque los bloques se reordenan y se
   * borran; el índice es lo que la lista entiende.
   */
  readonly desplegado = signal<number | null>(null);

  desplegar(i: number): void {
    this.desplegado.update((actual) => (actual === i ? null : i));
  }

  readonly totalFotos = computed(() =>
    this.contenido().sections.reduce((n, s) => n + ('items' in s ? s.items.length : 0), 0),
  );

  /**
   * ¿Queda algún «Describe aquí…» de la plantilla sin tocar?
   *
   * Avisa, NO bloquea. Bloquear sería decidir por el cliente en el único
   * momento en que tiene prisa —está a punto de mandar el enlace— y siempre hay
   * un caso legítimo: un dosier de tres fotos donde el texto sobra. Lo que no
   * puede pasar es mandarlo sin enterarse, porque lo que recibe el destinatario
   * son instrucciones para uno mismo con el membrete de tu marca encima.
   */
  readonly quedaRelleno = computed(() => hayTextoDeEjemplo(this.contenido()));

  /** El contenido en el formato que consume el documento del cliente. */
  readonly seccionesPrevia = computed<DocSection[]>(() =>
    this.contenido().sections.map((s) => ({
      type: s.type,
      title: s.title,
      body: 'body' in s ? s.body : undefined,
      // La vista previa tiene que enseñar la MISMA presentación que verá el
      // cliente; si no, se elige a ciegas.
      display: 'display' in s ? s.display : undefined,
      items:
        'items' in s
          ? s.items.map((it) => ({
              url: this.miniaturas()[it.mediaId] ?? '',
              caption: it.caption,
            }))
          : [],
    })),
  );

  /** Las dos formas de presentar fotos, con lo que las distingue de verdad. */
  readonly PRESENTACIONES = [
    {
      valor: 'cuadricula' as const,
      etiqueta: 'CUADRÍCULA',
      pista: 'Filas ordenadas. Recorta para que las celdas cuadren.',
    },
    {
      valor: 'carrusel' as const,
      etiqueta: 'CARRUSEL',
      pista: 'Tira horizontal. No recorta nada.',
    },
  ];

  /**
   * Abre un perfil para editarlo.
   *
   * El `try` no es decorativo y se puso después de ver el fallo: si esta llamada
   * reventaba —por ejemplo con la base sin migrar, que devuelve 500—, la
   * promesa se rechazaba sin que nadie la mirara y el panel se quedaba con el
   * editor vacío y sin decir nada. Desde fuera eso parece «no puedo entrar»,
   * cuando en realidad has entrado y lo que falla es cargar el contenido.
   *
   * Devuelve si ha podido: quien lo llama tiene que saber si vale la pena
   * seguir pidiendo cosas de este perfil —los enlaces, por ejemplo—.
   *
   * Las miniaturas van APARTE, en el método de abajo, y el orden entre las dos
   * lo decide quien coordina. No es reparto de responsabilidades por gusto: en
   * el panel entero, entre cargar el perfil y cargar sus miniaturas hay que
   * vaciar la lista de enlaces del perfil ANTERIOR, y si eso ocurriera después
   * quedaría a la vista, durante todo lo que tardan las miniaturas, la lista de
   * otro perfil bajo el nombre de este.
   */
  async cargar(id: string): Promise<boolean> {
    const sesion = this.nucleo.token();
    if (!sesion) return false;
    this.perfilId.set(id);
    this.nucleo.aviso.set('');
    this.nucleo.errorCarga.set('');
    // Al abrir otro perfil no queda nada pendiente ni nada desplegado: lo de la
    // pantalla anterior no es de este.
    this.sinGuardar.set(false);
    this.desplegado.set(null);

    let perfil: ProfileDetail;
    try {
      perfil = await this.api.getProfile(sesion, id);
    } catch {
      this.nucleo.errorCarga.set(
        'No se ha podido cargar este perfil. Si Vistta se acaba de actualizar, puede que falten migraciones de la base de datos.',
      );
      return false;
    }

    this.nombre.set(perfil.displayName);
    this.contenido.set({ ...perfil.data, sections: perfil.data.sections ?? [] });
    this.logo.set(perfil.logo ?? null);
    this.cuotaPerfil.set(perfil.quota ?? { usados: 0, total: 0 });
    return true;
  }

  async cargarMiniaturas(): Promise<void> {
    const sesion = this.nucleo.token();
    if (!sesion) return;
    const ids = this.contenido()
      .sections.flatMap((s) => ('items' in s ? s.items.map((i) => i.mediaId) : []))
      .filter((id) => !this.miniaturas()[id]);
    for (const mediaId of ids) {
      try {
        const url = await this.api.preview(sesion, mediaId);
        this.miniaturas.update((m) => ({ ...m, [mediaId]: url }));
      } catch {
        // Una foto que ya no está en el almacén no debe romper la edición.
      }
    }
  }

  actualizar(cambio: Partial<ProfileContent>): void {
    this.contenido.update((c) => ({ ...c, ...cambio }));
    this.tocado();
  }

  /**
   * Se ha cambiado algo del contenido.
   *
   * Lo llaman TODAS las ediciones, y por eso está en un solo sitio: si una se
   * olvidara de marcar que hay cambios sin guardar, el indicador diría
   * «Guardado» sobre algo que no lo está, que es peor que no tener indicador.
   */
  private tocado(): void {
    this.sinGuardar.set(true);
    this.nucleo.aviso.set('');
  }

  // --- bloques --------------------------------------------------------------

  presentacionDe(seccion: EditableSection): string {
    return 'display' in seccion && seccion.display ? seccion.display : 'cuadricula';
  }

  anadirSeccion(type: EditableSection['type']): void {
    const nueva: EditableSection =
      type === 'texto'
        ? { type, title: '', body: '' }
        : type === 'galeria'
          ? { type, title: '', items: [] }
          : { type, title: '', body: '', items: [] };
    this.contenido.update((c) => ({ ...c, sections: [...c.sections, nueva] }));
    this.tocado();
  }

  editarSeccion(i: number, cambio: Partial<EditableSection>): void {
    this.contenido.update((c) => ({
      ...c,
      sections: c.sections.map((s, idx) =>
        idx === i ? ({ ...s, ...cambio } as EditableSection) : s,
      ),
    }));
    this.tocado();
  }

  /** Sube o baja un bloque un puesto. Es el camino del teclado y el del móvil. */
  moverSeccion(i: number, salto: number): void {
    const destino = i + salto;
    let movido = false;
    this.contenido.update((c) => {
      if (destino < 0 || destino >= c.sections.length) return c;
      const sections = [...c.sections];
      [sections[i], sections[destino]] = [sections[destino], sections[i]];
      movido = true;
      return { ...c, sections };
    });
    if (!movido) return;
    /*
     * Lo desplegado SIGUE al bloque, no se queda en la posición.
     *
     * Con los botones se mueve el bloque que se está mirando, así que cerrarlo
     * —o peor, dejar abierto el que ha ocupado su sitio— haría que pulsar
     * «BAJAR» dos veces pareciera que el editor se ha vuelto loco.
     */
    this.desplegado.update((abierto) =>
      abierto === i ? destino : abierto === destino ? i : abierto,
    );
    this.tocado();
  }

  /**
   * Lleva un bloque de una posición a otra, de una vez.
   *
   * Es lo que necesita el arrastre, y no vale repetir `moverSeccion(±1)`: mover
   * cuatro puestos con cuatro intercambios pasa por tres órdenes intermedios
   * que nadie pidió, y el bloque desplegado acabaría en otro sitio.
   */
  reordenarSeccion(desde: number, hasta: number): void {
    this.contenido.update((c) => {
      if (desde === hasta || hasta < 0 || hasta >= c.sections.length) return c;
      const sections = [...c.sections];
      const [movido] = sections.splice(desde, 1);
      sections.splice(hasta, 0, movido);
      return { ...c, sections };
    });
    // Lo que estaba desplegado se cierra: su índice ya no señala a lo mismo.
    this.desplegado.set(null);
    this.tocado();
  }

  quitarSeccion(i: number): void {
    this.contenido.update((c) => ({ ...c, sections: c.sections.filter((_, idx) => idx !== i) }));
    this.tocado();
  }

  // --- fotos ----------------------------------------------------------------
  /*
   * Aquí solo queda lo que EDITA la lista de fotos. Subirlas vive en
   * `EstadoMedios`: mandar un archivo es una conversación con el servidor en
   * dos pasos y con sus propios modos de fallar —no es lo que dice ser, pasa
   * del límite por tipo, el perfil ya no tiene sitio—, y mezclarla con la
   * edición hacía que los tres acabaran bajo el mismo «no se pudo guardar».
   */

  itemsDe(i: number): MediaRef[] {
    const seccion = this.contenido().sections[i];
    return seccion && 'items' in seccion ? seccion.items : [];
  }

  editarFoto(i: number, j: number, caption: string): void {
    this.editarSeccion(i, {
      items: this.itemsDe(i).map((it, idx) => (idx === j ? { ...it, caption } : it)),
    });
  }

  quitarFoto(i: number, j: number): void {
    this.editarSeccion(i, { items: this.itemsDe(i).filter((_, idx) => idx !== j) });
  }

  // --- guardar --------------------------------------------------------------

  async guardar(): Promise<void> {
    const sesion = this.nucleo.token();
    if (!sesion) return;
    this.nucleo.ocupado.set(true);
    this.nucleo.error.set('');
    try {
      await this.api.saveProfile(sesion, this.perfilId(), {
        displayName: this.nombre(),
        data: this.contenido(),
      });
      this.sinGuardar.set(false);
      this.nucleo.aviso.set(`Guardado a las ${new Date().toTimeString().slice(0, 5)}`);
    } catch {
      this.nucleo.error.set('No se pudo guardar. Vuelve a entrar con el PIN.');
    } finally {
      this.nucleo.ocupado.set(false);
    }
  }

  /** Deja el editor sin perfil abierto. Lo usa la salida de sesión. */
  limpiar(): void {
    this.perfilId.set('');
    this.contenido.set({ sections: [] });
  }
}
