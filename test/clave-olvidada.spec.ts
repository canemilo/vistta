import { describe, it, expect, beforeEach } from "vitest";
import { CLAVE, call, callAs, crearAdmin, crearCuenta, db, panelSession, resetDb } from "./helpers";

beforeEach(resetDb);

/**
 * «He olvidado la contraseña».
 *
 * No manda ningún correo, y no puede: el sistema no almacena el correo de sus
 * clientes —no hay columna, y está declarado en `legal/rat.md`—. Deja una marca
 * en la cuenta y un administrador comprueba quién eres por el mismo canal por
 * el que te dio el acceso. La solicitud NO AUTORIZA NADA por sí sola; es el
 * mismo criterio que el código de pago del bloque F.
 */

const pedir = (userId: string, ip = "198.51.100.30") =>
  callAs(ip, "/api/panel/password/olvidada", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });

const cuentas = async (sesion: string, ip = "198.51.100.31") => {
  const res = await callAs(ip, "/api/admin/cuentas", {
    headers: { authorization: `Bearer ${sesion}` },
  });
  return (await res.json()) as { cuentas: { id: string; clavePedidaEl: number | null }[] };
};

describe("solicitar una contraseña nueva", () => {
  it("se puede pedir SIN sesión: quien no puede entrar no tiene ninguna", async () => {
    await crearCuenta("marina", "Marina");
    const res = await pedir("marina");
    expect(res.status).toBe(200);
  });

  it("le sale la marca al administrador, en la fila de esa cuenta", async () => {
    await crearCuenta("marina", "Marina");
    await crearAdmin("soporte");
    const sesionAdmin = await panelSession("soporte", "198.51.100.32");

    await pedir("marina");

    const { cuentas: lista } = await cuentas(sesionAdmin);
    const marina = lista.find((c) => c.id === "marina");
    expect(marina?.clavePedidaEl).toBeTypeOf("number");
  });

  it("responde lo mismo si la cuenta no existe: no es un buscador de usuarios", async () => {
    await crearCuenta("marina", "Marina");
    const existe = await pedir("marina", "198.51.100.33");
    const noExiste = await pedir("nadie-de-nadie", "198.51.100.34");

    expect(existe.status).toBe(noExiste.status);
    expect(await existe.text()).toBe(await noExiste.text());
  });

  it("pedirla cincuenta veces no llena la bandeja de la misma petición", async () => {
    await crearCuenta("marina", "Marina");
    for (let i = 0; i < 4; i++) await pedir("marina", `198.51.100.4${i}`);

    const abiertas = await db.query(
      `SELECT id FROM vistta.password_requests WHERE user_id = 'marina' AND status = 'pendiente'`
    );
    expect(abiertas.rows.length).toBe(1);
  });

  it("la solicitud NO cambia la contraseña ni abre nada", async () => {
    await crearCuenta("marina", "Marina");
    await pedir("marina");

    // La de siempre sigue valiendo: pedirla no es obtenerla.
    const entra = await callAs("198.51.100.44", "/api/panel/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "marina", password: CLAVE }),
    });
    expect(entra.status).toBe(201);
  });

  it("reiniciar la contraseña cierra la solicitud sola", async () => {
    await crearCuenta("marina", "Marina");
    await crearAdmin("soporte");
    const sesionAdmin = await panelSession("soporte", "198.51.100.45");
    await pedir("marina");

    const res = await callAs("198.51.100.46", "/api/admin/cuentas/marina/password", {
      method: "POST",
      headers: { authorization: `Bearer ${sesionAdmin}` },
    });
    expect(res.status).toBe(200);

    // Atender la petición ES cerrarla: si hiciera falta un segundo clic, la
    // marca se quedaría puesta sobre una cuenta ya atendida.
    const { cuentas: lista } = await cuentas(sesionAdmin, "198.51.100.47");
    expect(lista.find((c) => c.id === "marina")?.clavePedidaEl).toBeNull();
  });

  it("se puede descartar sin tocar la contraseña", async () => {
    await crearCuenta("marina", "Marina");
    await crearAdmin("soporte");
    const sesionAdmin = await panelSession("soporte", "198.51.100.48");
    await pedir("marina");

    const res = await callAs("198.51.100.49", "/api/admin/cuentas/marina/solicitud", {
      method: "DELETE",
      headers: { authorization: `Bearer ${sesionAdmin}` },
    });
    expect(res.status).toBe(200);

    const { cuentas: lista } = await cuentas(sesionAdmin, "198.51.100.50");
    expect(lista.find((c) => c.id === "marina")?.clavePedidaEl).toBeNull();
    // Y la contraseña de siempre sigue valiendo: descartar no reinicia nada.
    const entra = await callAs("198.51.100.51", "/api/panel/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "marina", password: CLAVE }),
    });
    expect(entra.status).toBe(201);
  });

  it("descartar no lo puede hacer un cliente", async () => {
    await crearCuenta("marina", "Marina");
    await pedir("marina");
    const sesionCliente = await panelSession("marina", "198.51.100.52");

    // 404 y no 403: a quien no es administrador no se le confirma que la ruta
    // exista, como en todo /api/admin/*.
    const res = await callAs("198.51.100.53", "/api/admin/cuentas/marina/solicitud", {
      method: "DELETE",
      headers: { authorization: `Bearer ${sesionCliente}` },
    });
    expect(res.status).toBe(404);
  });

  it("hay límite: no se puede usar para sondear identificadores sin parar", async () => {
    await crearCuenta("marina", "Marina");
    const codigos: number[] = [];
    for (let i = 0; i < 8; i++) {
      codigos.push(
        (
          await call("/api/panel/password/olvidada", {
            method: "POST",
            headers: { "content-type": "application/json", "X-Forwarded-For": "198.51.100.60" },
            body: JSON.stringify({ userId: `prueba-${i}` }),
          })
        ).status
      );
    }
    expect(codigos).toContain(429);
  });
});
