/**
 * Medir cuánto se mira cada sección, sin convertirlo en vigilancia.
 *
 * Tres decisiones que no son de implementación, son del producto:
 *
 * 1. Se mide TIEMPO VISIBLE AGREGADO por sección, no un evento por scroll. Lo
 *    que sale es «estuvo unos cuatro minutos y volvió a los planos», no un
 *    rastro segundo a segundo de una persona identificada.
 * 2. Se envía con `sendBeacon` al salir, más un latido si la lectura es larga.
 *    `sendBeacon` va en la cola del navegador y sobrevive al cierre de la
 *    pestaña, así que no hay que retener a nadie para que se envíe.
 * 3. Si algo falla, se calla. Esto es telemetría, no funcionalidad: una
 *    excepción aquí no puede estropearle la visita a quien está mirando fotos.
 */

const LATIDO_MS = 60_000;
/** Por debajo de esto no es una mirada, es un scroll de paso. */
const MINIMO_UTIL_MS = 500;

export interface EventoDeLectura {
  tipo: 'apertura' | 'seccion' | 'medio' | 'cierre';
  seccionIdx?: number;
  msVisible?: number;
}

export class MedidorDeLectura {
  private readonly visibleDesde = new Map<number, number>();
  private readonly acumulado = new Map<number, number>();
  private observador: IntersectionObserver | null = null;
  private latido: ReturnType<typeof setInterval> | null = null;
  private enviado = false;

  constructor(
    private readonly testigo: string,
    private readonly ahora: () => number = () => Date.now(),
  ) {}

  /** Empieza a observar las secciones del documento. */
  observar(secciones: readonly Element[]): void {
    if (!('IntersectionObserver' in globalThis)) return;

    this.observador = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          const idx = Number((e.target as HTMLElement).dataset['seccion']);
          if (Number.isNaN(idx)) continue;
          if (e.isIntersecting) this.visibleDesde.set(idx, this.ahora());
          else this.cerrarTramo(idx);
        }
      },
      // La mitad a la vista: un borde asomando por abajo no es «lo está mirando».
      { threshold: 0.5 },
    );
    for (const s of secciones) this.observador.observe(s);

    this.latido = setInterval(() => void this.enviar(false), LATIDO_MS);
    addEventListener('visibilitychange', this.alOcultarse);
    addEventListener('pagehide', this.alSalir);
  }

  /** Cierra el tramo abierto de una sección y lo suma. */
  private cerrarTramo(idx: number): void {
    const desde = this.visibleDesde.get(idx);
    if (desde === undefined) return;
    this.visibleDesde.delete(idx);
    const ms = this.ahora() - desde;
    if (ms >= MINIMO_UTIL_MS) this.acumulado.set(idx, (this.acumulado.get(idx) ?? 0) + ms);
  }

  private readonly alOcultarse = (): void => {
    if (document.visibilityState === 'hidden') void this.enviar(false);
  };

  private readonly alSalir = (): void => void this.enviar(true);

  /** Lo medido hasta ahora, listo para enviar. Vacía lo acumulado. */
  private recoger(cierre: boolean): EventoDeLectura[] {
    for (const idx of [...this.visibleDesde.keys()]) {
      this.cerrarTramo(idx);
      this.visibleDesde.set(idx, this.ahora()); // sigue visible: nuevo tramo
    }
    const eventos: EventoDeLectura[] = [];
    if (!this.enviado) {
      eventos.push({ tipo: 'apertura' });
      this.enviado = true;
    }
    for (const [seccionIdx, msVisible] of this.acumulado) {
      eventos.push({ tipo: 'seccion', seccionIdx, msVisible: Math.round(msVisible) });
    }
    this.acumulado.clear();
    if (cierre) eventos.push({ tipo: 'cierre' });
    return eventos;
  }

  private async enviar(cierre: boolean): Promise<void> {
    try {
      const eventos = this.recoger(cierre);
      // Solo la apertura y el cierre no valen un viaje: si no se ha mirado
      // nada medible, no se manda nada.
      if (!eventos.some((e) => e.tipo === 'seccion') && !cierre) return;

      const cuerpo = JSON.stringify({ testigo: this.testigo, eventos });
      if (cierre && 'sendBeacon' in navigator) {
        navigator.sendBeacon(
          '/api/passes/eventos',
          new Blob([cuerpo], { type: 'application/json' }),
        );
        return;
      }
      await fetch('/api/passes/eventos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: cuerpo,
        keepalive: true,
      });
    } catch {
      // A propósito: telemetría que falla no se nota y no se arregla sola.
    }
  }

  /** Se llama al destruir el componente. */
  parar(): void {
    this.observador?.disconnect();
    if (this.latido !== null) clearInterval(this.latido);
    removeEventListener('visibilitychange', this.alOcultarse);
    removeEventListener('pagehide', this.alSalir);
    void this.enviar(true);
  }
}
