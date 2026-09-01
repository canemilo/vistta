import { Hono } from "hono";
import type { Env } from "./env";
import { securityHeaders } from "./lib/security";
import { passes } from "./routes/passes";
import { panel } from "./routes/panel";
import { media } from "./routes/media";
import { profiles } from "./routes/profiles";

const app = new Hono<{ Bindings: Env }>();

app.use("*", securityHeaders());
app.get("/health", (c) => c.json({ ok: true }));
app.route("/", panel);
app.route("/", profiles);
app.route("/", passes);
app.route("/", media);

// Sin PII en los logs: solo método, ruta y tipo de error.
app.onError((err, c) => {
  console.error(`error ${c.req.method} ${new URL(c.req.url).pathname}: ${err.name}`);
  return c.json({ error: "error interno" }, 500);
});

app.notFound((c) => c.json({ error: "no encontrado" }, 404));

export default app;
