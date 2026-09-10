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
     * EN PANTALLA, EL INFORME RESPETA TU TEMA.
     *
     * Antes forzaba el claro siempre, copiando la regla del documento del pase
     * —«quien lo abre no decide cómo se ve»—, y estaba mal copiada: el pase lo
     * abre un TERCERO al que se le enseña un trabajo, y el informe lo miras TÚ,
     * en tu panel, con el tema que tú elegiste. Entrar aquí desde Actividad con
     * el panel en oscuro y que la pantalla se pusiera blanca no era una
     * decisión de diseño, era pisarle la preferencia a su dueño.
     *
     * Lo que sí tiene aspecto propio es el PAPEL, y para eso está el bloque de
     * impresión: tinta oscura sobre blanco, venga uno del tema que venga.
     */
    :host {
      display: block;
      min-height: 100vh;
    }

    /*
     * El PDF se hace con el «Guardar como PDF» del navegador, y no con una
     * librería. Es el mismo motor que ya imprime docs/: sale igual que en
     * pantalla, no añade una dependencia pesada, y el agente puede reenviarlo
     * tal cual.
     */
    @media print {
      /*
       * Los tokens claros, aquí y solo aquí. Imprimir el tema oscuro gasta un
       * cartucho y llega gris; y si el navegador decide no pintar los fondos
       * —que es lo que hacen por defecto—, sale texto claro sobre papel blanco,
       * o sea, una hoja en blanco.
       *
       * Los valores son los del tema claro de web/src/styles.css. Si allí
       * cambia la paleta, esto se queda viejo: es la única copia que hay y no
       * se puede evitar, porque en oscuro los tokens ya están reasignados y
       * heredarlos traería justo lo que hay que deshacer.
       */
      :host {
        color-scheme: light;
        --color-fondo: #ffffff;
        --color-sup: #ffffff;
        --color-sup-2: #eaf1f3;
        --color-sup-3: #d7e2e6;
        --color-borde: #c2d2d7;
        --color-borde-2: #d5e0e3;
        --color-borde-3: #e6edef;
        --color-titulo: #062330;
        --color-texto: #0d2a35;
        --color-texto-2: #294b56;
        --color-texto-3: #3d5c66;
        --color-texto-4: #46646d;
        --color-acento: #166534;
        --color-acento-tenue: #15803d;
        --color-sobre-acento: #ffffff;
        --color-aviso: #8a5300;
        --color-aviso-borde: #dfc79a;
        --color-aviso-fondo: #fcf5e9;
        --color-peligro: #a3243a;
        --color-peligro-borde: #e0b3bc;
        --color-peligro-fondo: #fbeef0;
        min-height: 0;
        background: none;
        color: var(--color-texto);
      }

      .no-imprimir {
        display: none !important;
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
