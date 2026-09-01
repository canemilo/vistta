-- Bloque F — administración de cuentas.
--
-- Aquí entra la primera pieza del proyecto que ROMPE EL AISLAMIENTO ENTRE
-- INQUILINOS a propósito. Todo lo demás está construido sobre la idea de que
-- ninguna cuenta ve lo de al lado; un administrador sí. Por eso:
--
--   * El rol NO se concede por ninguna ruta HTTP. Se da desde la máquina que
--     tiene la base (`pnpm admin:create`). Un endpoint que otorgue admin es una
--     escalada de privilegios a una llamada de distancia, por muy protegido que
--     esté el día que se escribe.
--   * Todo lo que hace un administrador queda registrado en `admin_audit`.
--     Cuando alguien puede tocar las cuentas de todos, el registro deja de ser
--     una comodidad y pasa a ser parte del control.
--   * El administrador gestiona CUENTAS, no contenido. No hay ninguna ruta que
--     le deje ver las fotos, los perfiles ni los pases de un cliente: Vistta es
--     encargado del tratamiento (RGPD art. 28), no espectador.

ALTER TABLE vistta.users
  ADD COLUMN role         TEXT   NOT NULL DEFAULT 'cliente',
  ADD COLUMN status       TEXT   NOT NULL DEFAULT 'activa',
  -- Cuándo se suspendió. Igual que `profiles.frozen_at`: de aquí sale la fecha
  -- de borrado sumándole la gracia, y así cambiar el plazo no obliga a
  -- reescribir filas.
  ADD COLUMN suspended_at BIGINT;

ALTER TABLE vistta.users
  ADD CONSTRAINT users_role_valido CHECK (role IN ('cliente', 'admin')),
  ADD CONSTRAINT users_status_valido CHECK (status IN ('activa', 'suspendida')),
  -- Misma coherencia que en los perfiles congelados: si el código se equivocara
  -- al reactivar, la base lo rechaza antes que dejar una cuenta activa con una
  -- cuenta atrás corriendo por detrás.
  ADD CONSTRAINT users_suspension_coherente CHECK (
    (status = 'suspendida' AND suspended_at IS NOT NULL) OR
    (status = 'activa'     AND suspended_at IS NULL)
  );

CREATE INDEX idx_users_suspendidas ON vistta.users (status, suspended_at);

-- Registro de lo que hacen los administradores.
--
-- No guarda PII más allá de los identificadores que ya están en `users`: ni
-- contraseñas, ni contenido, ni IPs. `detalle` es para el cambio en sí —de qué
-- plan a cuál, por ejemplo—, no para volcar la fila entera.
CREATE TABLE vistta.admin_audit (
  id         TEXT   PRIMARY KEY,
  -- Ni `admin_id` ni `objetivo` son claves ajenas, y no es un descuido.
  --
  -- Esta tabla es un registro de lo que PASÓ, y lo que pasó no cambia porque
  -- después se borre una cuenta. Con una clave ajena habría que elegir entre
  -- dos cosas malas: CASCADE borraría el registro de un borrado justo al
  -- borrar (que es la acción que más importa conservar), y SET NULL perdería
  -- quién lo hizo. Se guarda el identificador tal cual, como texto histórico.
  admin_id   TEXT   NOT NULL,
  accion     TEXT   NOT NULL,
  objetivo   TEXT,
  detalle    JSONB  NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL
);

CREATE INDEX idx_admin_audit_fecha ON vistta.admin_audit (created_at DESC);
CREATE INDEX idx_admin_audit_objetivo ON vistta.admin_audit (objetivo);

ALTER TABLE vistta.admin_audit ENABLE ROW LEVEL SECURITY;
