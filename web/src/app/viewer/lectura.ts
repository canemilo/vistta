/**
 * Medir cuánto se mira cada apartado, sin convertirlo en vigilancia y sin
 * mentir.
 *
 * Cuatro decisiones que no son de implementación, son del producto:
 *
 * 1. Se mide TIEMPO VISIBLE AGREGADO por apartado, no un evento por scroll. Lo
 *    que sale es «estuvo unos cuatro minutos y volvió a los planos», no un
 *    rastro segundo a segundo de una persona identificada.
 * 2. Se envía con `sendBeacon` al salir, más un latido si la lectura es larga.
 *    `sendBeacon` va en la cola del navegador y sobrevive al cierre de la
 *    pestaña, así que no hay que retener a nadie para que se envíe.
 * 3. Si algo falla, se calla. Esto es telemetría, no funcionalidad: una
 *    excepción aquí no puede estropearle la visita a quien está mirando fotos.
 * 4. EL TIEMPO SE SANEA, y esto es lo que decide si el dato sirve o miente.
 *    Un número inflado no es «un poco peor»: es peor que no tener número, porque
 *    el agente lo usa en una llamada de venta. Ver `AcumuladorDeAtencion`.
 */

const LATIDO_MS = 60_000;

/** Por debajo de esto no es una mirada, es un scroll de paso. */
export const MINIMO_UTIL_MS = 500;

/**
 * Sin tocar nada durante un minuto, el reloj para.
 *
 * Una pestaña abierta no es atención: se deja el dosier puesto y se va uno a
 * comer. Sin este corte, «45 minutos en Planos» sería una comida, y alguien
 * llamaría a un comprador creyendo que está a punto de firmar.
 */
export const INACTIVIDAD_MS = 60_000;

/**
 * Tope por apartado en toda la lectura. Lo que pase de aquí SE DESCARTA, no se
 * acumula: cinco minutos mirando una foto ya es todo lo que ese dato puede
 * decir, y lo que venga después es ruido o es una pestaña olvidada que el corte
 * por inactividad no llegó a pillar.
 */
export const TOPE_POR_APARTADO_MS = 5 * 60 * 1000;

export interface EventoDeLectura {
  tipo: 'apertura' | 'seccion' | 'medio' | 'cierre' | 'final';
  seccionIdx?: number;
  msVisible?: number;
}

/**
 * La contabilidad del tiempo, sin DOM.
 *
 * Vive aparte del medidor a propósito: es la parte que decide si el número que
 * acaba en un informe es verdad, y una regla que no se puede probar sin montar
 * un navegador, una pestaña y un temporizador acaba sin probarse. Aquí el reloj
 * entra por parámetro y las pruebas lo mueven a mano.
 */
export class AcumuladorDeAtencion {
  /** Apartados con el cronómetro corriendo: índice → instante en que arrancó. */
  private readonly abiertos = new Map<number, number>();
  /** Apartados a la vista. No es lo mismo: con la pestaña oculta se ven y no cuentan. */
  private readonly visibles = new Set<number>();
  /** Lo medido y todavía sin enviar. */
  private readonly pendiente = new Map<number, number>();
  /** Lo medido en toda la lectura. Es contra esto contra lo que se aplica el tope. */
  private readonly total = new Map<number, number>();
  private ultimaInteraccion: number;
  private parado = false;

  constructor(ahora: number) {
    this.ultimaInteraccion = ahora;
  }

  /** Un apartado entra en pantalla. */
  entra(idx: number, ahora: number): void {
    this.visibles.add(idx);
    if (!this.parado) this.abiertos.set(idx, ahora);
  }

  /** Y sale. */
  sale(idx: number, ahora: number): void {
    this.visibles.delete(idx);
    this.cerrar(idx, ahora);
  }

  /**
   * Alguien ha tocado algo: scroll, dedo, ratón o tecla.
   *
   * Si veníamos de un parón, no basta con anotar la hora: hay que cerrar los
   * tramos abiertos —que ya salen recortados al minuto— y arrancarlos de nuevo.
   * Sin esto, un dosier abierto diez minutos con un toque al principio y otro al
   * final contaría los diez enteros.
   */
  interaccion(ahora: number): void {
    if (ahora - this.ultimaInteraccion > INACTIVIDAD_MS) this.rearrancar(ahora);
    this.ultimaInteraccion = ahora;
  }

  /** La pestaña se va al fondo. El reloj para del todo, no se recorta: para. */
  oculta(ahora: number): void {
    this.parado = true;
    for (const idx of [...this.abiertos.keys()]) this.cerrar(idx, ahora);
  }

  /** Y vuelve. Los que sigan a la vista arrancan de cero desde ahora. */
  visible(ahora: number): void {
    this.parado = false;
    this.ultimaInteraccion = ahora;
    for (const idx of this.visibles) this.abiertos.set(idx, ahora);
  }

  /**
   * Lo medido desde el último envío. Vacía lo pendiente y deja los cronómetros
   * corriendo, para que un latido a mitad de lectura no pierda ni invente nada.
   */
  recoger(ahora: number): Map<number, number> {
    this.rearrancar(ahora);
    const salida = new Map(this.pendiente);
    this.pendiente.clear();
    return salida;
  }

  /** Cierra los tramos abiertos y vuelve a abrir los que sigan a la vista. */
  private rearrancar(ahora: number): void {
    for (const idx of [...this.abiertos.keys()]) this.cerrar(idx, ahora);
    if (this.parado) return;
    for (const idx of this.visibles) this.abiertos.set(idx, ahora);
  }

