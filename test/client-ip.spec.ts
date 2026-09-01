import { describe, it, expect } from "vitest";
import { resolverIp } from "../src/lib/client-ip";

/**
 * Fallo §3.6 del HANDOFF, cerrado con test. En Workers `CF-Connecting-IP` la
 * ponía Cloudflare y era de fiar; en Node, `X-Forwarded-For` la escribe quien
 * quiera. Si se hiciera caso a ciegas, cambiar la cabecera en cada intento
 * bastaría para saltarse el límite del login.
 */
describe("identidad del cliente para el rate limit", () => {
  it("sin proxy de confianza, X-Forwarded-For se ignora del todo", () => {
    const ip = resolverIp({
      socketAddress: "203.0.113.7",
      forwardedFor: "1.1.1.1",
      trustProxy: false,
    });
    expect(ip).toBe("203.0.113.7");
  });

  it("sin proxy de confianza, falsear la cabecera no cambia la identidad", () => {
    const identidades = ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((falsa) =>
      resolverIp({ socketAddress: "203.0.113.7", forwardedFor: falsa, trustProxy: false })
    );
    // Tres intentos, una sola identidad: el contador del rate limit los suma.
    expect(new Set(identidades).size).toBe(1);
  });

  it("con proxy de confianza se toma la última entrada, que es la que él añade", () => {
    // El cliente manda "9.9.9.9"; el proxy añade el peer real al final.
    const ip = resolverIp({
      socketAddress: "10.0.0.1",
      forwardedFor: "9.9.9.9, 198.51.100.4",
      trustProxy: true,
    });
    expect(ip).toBe("198.51.100.4");
  });

  it("con proxy de confianza pero sin cabecera, cae al socket", () => {
    expect(
      resolverIp({ socketAddress: "198.51.100.9", forwardedFor: undefined, trustProxy: true })
    ).toBe("198.51.100.9");
  });

  it("sin socket ni cabecera, una identidad estable en vez de undefined", () => {
    expect(resolverIp({ socketAddress: null, forwardedFor: undefined, trustProxy: false })).toBe(
      "desconocido"
    );
  });
});
