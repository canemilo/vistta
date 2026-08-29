import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PassCard } from '../pass-card/pass-card';
import type { MediaItem } from '../core/api';

/** Portada: muestra el aspecto de un pase abierto, sin consumir ninguno. */
@Component({
  selector: 'app-demo',
  imports: [PassCard],
  templateUrl: './demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      width: 100%;
    }
  `,
})
export class Demo {
  protected readonly medios: MediaItem[] = [
    { url: '', type: 'image', caption: 'Obra 1' },
    { url: '', type: 'image', caption: 'Obra 2' },
    { url: '', type: 'image', caption: 'Obra 3' },
    { url: '', type: 'image', caption: 'Obra 4' },
  ];

  protected readonly marca = `PASE · X7K2 · ${new Date().toTimeString().slice(0, 5)}`;
}
