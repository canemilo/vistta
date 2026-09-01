import { Hono } from "hono";
import type { AppEnv, Deps } from "./deps";
import { securityHeaders } from "./lib/security";
import { direccionDelSocket, resolverIp } from "./lib/client-ip";
import { passesRoutes } from "./routes/passes";
import { panelRoutes } from "./routes/panel";
import { mediaRoutes } from "./routes/media";
import { profilesRoutes } from "./routes/profiles";
import { adminRoutes } from "./routes/admin";
import { billingRoutes } from "./routes/billing";

/**
 * Monta la app con sus dependencias ya resueltas. En Workers esto era un módulo
 * con `export default app` y el runtime inyectaba los bindings en `c.env`; en
 * Node `c.env` no son bindings, así que la app se construye con lo que necesita.
 * De paso, el arnés de pruebas monta la misma app con otra base y otro Storage.
 */
export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use("*", securityHeaders());

  // La identidad del cliente se resuelve una vez por petición y viaja en el
  // contexto: así ninguna ruta puede olvidarse de la política de TRUST_PROXY.
  app.use("*", async (c, next) => {
    c.set(
      "ip",
      resolverIp({
        socketAddress: direccionDelSocket(c),
        forwardedFor: c.req.header("X-Forwarded-For"),
        trustProxy: deps.config.TRUST_PROXY,
      })
    );
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", panelRoutes(deps));
  app.route("/", profilesRoutes(deps));
  app.route("/", passesRoutes(deps));
  app.route("/", mediaRoutes(deps));
  app.route("/", billingRoutes(deps));
  app.route("/", adminRoutes(deps));

  // Sin PII en los logs: método, PATRÓN de ruta y tipo de error.
  // El patrón, no la URL: la ruta real es /api/open/<token>, y ese token es una
  // credencial de un solo uso que no puede acabar escrita en ningún log.
  app.onError((err, c) => {
    console.error(`error ${c.req.method} ${c.req.routePath} : ${err.name}`);
    return c.json({ error: "error interno" }, 500);
  });

  app.notFound((c) => c.json({ error: "no encontrado" }, 404));

  return app;
}
