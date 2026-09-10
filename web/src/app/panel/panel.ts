import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PassDocument } from '../document/pass-document';
import { AvisosCuenta } from './ajustes/avisos-cuenta';
import { MiCuenta } from './ajustes/mi-cuenta';
import { Planes } from './ajustes/planes';
import { BarraPanel } from './cabecera/barra-panel';
import { EditorCabecera } from './editor/editor-cabecera';
import { ListaSecciones } from './editor/lista-secciones';
import { EntradaPanel } from './entrada/entrada';
import { FichaInmueble } from '../inmobiliaria/ficha-inmueble';
import { AccionesPanel } from './estado/acciones-panel';
import { EstadoPases } from './estado/estado-pases';
import { EstadoPerfil } from './estado/estado-perfil';
import { NucleoPanel } from './estado/nucleo';
import { GenerarPase } from './pases/generar-pase';
import { ListaPases } from './pases/lista-pases';
import { BorrarPerfil } from './perfiles/borrar-perfil';
import { NuevoPerfil } from './perfiles/nuevo-perfil';
import { PerfilesCongelados } from './perfiles/perfiles-congelados';

/**
 * El panel del cliente: entrar, montar el contenido y generar el enlace.
 *
 * Este archivo era de 1.000 líneas y su plantilla de 1.600, y ahí dentro
 * convivían la sesión, la lista de perfiles, la edición, los medios, los pases
 * y los ajustes. No era solo incómodo de tocar: era la razón de que la pantalla
 * enseñara demasiadas cosas a la vez, porque nada obligaba a decidir qué iba
 * junto con qué.
 *
 * Lo que queda aquí es el ARMAZÓN y una sola decisión: si se está mirando la
 * entrada, la vista previa o el panel. Todo lo demás son componentes bajo
 * `entrada/`, `cabecera/`, `perfiles/`, `editor/`, `pases/` y `ajustes/`, y
 * todo el estado vive en `estado/`, repartido en cuatro áreas más un
 * coordinador para lo que las cruza.
 *
 * Las tres señales que se inyectan aquí son las que usa la plantilla de este
 * archivo, y nada más: `nucleo` para saber si hay sesión, `perfil` y `pases`
 * para la vista previa, `acciones` para el botón de crear el primer perfil.
 */
@Component({
  selector: 'app-panel',
  imports: [
    RouterLink,
    PassDocument,
    EntradaPanel,
    BarraPanel,
    NuevoPerfil,
    PerfilesCongelados,
    BorrarPerfil,
    AvisosCuenta,
    MiCuenta,
    Planes,
    EditorCabecera,
    FichaInmueble,
    ListaSecciones,
    GenerarPase,
    ListaPases,
  ],
  templateUrl: './panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class Panel {
  protected readonly nucleo = inject(NucleoPanel);
  protected readonly perfil = inject(EstadoPerfil);
  protected readonly pases = inject(EstadoPases);
  protected readonly acciones = inject(AccionesPanel);

  /**
   * Si se está mirando el dosier como lo verá el cliente.
   *
   * Vive en el componente y no en el estado compartido, y es la única señal que
   * se queda aquí: no es un dato de la aplicación —no se guarda, no viaja, no
   * lo sabe el servidor—, es qué pantalla del panel se está mirando.
   */
  protected readonly vistaPrevia = signal(false);

  constructor() {
    void this.acciones.retomarSesion();
  }
}
