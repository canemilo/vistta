import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Api, type PassView } from '../core/api';
import { PassDocument } from '../document/pass-document';
import { MedidorDeLectura } from './lectura';

type Estado = 'cargando' | 'abierto' | 'denegado';

/**
 * Viewer público: abre el pase (lo consume) y monta el documento.
 * Si el enlace ya se usó o caducó, solo queda el estado denegado.
 */
@Component({
  selector: 'app-viewer',
  imports: [PassDocument],
  templateUrl: './viewer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* Mismo criterio que el documento: lo público es oscuro siempre. */
    :host {
      display: block;
      min-height: 100vh;
      background-color: #060e17;
      color: #d7e9e6;
    }
  `,
})
export class Viewer implements OnDestroy {
  private readonly api = inject(Api);
  private readonly ruta = inject(ActivatedRoute);
  private readonly host = inject(ElementRef<HTMLElement>);
  /** `afterNextRender` se llama fuera del constructor: necesita el inyector. */
  private readonly inyector = inject(Injector);

  protected readonly estado = signal<Estado>('cargando');
  protected readonly vista = signal<PassView | null>(null);
  protected readonly enlace = signal('');
  /**
   * Si se está midiendo la lectura. Se enseña, no se esconde: medir a alguien
   * sin decírselo no es aceptable, y decirlo cuesta una línea.
   */
  protected readonly midiendo = signal(false);

  private medidor: MedidorDeLectura | null = null;

  constructor() {
    const token = this.ruta.snapshot.paramMap.get('token') ?? '';
    this.enlace.set(`${location.host}/v/${token.slice(0, 4)}…`);
    void this.abrir(token);
  }

  private async abrir(token: string): Promise<void> {
    try {
      const vista = await this.api.open(token);
      this.vista.set(vista);
      this.estado.set('abierto');
      if (vista.eventos) this.empezarAMedir(vista.eventos);
    } catch {
      // Usado, caducado o inexistente: para el cliente es lo mismo.
      this.estado.set('denegado');
    }
  }

  private empezarAMedir(testigo: string): void {
    this.midiendo.set(true);
    this.medidor = new MedidorDeLectura(testigo);
    // Después de pintar: antes no existen los nodos que hay que observar.
    afterNextRender(
      () => {
        const secciones = this.host.nativeElement.querySelectorAll('[data-seccion]');
        this.medidor?.observar(Array.from(secciones));
      },
      { injector: this.inyector },
    );
  }

  ngOnDestroy(): void {
    this.medidor?.parar();
  }
}
