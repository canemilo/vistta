import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TemaApp } from './tema';

/**
 * El botón del tema. Un solo control que rota entre los tres estados.
 *
 * Se eligió rotar y no desplegar un menú porque son tres opciones y la de en
 * medio es la que casi nadie toca. Lo que NO se puede hacer es esconder cuál
 * está puesto: el texto lo dice, y por eso el botón lleva `aria-label` con el
 * estado actual y no solo un icono.
 */
@Component({
  selector: 'app-boton-tema',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      (click)="tema.siguiente()"
      [attr.aria-label]="'Aspecto: ' + etiqueta() + '. Pulsa para cambiar.'"
      [title]="'Aspecto: ' + etiqueta()"
      class="inline-flex items-center gap-2 rounded-lg border border-borde px-3 py-1.5 font-mono text-[11px] tracking-[0.18em] text-texto-3 uppercase hover:border-acento/60 hover:text-acento"
    >
      <span aria-hidden="true">{{ icono() }}</span>
      {{ etiqueta() }}
    </button>
  `,
})
export class BotonTema {
  protected readonly tema = inject(TemaApp);

  protected etiqueta(): string {
    return { sistema: 'sistema', claro: 'claro', oscuro: 'oscuro' }[this.tema.tema()];
  }

  protected icono(): string {
    return { sistema: '◐', claro: '☀', oscuro: '☾' }[this.tema.tema()];
  }
}
