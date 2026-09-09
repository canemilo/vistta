import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api, type FichaDePropiedad, type Informe as InformeDto } from '../core/api';
import { CabeceraPanel } from '../core/cabecera-panel';
import { CLAVE_SESION } from '../core/sesion';

/** Los periodos que se ofrecen. Un mes por defecto: es el ritmo de la relación. */
const DIA = 86_400_000;
const PERIODOS = [
  { dias: 30, texto: 'Últimos 30 días' },
  { dias: 90, texto: 'Últimos 3 meses' },
  { dias: 365, texto: 'Último año' },
] as const;

/**
 * El informe al propietario del inmueble.
 *
 * Es el entregable que justifica la comisión y defiende la exclusiva: cada
 * quince días el agente tiene la misma conversación —«¿por qué no se vende mi
 * casa?»— y hasta ahora la contestaba con impresiones.
 *
 * DOS COSAS QUE NO SE TOCAN:
 *
 *   1. Aquí NO aparece ni puede aparecer un comprador concreto. El servidor no
 *      lo manda (ver `src/lib/informe.ts`) y esta pantalla no tiene de dónde
 *      sacarlo. Es protección de datos, y además es lo que deja al agente sin
 *      su papel de intermediario el día que el propietario ve a sus clientes.
 *   2. Por debajo de cuatro lecturas no se pintan porcentajes. El servidor los
 *      manda a `null` a propósito para que no haya forma de pintarlos por
 *      descuido, y aquí salen los números tal cual con su aviso al lado.
 */