  /**
   * Cierra un tramo. El final del tramo NO es «ahora», es lo que llegue antes
   * de «ahora» y «el último toque más un minuto»: ahí es donde el corte por
   * inactividad se aplica de verdad, hacia atrás y sin necesitar un temporizador
   * que se despierte cada segundo a comprobarlo.
   */
  private cerrar(idx: number, ahora: number): void {
    const desde = this.abiertos.get(idx);
    if (desde === undefined) return;
    this.abiertos.delete(idx);
    const hasta = Math.min(ahora, this.ultimaInteraccion + INACTIVIDAD_MS);
    const ms = hasta - desde;
    if (ms >= MINIMO_UTIL_MS) this.sumar(idx, ms);
  }

  /** Suma con el tope puesto. Lo que no cabe se tira; no se guarda para luego. */
  private sumar(idx: number, ms: number): void {
    const yaMedido = this.total.get(idx) ?? 0;
    const cabe = Math.max(0, TOPE_POR_APARTADO_MS - yaMedido);
    const util = Math.min(ms, cabe);
    if (util <= 0) return;
    this.total.set(idx, yaMedido + util);
    this.pendiente.set(idx, (this.pendiente.get(idx) ?? 0) + util);
  }
}

/** Los gestos que cuentan como «sigue ahí». Todos pasivos: no estorban al scroll. */
const GESTOS = ['scroll', 'pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'] as const;

export class MedidorDeLectura {
  private readonly cuenta: AcumuladorDeAtencion;
  private observador: IntersectionObserver | null = null;
  private latido: ReturnType<typeof setInterval> | null = null;
  private aperturaEnviada = false;
  /** El último apartado del dosier. Verlo es la señal de «llegó al final». */
  private ultimoIdx = -1;
  private llegoAlFinal = false;
  private finalEnviado = false;

  constructor(
    private readonly testigo: string,
    private readonly ahora: () => number = () => Date.now(),
  ) {
    this.cuenta = new AcumuladorDeAtencion(this.ahora());
  }

  /** Empieza a observar los apartados del documento. */
  observar(secciones: readonly Element[]): void {
    if (!('IntersectionObserver' in globalThis)) return;

    this.ultimoIdx = secciones.reduce((max, s) => {
      const idx = Number((s as HTMLElement).dataset['seccion']);
      return Number.isNaN(idx) ? max : Math.max(max, idx);
    }, -1);

    this.observador = new IntersectionObserver(
      (entradas) => {
        const ahora = this.ahora();
        for (const e of entradas) {
          const idx = Number((e.target as HTMLElement).dataset['seccion']);
          if (Number.isNaN(idx)) continue;
          if (e.isIntersecting) {
            this.cuenta.entra(idx, ahora);
            // Llegar al último apartado es una señal distinta de salir de la
            // página: casi todas las lecturas tienen cierre y muy pocas final.
            if (idx === this.ultimoIdx) this.llegoAlFinal = true;
          } else {
            this.cuenta.sale(idx, ahora);
          }
        }
      },
      // La mitad a la vista: un borde asomando por abajo no es «lo está mirando».
      { threshold: 0.5 },
    );
    for (const s of secciones) this.observador.observe(s);

    this.latido = setInterval(() => void this.enviar(false), LATIDO_MS);
    for (const gesto of GESTOS) {
      addEventListener(gesto, this.alInteractuar, { passive: true });
    }
    addEventListener('visibilitychange', this.alCambiarVisibilidad);
    addEventListener('pagehide', this.alSalir);
  }

  private readonly alInteractuar = (): void => this.cuenta.interaccion(this.ahora());

  private readonly alCambiarVisibilidad = (): void => {
    if (document.visibilityState === 'hidden') {
      this.cuenta.oculta(this.ahora());
      // Se aprovecha para mandar lo medido: puede que la pestaña no vuelva.
      void this.enviar(false);
    } else {
      this.cuenta.visible(this.ahora());
    }
  };

  private readonly alSalir = (): void => void this.enviar(true);

  /** Lo medido hasta ahora, listo para enviar. */
  private recoger(cierre: boolean): EventoDeLectura[] {
    const eventos: EventoDeLectura[] = [];
    if (!this.aperturaEnviada) {
      eventos.push({ tipo: 'apertura' });
      this.aperturaEnviada = true;
    }
    for (const [seccionIdx, msVisible] of this.cuenta.recoger(this.ahora())) {
      eventos.push({ tipo: 'seccion', seccionIdx, msVisible: Math.round(msVisible) });
    }
    // Una sola vez por lectura: el final se llega, no se llega cada minuto.
    if (this.llegoAlFinal && !this.finalEnviado) {
      eventos.push({ tipo: 'final' });
      this.finalEnviado = true;
    }
    if (cierre) eventos.push({ tipo: 'cierre' });
    return eventos;
  }

  private async enviar(cierre: boolean): Promise<void> {
    try {
      const eventos = this.recoger(cierre);
      // Solo la apertura no vale un viaje: si no se ha mirado nada medible y no
      // hay nada que contar, no se manda nada.
      const valeLaPena = eventos.some((e) => e.tipo !== 'apertura');
      if (!valeLaPena && !cierre) return;

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
    for (const gesto of GESTOS) removeEventListener(gesto, this.alInteractuar);
    removeEventListener('visibilitychange', this.alCambiarVisibilidad);
    removeEventListener('pagehide', this.alSalir);
    void this.enviar(true);
  }
}
