import {
  AcumuladorDeAtencion,
  INACTIVIDAD_MS,
  MINIMO_UTIL_MS,
  TOPE_POR_APARTADO_MS,
} from './lectura';

/**
 * El saneamiento del tiempo, medido.
 *
 * Estas reglas existen porque un dato inflado es peor que no tener dato: el
 * agente lo usa en una llamada de venta y le dice al propietario del inmueble
 * que su piso se miró cuarenta y cinco minutos, cuando lo que pasó es que
 * alguien dejó la pestaña abierta y se fue a comer.
 *
 * El reloj entra por parámetro: aquí no hay temporizadores ni esperas, se mueve
 * a mano. Una prueba de tiempo que espera de verdad tarda minutos y acaba
 * borrada.
 */
describe('AcumuladorDeAtencion · el tiempo se sanea', () => {
  const T0 = 1_000_000;

  it('cuenta lo que se mira, entre que entra y sale', () => {
    const a = new AcumuladorDeAtencion(T0);
    a.entra(0, T0);
    a.interaccion(T0 + 5_000);
    a.sale(0, T0 + 10_000);

    expect(a.recoger(T0 + 10_000).get(0)).toBe(10_000);
  });

  it('un vistazo de paso no cuenta', () => {
    const a = new AcumuladorDeAtencion(T0);
    a.entra(0, T0);
    a.sale(0, T0 + MINIMO_UTIL_MS - 1);

    expect(a.recoger(T0 + 1_000).has(0)).toBe(false);
  });

  /*
   * ESTE ES EL PUNTO. Con la pestaña al fondo el reloj para; no se recorta ni
   * se estima: para. Antes seguía corriendo, y una pestaña olvidada toda la
   * tarde entraba en el informe como atención.
   */
  it('con la pestaña oculta el reloj para, y no cuenta el rato de fuera', () => {
    const a = new AcumuladorDeAtencion(T0);
    a.entra(0, T0);
    a.oculta(T0 + 10_000);
    // Media hora en otra pestaña.
    a.visible(T0 + 1_810_000);
    a.sale(0, T0 + 1_815_000);

    expect(a.recoger(T0 + 1_815_000).get(0)).toBe(15_000);
  });

  it('sin tocar nada, el reloj se corta al minuto', () => {
    const a = new AcumuladorDeAtencion(T0);
    a.entra(0, T0);
    // Diez minutos sin un solo gesto.
    a.sale(0, T0 + 600_000);

    expect(a.recoger(T0 + 600_000).get(0)).toBe(INACTIVIDAD_MS);
  });

  /*
   * Y el reverso, que es donde estaría el fallo si el corte solo mirase hacia
   * atrás: si vuelve a tocar algo, el reloj arranca otra vez desde ese momento,
   * no desde que entró. Diez minutos con un toque al principio y otro al final
   * son dos minutos de atención, no diez.
   */
  it('tras un parón, lo que se vuelve a mirar cuenta desde el gesto', () => {
    const a = new AcumuladorDeAtencion(T0);
    a.entra(0, T0);
    a.interaccion(T0 + 600_000); // vuelve
    a.sale(0, T0 + 630_000); // y mira medio minuto más

    // Un minuto del principio (recortado) + los treinta segundos de después.
    expect(a.recoger(T0 + 630_000).get(0)).toBe(INACTIVIDAD_MS + 30_000);
  });

  it('el tope por apartado descarta el resto, no lo acumula', () => {
    const a = new AcumuladorDeAtencion(T0);
    let t = T0;
    // Una hora mirando lo mismo, tocando algo cada treinta segundos para que el
    // corte por inactividad no entre.
    a.entra(0, t);
    for (let i = 0; i < 120; i++) {
      t += 30_000;
      a.interaccion(t);
    }
    a.sale(0, t);

    expect(a.recoger(t).get(0)).toBe(TOPE_POR_APARTADO_MS);
  });

  it('el tope es de toda la lectura, no de cada envío', () => {
    const a = new AcumuladorDeAtencion(T0);
    let t = T0;
    a.entra(0, t);
    let sumado = 0;
    // Diez envíos de un minuto cada uno: el tope son cinco.
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 2; j++) {
        t += 30_000;
        a.interaccion(t);
      }
      sumado += a.recoger(t).get(0) ?? 0;
    }

    expect(sumado).toBe(TOPE_POR_APARTADO_MS);
  });

  it('un latido a mitad no pierde ni duplica lo medido', () => {
    const a = new AcumuladorDeAtencion(T0);
    a.entra(0, T0);
    a.interaccion(T0 + 30_000);
    const primero = a.recoger(T0 + 30_000).get(0) ?? 0;
    a.interaccion(T0 + 50_000);
    const segundo = a.recoger(T0 + 50_000).get(0) ?? 0;

    expect(primero).toBe(30_000);
    expect(segundo).toBe(20_000);
  });

  it('mide cada apartado por su cuenta', () => {
    const a = new AcumuladorDeAtencion(T0);
    a.entra(0, T0);
    a.interaccion(T0 + 5_000);
    a.sale(0, T0 + 5_000);
    a.entra(1, T0 + 5_000);
    a.interaccion(T0 + 25_000);
    a.sale(1, T0 + 25_000);

    const medido = a.recoger(T0 + 25_000);
    expect(medido.get(0)).toBe(5_000);
    expect(medido.get(1)).toBe(20_000);
  });
});