@Component({
  selector: 'app-informe',
  imports: [FormsModule, CabeceraPanel],
  templateUrl: './informe.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /*
     * El informe va SIEMPRE en claro, y es la misma decisión que la del pase:
     * esto es un documento que se entrega a un tercero y que se imprime, así
     * que su aspecto no lo elige quien lo mira. Los tokens se redefinen
     * acotados a este componente, como hace el documento del pase, para que el
     * resto del panel siga con el tema que cada uno tenga puesto.
     */
    :host {
      display: block;
      min-height: 100vh;
      color-scheme: light;
      --color-fondo: #f7f9fa;
      --color-sup: #ffffff;
      --color-sup-2: #eef3f4;
      --color-sup-3: #e4ebed;
      --color-borde: #d3dfe2;
      --color-borde-2: #e2eaec;
      --color-borde-3: #edf2f3;
      --color-titulo: #07242f;
      --color-texto: #0f2c37;
      --color-texto-2: #33545e;
      --color-texto-3: #4c6a73;
      --color-texto-4: #556d75;
      --color-acento: #09714f;
      --color-acento-tenue: #0f8f66;
      --color-sobre-acento: #ffffff;
      --color-aviso: #8a5300;
      --color-aviso-borde: #e8d3ac;
      --color-aviso-fondo: #fdf8ef;
      --color-peligro: #a3243a;
      --color-peligro-borde: #e8c4cb;
      --color-peligro-fondo: #fdf2f4;
      background-color: var(--color-fondo);
      color: var(--color-texto);
    }

    /*
     * El PDF se hace con el «Guardar como PDF» del navegador, y no con una
     * librería. Es el mismo motor que ya imprime docs/: sale igual que en
     * pantalla, no añade una dependencia pesada, y el agente puede reenviarlo
     * tal cual. Lo único que hace falta es que lo del panel no salga en el
     * papel.
     */
    @media print {
      .no-imprimir {
        display: none !important;
      }

      :host {
        min-height: 0;
        background: none;
      }

      .hoja {
        max-width: none;
        margin: 0;
        padding: 0;
        border: 0;
      }

      /* Que no parta un bloque a la mitad entre dos páginas. */
      .bloque {
        break-inside: avoid;
      }
    }
  `,
})
export class Informe {
  private readonly api = inject(Api);
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly periodos = PERIODOS;
  protected readonly dias = signal(30);
  protected readonly informe = signal<InformeDto | null>(null);
  protected readonly ficha = signal<FichaDePropiedad | null>(null);
  protected readonly cargando = signal(true);
  protected readonly error = signal('');
  protected readonly guardado = signal('');

  /** Los campos de la ficha, editables. */
  protected referencia = '';
  protected exclusivaDesde = '';
  protected propietarioNota = '';

  private readonly sesion = sessionStorage.getItem(CLAVE_SESION);
  private readonly profileId = this.ruta.snapshot.paramMap.get('id') ?? '';

  constructor() {
    if (!this.sesion) void this.router.navigate(['/panel']);
    else void this.cargar();
  }

  private async cargar(): Promise<void> {
    if (!this.sesion) return;
    this.cargando.set(true);
    try {
      const hasta = Date.now();
      const [informe, ficha] = await Promise.all([
        this.api.informe(this.sesion, this.profileId, {
          desde: hasta - this.dias() * DIA,
          hasta,
        }),
        this.api.fichaDePropiedad(this.sesion, this.profileId),
      ]);
      this.informe.set(informe);
      this.ficha.set(ficha.ficha);
      this.referencia = ficha.ficha?.referencia ?? '';
      this.propietarioNota = ficha.ficha?.propietarioNota ?? '';
      this.exclusivaDesde = enFechaDeCampo(ficha.ficha?.exclusivaDesde ?? null);
    } catch {
      this.error.set('No se ha podido cargar el informe.');
    } finally {
      this.cargando.set(false);
    }
  }

  protected async cambiarPeriodo(dias: number): Promise<void> {
    this.dias.set(dias);
    await this.cargar();
  }

  protected async guardarFicha(): Promise<void> {
    if (!this.sesion) return;
    this.guardado.set('');
    try {
      const { ficha } = await this.api.guardarFicha(this.sesion, this.profileId, {
        referencia: this.referencia.trim() || null,
        propietarioNota: this.propietarioNota.trim() || null,
        exclusivaDesde: deFechaDeCampo(this.exclusivaDesde),
      });
      this.ficha.set(ficha);
      // Se recarga el informe: la referencia sale en la cabecera del documento.
      await this.cargar();
      this.guardado.set('Ficha guardada.');
    } catch {
      this.error.set('No se ha podido guardar la ficha.');
    }
  }

  protected imprimir(): void {
    window.print();
  }

  // --- cómo se dice cada cosa ----------------------------------------------

  /**
   * El tiempo, REDONDEADO y con «unos» delante. «3 m 12 s» sugiere una
   * precisión que no existe: esto lo mide un navegador, con la pestaña delante
   * y el reloj parado cuando no hay nadie tocando nada.
   */
  protected enTiempo(ms: number | null): string {
    if (ms === null || ms < 1_000) return 'sin datos';
    if (ms < 90_000) return `unos ${Math.max(10, Math.round(ms / 10_000) * 10)} segundos`;
    return `unos ${Math.round(ms / 60_000)} minutos`;
  }

  protected enFecha(ts: number | null): string {
    return ts === null ? '—' : new Date(ts).toLocaleDateString('es-ES');
  }

  /** El apartado, por su título; y por su número si nunca tuvo uno. */
  protected nombreDeApartado(titulo: string | null, idx: number): string {
    return titulo ?? `Apartado ${idx + 1}`;
  }

  /**
   * Los apartados por los que no pasó nadie, en una frase. Se monta aquí y no
   * en la plantilla: una expresión de Angular no es sitio para un `map`.
   *
   * Es lo más accionable del informe. Si nadie llega a Precio, hay una
   * conversación que tener.
   */
  protected listaDeSaltados(inf: InformeDto): string {
    return inf.saltados.map((s) => this.nombreDeApartado(s.titulo, s.seccionIdx)).join(', ');
  }

  /**
   * Cuánto ha cambiado la apertura respecto al periodo anterior. `null` cuando
   * falta cualquiera de los dos: media evolución no es una evolución.
   */
  protected evolucion(): number | null {
    const i = this.informe();
    if (!i?.anterior || i.cifras.pctApertura === null || i.anterior.pctApertura === null) {
      return null;
    }
    return i.cifras.pctApertura - i.anterior.pctApertura;
  }
}

/** ms → `yyyy-mm-dd`, que es lo que entiende un `<input type="date">`. */
function enFechaDeCampo(ts: number | null): string {
  if (ts === null) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Y la vuelta. Vacío es `null`: borrar la fecha tiene que ser posible. */
function deFechaDeCampo(valor: string): number | null {
  if (!valor) return null;
  const ts = Date.parse(`${valor}T00:00:00`);
  return Number.isNaN(ts) ? null : ts;
}
