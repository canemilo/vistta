import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { marked } from 'marked';

interface AvisoLegal {
  titular: { nombre: string | null; identificacion: string | null; direccion: string | null };
  contacto: string | null;
  completo: boolean;
}

interface Documento {
  archivo: string;
  titulo: string;
  resumen: string;
}

/**
 * Los documentos legales, servidos desde su única versión.
 *
 * El texto NO está escrito aquí: se lee de `legal/*.md`, que es lo que se
 * revisa y lo que tiene historial en el repositorio. Si esta pantalla llevara
 * su propia copia, las dos se separarían en la primera corrección y habría dos
 * avisos legales distintos en vigor a la vez.
 *
 * Los marcadores del titular se sustituyen aquí, con lo que devuelve
 * `/api/legal`, porque son datos del despliegue y no del código: el mismo
 * software lo puede explotar otro.
 */
@Component({
  selector: 'app-legal',
  imports: [RouterLink],
  templateUrl: './legal.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class Legal {
  private readonly http = inject(HttpClient);

  protected readonly DOCUMENTOS: Documento[] = [
    {
      archivo: 'terminos.md',
      titulo: 'Términos del servicio',
      resumen: 'Qué es Vistta, qué promete y qué no, y cuándo caduca tu contenido.',
    },
    {
      archivo: 'privacidad.md',
      titulo: 'Privacidad',
      resumen: 'Qué se guarda de ti como cliente. No se guarda tu correo: no hay dónde.',
    },
    {
      archivo: 'encargado.md',
      titulo: 'Encargado del tratamiento',
      resumen:
        'El contrato del art. 28 sobre el contenido que subes. De eso el responsable eres tú.',
    },
    {
      archivo: 'aup.md',
      titulo: 'Uso aceptable y retirada',
      resumen: 'Qué no se puede subir y cómo avisar de un contenido.',
    },
  ];

  protected readonly aviso = signal<AvisoLegal | null>(null);
  protected readonly elegido = signal<Documento | null>(null);
  protected readonly cuerpo = signal('');
  protected readonly cargando = signal(false);
  protected readonly error = signal('');

  /** Sin los cuatro datos del titular no hay aviso legal que enseñar. */
  protected readonly configurado = computed(() => this.aviso()?.completo === true);

  constructor() {
    void this.cargarAviso();
  }

  private async cargarAviso(): Promise<void> {
    try {
      this.aviso.set(await firstValueFrom(this.http.get<AvisoLegal>('/api/legal')));
    } catch {
      this.error.set('No se pudo cargar el aviso legal.');
    }
  }

  protected async abrir(doc: Documento): Promise<void> {
    this.elegido.set(doc);
    this.cuerpo.set('');
    this.error.set('');
    this.cargando.set(true);
    try {
      const texto = await firstValueFrom(
        this.http.get(`/legal/${doc.archivo}`, { responseType: 'text' }),
      );
      // `marked` sobre un archivo NUESTRO, no sobre entrada de un usuario. Aun
      // así el resultado pasa por el saneador de Angular al pintarlo.
      this.cuerpo.set(await marked.parse(this.sustituir(texto)));
    } catch {
      this.error.set('No se pudo cargar el documento.');
    } finally {
      this.cargando.set(false);
    }
  }

  protected cerrar(): void {
    this.elegido.set(null);
    this.cuerpo.set('');
  }

  /**
   * Rellena los marcadores con los datos del despliegue.
   *
   * Si falta alguno se deja escrito «pendiente de configurar» en vez de dejar
   * el marcador crudo: un documento con `TITULAR_NOMBRE` a la vista parece un
   * error de programación, y uno con el hueco relleno de nada parece un texto
   * en vigor que no lo está. Decirlo es lo único honesto.
   */
  private sustituir(texto: string): string {
    const a = this.aviso();
    const pendiente = '**(pendiente de configurar)**';
    return texto
      .replaceAll('`TITULAR_NOMBRE`', a?.titular.nombre ?? pendiente)
      .replaceAll('`TITULAR_IDENTIFICACION`', a?.titular.identificacion ?? pendiente)
      .replaceAll('`TITULAR_DIRECCION`', a?.titular.direccion ?? pendiente)
      .replaceAll('`CONTACTO_LEGAL`', a?.contacto ?? pendiente);
  }
}
