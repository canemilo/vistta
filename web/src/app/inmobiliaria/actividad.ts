import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  Api,
  type Aviso,
  type FilaDeComparativa,
  type MotivoDeInteres,
  type PaseEnElTermometro,
  type Temperatura,
} from '../core/api';
import { CabeceraPanel } from '../core/cabecera-panel';
import { CLAVE_SESION } from '../core/sesion';

/** Por qué columna se ordena la comparativa. */
type Columna = 'nombre' | 'enviados' | 'apertura' | 'tiempo' | 'final';

/**
 * La actividad de la cartera: a quién llamar hoy y dónde merece la pena el
 * esfuerzo.
 *
 * Pantalla propia y no una pestaña más del panel, por dos razones. La primera
 * es de peso: el panel ya es el componente más grande del proyecto y esto no
 * hace falta para montar un dosier ni para mandar un enlace. La segunda es de
 * uso: esto se mira por la mañana con un café y el panel se abre para trabajar.
 */
@Component({
  selector: 'app-actividad',
  imports: [CabeceraPanel, RouterLink],
  templateUrl: './actividad.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Actividad {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  protected readonly cargando = signal(true);
  protected readonly error = signal('');
  protected readonly avisos = signal<Aviso[]>([]);
  protected readonly avisosActivos = signal(true);
  /**
   * Si alguna conexión con el CRM se ha apagado por fallos.
   *
   * Se enseña AQUÍ y no solo en la pantalla de configuración: esa se abre una
   * vez y no se vuelve a mirar, y un aviso que no llega en silencio es peor que
   * no tener avisos —el agente cree que su CRM le avisa y no le avisa nadie—.
   */
  protected readonly conexionApagada = signal(false);
  protected readonly pases = signal<PaseEnElTermometro[]>([]);
  protected readonly filas = signal<FilaDeComparativa[]>([]);
  protected readonly orden = signal<{ columna: Columna; descendente: boolean }>({
    columna: 'nombre',
    descendente: false,
  });

  private readonly sesion = sessionStorage.getItem(CLAVE_SESION);

  constructor() {
    if (!this.sesion) void this.router.navigate(['/panel']);
    else void this.cargar(this.sesion);
  }

  private async cargar(sesion: string): Promise<void> {
    try {
      const [avisos, termometro, comparativa] = await Promise.all([
        this.api.avisos(sesion),
        this.api.termometro(sesion),
        this.api.comparativa(sesion),
      ]);
      this.avisos.set(avisos.avisos);
      this.avisosActivos.set(avisos.activos);
      this.conexionApagada.set(avisos.conexionApagada);
      this.pases.set(termometro.pases);
      this.filas.set(comparativa.filas);
    } catch {
      // Sin detalle: o la sesión ha caducado o el servidor no está. Para quien
      // mira la pantalla las dos cosas se arreglan igual.
      this.error.set('No se ha podido cargar la actividad. Vuelve a entrar al panel.');
    } finally {
      this.cargando.set(false);
    }
  }

  /** Los que merecen una llamada hoy: los calientes, arriba y aparte. */
  protected readonly calientes = computed(() =>
    this.pases().filter((p) => p.temperatura === 'caliente'),
  );
  protected readonly resto = computed(() =>
    this.pases().filter((p) => p.temperatura !== 'caliente'),
  );

  /**
   * La comparativa ordenada. Ordenar es del navegador y no del servidor a
   * propósito: son diez filas ya traídas, y pedirlas otra vez por cada clic
   * sería un viaje por nada.
   *
   * Las que no tienen datos suficientes caen al final SIEMPRE, ordene uno por
   * lo que ordene: si no, una propiedad con un solo envío encabezaría la tabla
   * de «mejor apertura» con un 100% que no significa nada.
   */
  protected readonly filasOrdenadas = computed(() => {
    const { columna, descendente } = this.orden();
    const signo = descendente ? -1 : 1;
    return [...this.filas()].sort((a, b) => {
      if (a.datosSuficientes !== b.datosSuficientes) return a.datosSuficientes ? -1 : 1;
      return signo * comparar(a, b, columna);
    });
  });

  protected ordenarPor(columna: Columna): void {
    const actual = this.orden();
    this.orden.set({
      columna,
      // Al cambiar de columna se empieza por lo más alto, que es lo que se
      // quiere mirar; repetir la misma le da la vuelta.
      descendente: actual.columna === columna ? !actual.descendente : columna !== 'nombre',
    });
  }

  protected async marcarVisto(aviso: Aviso): Promise<void> {
    if (!this.sesion) return;
    try {
      await this.api.avisoVisto(this.sesion, aviso.id);
      this.avisos.update((lista) => lista.filter((a) => a.id !== aviso.id));
    } catch {
      this.error.set('No se ha podido marcar el aviso.');
    }
  }

  protected async cambiarAvisos(): Promise<void> {
    if (!this.sesion) return;
    const nuevo = !this.avisosActivos();
    // Optimista y con vuelta atrás: es una casilla, y esperar al servidor para
    // pintarla hace que parezca que no ha funcionado.
    this.avisosActivos.set(nuevo);
    try {
      await this.api.configurarAvisos(this.sesion, nuevo);
    } catch {
      this.avisosActivos.set(!nuevo);
      this.error.set('No se ha podido guardar la preferencia.');
    }
  }

  // --- cómo se dice cada cosa ----------------------------------------------

  /**
   * La frase de cada estado. El servidor manda el CÓDIGO y el texto se monta
   * aquí, que es donde vive el resto de la copia.
   *
   * Todas describen el comportamiento SOBRE ESE DOSIER. Ninguna dice nada de
   * quien lee: «volvió a abrirlo» sí, «es un indeciso» no.
   */
  protected razon(p: PaseEnElTermometro): string {
    const frases: Record<MotivoDeInteres, string> = {
      reapertura:
        p.aperturas > 2
          ? `lo ha abierto ${p.aperturas} veces, la última ${this.cuando(p.cuando)}`
          : `volvió a abrirlo ${this.cuando(p.cuando)}`,
      final: 'lo leyó entero, hasta el último apartado',
      atencion: `se detuvo en ${p.apartado ?? `el apartado ${(p.apartadoIdx ?? 0) + 1}`}`,
      'apertura-rapida': 'lo abrió a los pocos minutos de recibirlo',
      'abierto-incompleto': 'lo abrió, pero no llegó al final',
      'sin-abrir': `sin abrir desde que se envió ${this.cuando(p.creadoEn)}`,
    };
    return frases[p.motivo];
  }

  protected etiqueta(t: Temperatura): string {
    return { caliente: 'Caliente', tibio: 'Tibio', frio: 'Frío' }[t];
  }

  /** Cómo se llama un enlace en la lista. Sin destinatario, por su propiedad. */
  protected aQuien(p: PaseEnElTermometro): string {
    return p.destinatarioRef ?? p.destinatarioNota ?? 'Sin destinatario anotado';
  }

  /**
   * Hace cuánto, REDONDEADO. La precisión al minuto no aporta valor comercial y
   * sugiere una vigilancia que ni es exacta ni conviene enseñar.
   */
  protected cuando(ts: number): string {
    const dias = Math.floor((Date.now() - ts) / 86_400_000);
    if (dias <= 0) return 'hoy';
    if (dias === 1) return 'ayer';
    if (dias < 7) return `hace ${dias} días`;
    if (dias < 14) return 'hace una semana';
    if (dias < 31) return `hace ${Math.round(dias / 7)} semanas`;
    return `hace ${Math.round(dias / 30)} meses`;
  }

  /** «Unos tres minutos», no «3 m 12 s». Y solo si hay algo que decir. */
  protected enTiempo(ms: number | null): string {
    if (ms === null || ms < 1_000) return '—';
    if (ms < 90_000) return `unos ${Math.max(10, Math.round(ms / 10_000) * 10)} segundos`;
    return `unos ${Math.round(ms / 60_000)} minutos`;
  }

  protected enPorcentaje(pct: number | null): string {
    return pct === null ? '—' : `${pct}%`;
  }
}

/** El criterio de orden de cada columna. Fuera de la clase: no toca estado. */
function comparar(a: FilaDeComparativa, b: FilaDeComparativa, columna: Columna): number {
  switch (columna) {
    case 'nombre':
      return a.displayName.localeCompare(b.displayName);
    case 'enviados':
      return a.enviados - b.enviados;
    case 'apertura':
      return (a.pctApertura ?? -1) - (b.pctApertura ?? -1);
    case 'tiempo':
      return (a.msMedio ?? -1) - (b.msMedio ?? -1);
    case 'final':
      return (a.pctFinal ?? -1) - (b.pctFinal ?? -1);
  }
}
