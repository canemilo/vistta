import { describe, it, expect, beforeEach } from "vitest";
import { proximaLimpieza, purgar } from "../src/lib/purga";
import { createPass } from "../src/lib/pass";
import { cambiarPlan } from "../src/lib/congelado";
import { AVISO_LIMPIEZA_MS, PLANES } from "../src/lib/planes";
import { crearCuenta, db, panelSession, resetDb, storage, subirMedio } from "./helpers";

beforeEach(resetDb);

const DIA = 86_400_000;
/*
 * La ventana de aviso tiene que ser MENOR que la retención más corta. Con una
 * igual, lo que se sube hoy ya cae dentro y el aviso se enciende siempre.
 */
const AVISO = AVISO_LIMPIEZA_MS;

/** Una cuenta con su perfil y sesión abierta, que es lo que pide `subirMedio`. */
async function cuenta(): Promise<string> {
  await crearCuenta("marina", "Marina");
  return panelSession("marina");
}

/** Envejece un medio: lo pone confirmado hace `dias` días. */
async function envejecer(dias: number): Promise<void> {
  await db.query("UPDATE vistta.media SET confirmed_at = $1", [Date.now() - dias * DIA]);
}

describe("aviso de limpieza", () => {
  /*
   * ESTE ES EL PUNTO DE LA FUNCIÓN. El aviso y el borrado tienen que decir el
   * mismo día. Si el aviso fuera por su cuenta, el cliente perdería trabajo
   * justo el día en que el panel le decía que estaba a salvo.
   */
  it("dice el mismo día en que la purga borraría de verdad", async () => {
    const sesion = await cuenta();
    await subirMedio(sesion, "p_marina");
    await envejecer(1);

    const { cuando } = await proximaLimpieza(db, "marina", AVISO);
    expect(cuando).not.toBeNull();

    // Justo antes del día anunciado, la purga no se lleva nada.
    expect((await purgar(db, storage, cuando! - 1000)).mediosCaducados).toBe(0);
    // Justo después, sí.
    expect((await purgar(db, storage, cuando! + 1000)).mediosCaducados).toBe(1);
  });

  it("cuenta cuántos medios están en riesgo dentro del plazo de aviso", async () => {
    const sesion = await cuenta();
    await subirMedio(sesion, "p_marina");
    await subirMedio(sesion, "p_marina");
    // Con 7 días de retención, un medio de hace 5 días caduca dentro de 2:
    // entra en la ventana de aviso de 3 días.
    await envejecer(5);

    const r = await proximaLimpieza(db, "marina", AVISO);
    expect(r.total).toBe(2);
    expect(r.enRiesgo).toBe(2);
  });

  it("un medio recién subido no está en riesgo", async () => {
    const sesion = await cuenta();
    await subirMedio(sesion, "p_marina");

    const r = await proximaLimpieza(db, "marina", AVISO);
    expect(r.total).toBe(1);
    expect(r.enRiesgo).toBe(0);
  });

  /*
   * «Bóveda» no es un plazo muy largo: es la ausencia de plazo. Si el aviso lo
   * tradujera a una fecha lejana, el panel enseñaría una cuenta atrás a un
   * cliente que ha pagado precisamente para no tenerla.
   */
  it("en Bóveda no hay cuenta atrás, porque no hay plazo", async () => {
    const sesion = await cuenta();
    await subirMedio(sesion, "p_marina");
    await envejecer(400);
    await cambiarPlan(db, "marina", "boveda");

    expect(PLANES.boveda.retencionMs).toBeNull();
    const r = await proximaLimpieza(db, "marina", AVISO);
    expect(r.cuando).toBeNull();
    expect(r.enRiesgo).toBe(0);
  });

  /*
   * Un medio que lleva dentro un pase todavía abrible no se borra, así que
   * tampoco se anuncia como en riesgo: ese enlace ya salió y hay que servirlo.
   */
  it("lo que protege un pase vivo no cuenta como en riesgo", async () => {
    const sesion = await cuenta();
    const { mediaId } = await subirMedio(sesion, "p_marina");
    await envejecer(30);
    await db.query(`UPDATE vistta.profiles SET data = $1 WHERE id = 'p_marina'`, [
      JSON.stringify({ sections: [{ type: "galeria", items: [{ mediaId }] }] }),
    ]);
    await createPass(db, { profileId: "p_marina" });

    const r = await proximaLimpieza(db, "marina", AVISO);
    expect(r.enRiesgo).toBe(0);
    // Y la purga tampoco lo toca: las dos dicen lo mismo.
    expect((await purgar(db, storage)).mediosCaducados).toBe(0);
  });
});

describe("la ventana de aviso", () => {
  /*
   * Guardia sobre la cifra en sí. Si alguien sube el aviso por encima de la
   * retención más corta, el panel volvería a gritar todos los días y el aviso
   * dejaría de significar nada.
   */
  it("es menor que la retención más corta, o el aviso no avisa", () => {
    const masCorta = Math.min(
      ...Object.values(PLANES)
        .map((p) => p.retencionMs)
        .filter((r): r is number => r !== null)
    );
    expect(AVISO_LIMPIEZA_MS).toBeLessThan(masCorta);
  });
});
