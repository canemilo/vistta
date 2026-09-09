import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { BotonTema } from './boton-tema';
import { Marca } from './marca';

/**
 * La barra de arriba de las pantallas del panel.
 *
 * TRES DECISIONES:
 *
 * 1. **Se queda fija.** Estas pantallas son largas —una lista de enlaces, una
 *    tabla comparativa— y una barra que se va con el scroll obliga a subir del
 *    todo para cambiar de sitio.
 *
 * 2. **Navega, no retrocede.** Antes cada pantalla tenía su «← Volver al
 *    panel», que es el botón de atrás del navegador pintado a mano: solo
 *    deshace el último paso y no dice a dónde más se puede ir. En su sitio van
 *    los destinos de verdad, con el actual marcado.
 *
 * 3. **El hilo.** Es el único adorno de la barra y no es adorno: es la estela
 *    de la marca —el azul→verde que ya lleva el logotipo— sacada del SVG y
 *    estirada por la interfaz. Aparece dos veces y las dos veces dice algo: una
 *    hairline recorre el borde inferior y marca dónde acaba la barra, y un
 *    trazo corto se posa bajo la sección en la que estás. No hay pastillas, ni
 *    cajas, ni fondos de color: quien mira sigue el hilo.
 *
 *    El degradado se construye con TOKENS, no con hexadecimales, así que cambia
 *    solo entre el tema claro y el oscuro como todo lo demás.
 *
 * La tipografía NO cambia: `body` va en mono en toda la aplicación, y aquí eso
 * no es una etiqueta de dato, es la cara del producto. Lo que sí se quita es el
 * grito: la navegación va en caja baja y con el espaciado justo, para que se
 * lea como navegación y no como un galón más.
 *
 * Vive en `core/` porque son tres pantallas, y tres copias de una barra de
 * navegación es una que alguien cambia y dos que se quedan viejas.
 */
@Component({
  selector: 'app-cabecera-panel',
  imports: [RouterLink, RouterLinkActive, BotonTema, Marca],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="sticky top-0 z-30 border-b border-borde bg-sup/85 backdrop-blur-md">
      <div
        class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-3"
      >
        <div class="flex items-center gap-5">
          <a
            routerLink="/panel"
            class="flex items-center rounded-sm text-titulo transition-colors hover:text-acento focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-acento"
          >
            <app-marca [alto]="26" />
            <span class="sr-only">Ir a tus dosieres</span>
          </a>

          <nav aria-label="Secciones del panel">
            <ul class="flex flex-wrap items-center gap-x-5 gap-y-1">
              @for (enlace of enlaces; track enlace.ruta) {
                <li>
                  <a
                    [routerLink]="enlace.ruta"
                    routerLinkActive="text-texto"
                    [routerLinkActiveOptions]="{ exact: enlace.exacto }"
                    #activo="routerLinkActive"
                    [attr.aria-current]="activo.isActive ? 'page' : null"
                    class="relative block rounded-sm py-1 text-[13px] text-texto-3 transition-colors hover:text-texto focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-acento"
                  >
                    {{ enlace.texto }}
                    <!--
                      El hilo se posa donde estás. Solo en el enlace activo: un
                      subrayado en todos no marcaría nada.
                    -->
                    @if (activo.isActive) {
                      <span
                        class="hilo absolute -bottom-0.5 left-0 h-0.5 w-full"
                        aria-hidden="true"
                      ></span>
                    }
                  </a>
                </li>
              }
            </ul>
          </nav>
        </div>

        <div class="flex items-center gap-5">
          @if (titulo()) {
            <span class="text-[13px] text-texto-3">{{ titulo() }}</span>
          }
          <app-boton-tema />
        </div>
      </div>

      <!-- La estela, a lo largo del borde. Se apaga hacia los extremos para que
           la barra no acabe en un corte seco contra el ancho de la pantalla. -->
      <span class="hilo absolute inset-x-0 -bottom-px h-px opacity-70" aria-hidden="true"></span>
    </header>
  `,
  styles: `
    :host {
      display: block;
    }

    /*
     * La estela de la marca, en tokens.
     *
     * Los mismos colores que el logotipo lleva dentro —el azul del nodo y los
     * dos verdes—, pero por variable: así el tema oscuro la reasigna sola y no
     * hay un hexadecimal escrito a mano en ninguna plantilla, que es la regla
     * de este proyecto desde que el contraste se mide.
     */
    .hilo {
      background-image: linear-gradient(
        90deg,
        transparent 0%,
        var(--color-acento-2) 18%,
        var(--color-acento-tenue) 52%,
        var(--color-acento) 84%,
        transparent 100%
      );
    }

    /* El informe se imprime y se entrega. La barra del panel no pinta ahí. */
    @media print {
      :host {
        display: none !important;
      }
    }
  `,
})
export class CabeceraPanel {
  /** Dónde estás, cuando la pantalla no sale en la navegación (el informe). */
  readonly titulo = input('');

  protected readonly enlaces = [
    { ruta: '/panel', texto: 'Dosieres', exacto: true },
    { ruta: '/panel/actividad', texto: 'Actividad', exacto: false },
    { ruta: '/panel/integracion', texto: 'Tu CRM', exacto: false },
  ];
}
