import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * La marca de Vistta, en línea y no como <img>.
 *
 * En línea a propósito: así la palabra puede ir con `fill="currentColor"` y
 * hereda el color del texto de donde esté. Un solo archivo sirve para los dos
 * temas —clara sobre fondo oscuro, negra sobre fondo claro— sin placas ni
 * variantes que mantener por separado. Con `<img>` esto no se puede: un archivo
 * externo no hereda el color de quien lo pinta.
 *
 * Los dos acentos verdes NO heredan: son la marca y valen igual en los dos
 * fondos.
 */
@Component({
  selector: 'app-marca',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.viewBox]="'0 0 430 170'"
      [attr.height]="alto()"
      role="img"
      aria-label="Vistta"
      class="w-auto"
      style="height: 1em"
    >
      <title>Vistta</title>
      <defs>
        <linearGradient [attr.id]="'marca-nodo'" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#14532d" />
          <stop offset="0.5" stop-color="#1f7a45" />
          <stop offset="0.5" stop-color="#4ade80" />
          <stop offset="1" stop-color="#22c55e" />
        </linearGradient>
        <linearGradient [attr.id]="'marca-estela'" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#4ade80" />
          <stop offset="0.55" stop-color="#22c55e" />
          <stop offset="1" stop-color="#15803d" />
        </linearGradient>
      </defs>

      <!-- «vıstta», sin punto en la i: lo pone el nodo. Hereda el color. -->
      <text
        x="20"
        y="132"
        font-family="'Poppins','Montserrat','Avenir Next','Century Gothic','Futura','Nunito Sans',system-ui,sans-serif"
        font-size="140"
        font-weight="600"
        letter-spacing="-4"
        fill="currentColor"
      >
        vıstta
      </text>

      <!-- La estela final y el nodo sobre la i: los dos acentos de la marca. -->
      <path d="M352 132 L392 30 L420 30 L380 132 Z" fill="url(#marca-estela)" />
      <circle cx="128" cy="44" r="17" fill="url(#marca-nodo)" />
    </svg>
  `,
})
export class Marca {
  /** Alto en píxeles. El ancho sale solo del viewBox. */
  readonly alto = input(40);
}
