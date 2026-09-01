-- Bloque F — facturación manual (Bizum / PayPal).
--
-- No hay pasarela de pago ni webhook: el dinero llega por Bizum o PayPal y una
-- PERSONA lo concilia. Eso obliga a que exista un identificador que viaje en el
-- concepto de la transferencia y que ate ese ingreso a una cuenta y a un plan:
-- el código VISTTA-XXXXXX.
--
-- El código NO es un secreto. Va escrito en el concepto de un Bizum, así que lo
-- ve el banco, lo ve quien mire el extracto y puede acabar en una captura de
-- pantalla. Por eso conocerlo no autoriza nada: confirmar un pago es una acción
-- de administrador, y lo único que hace el código es decir a qué cuenta
-- corresponde el ingreso que ya se ha visto en el extracto.

-- Hasta cuándo está pagado el plan. NULL = sin caducidad, que es el caso del
-- plan de prueba y el de una cuenta a la que se le haya asignado un plan a mano
-- sin fecha (una cortesía, un acuerdo aparte).
ALTER TABLE vistta.users ADD COLUMN plan_until BIGINT;

-- El índice que usa el trabajo de vencimientos.
CREATE INDEX idx_users_vencimiento ON vistta.users (plan_until)
  WHERE plan_until IS NOT NULL;

CREATE TABLE vistta.payments (
  id          TEXT   PRIMARY KEY,
  -- VISTTA-XXXXXX. Único: es lo que se teclea en el concepto del pago y lo que
  -- se busca al conciliar, así que dos iguales serían dos ingresos confundidos.
  code        TEXT   NOT NULL UNIQUE,
  user_id     TEXT   NOT NULL REFERENCES vistta.users (id) ON DELETE CASCADE,
  plan        TEXT   NOT NULL,
  periodo     TEXT   NOT NULL,
  -- En CÉNTIMOS y entero. Un importe en coma flotante acaba pagando 11.999999.
  importe     INTEGER NOT NULL,
  moneda      TEXT   NOT NULL DEFAULT 'EUR',
  status      TEXT   NOT NULL DEFAULT 'pendiente',
  -- Hasta cuándo vale el código sin pagar. Pasado el plazo se anula solo: si no,
  -- alguien podría pagar dentro de un año con un precio de hace un año.
  expires_at  BIGINT NOT NULL,
  created_at  BIGINT NOT NULL,
  -- Quién lo dio por cobrado, cuándo y por qué vía. Es la parte que convierte
  -- "el plan cambió" en "el plan cambió porque entró este dinero".
  confirmed_at BIGINT,
  confirmed_by TEXT,
  metodo       TEXT,
  nota         TEXT,
  CONSTRAINT payments_plan_valido CHECK (plan IN ('prueba', 'pro', 'boveda')),
  CONSTRAINT payments_periodo_valido CHECK (periodo IN ('mensual', 'anual')),
  CONSTRAINT payments_status_valido CHECK (status IN ('pendiente', 'cobrado', 'anulado')),
  CONSTRAINT payments_importe_no_negativo CHECK (importe >= 0),
  -- Un pago cobrado tiene fecha y responsable. Si el código se equivocara al
  -- confirmar, la base lo rechaza en vez de dejar un ingreso sin dueño.
  CONSTRAINT payments_cobro_coherente CHECK (
    status <> 'cobrado' OR (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)
  )
);

CREATE INDEX idx_payments_usuario ON vistta.payments (user_id, created_at DESC);
-- La consulta del panel de administración: lo que está por cobrar, lo primero.
CREATE INDEX idx_payments_pendientes ON vistta.payments (status, created_at DESC);

ALTER TABLE vistta.payments ENABLE ROW LEVEL SECURITY;
