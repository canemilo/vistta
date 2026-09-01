-- Solicitudes de contraseña nueva.
--
-- No hay «he olvidado mi contraseña» por correo, y no por falta de ganas: el
-- sistema NO ALMACENA el correo de sus clientes —no hay columna, y eso está
-- escrito en el registro del art. 30 y en la política de privacidad—, así que
-- un enlace de recuperación por correo exigiría guardar contacto, verificarlo,
-- contratar un proveedor de envío y rehacer los tres documentos legales.
--
-- Lo que sí encaja con este producto, que ya crea cuentas y concilia pagos a
-- mano: el cliente PIDE, y un administrador comprueba quién es por el mismo
-- canal por el que le dio la cuenta y le genera una temporal. La solicitud no
-- autoriza nada por sí sola; es exactamente el mismo criterio que el código de
-- pago del bloque F.

CREATE TABLE vistta.password_requests (
  id          TEXT   PRIMARY KEY,
  -- CASCADE: si la cuenta se borra, su solicitud no tiene ya de quién ser.
  -- A diferencia de `admin_audit`, esto no es historia: es una bandeja.
  user_id     TEXT   NOT NULL REFERENCES vistta.users (id) ON DELETE CASCADE,
  status      TEXT   NOT NULL DEFAULT 'pendiente'
                     CHECK (status IN ('pendiente', 'resuelta', 'descartada')),
  created_at  BIGINT NOT NULL,
  resolved_at BIGINT,
  resolved_by TEXT
);

-- Una sola solicitud abierta por cuenta. Sin esto, pulsar el botón cincuenta
-- veces llena la bandeja del administrador de la misma petición, que es una
-- forma barata de tapar las de verdad.
CREATE UNIQUE INDEX password_requests_una_abierta
  ON vistta.password_requests (user_id)
  WHERE status = 'pendiente';

CREATE INDEX password_requests_pendientes
  ON vistta.password_requests (created_at DESC)
  WHERE status = 'pendiente';

ALTER TABLE vistta.password_requests ENABLE ROW LEVEL SECURITY;
