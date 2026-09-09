-- Integración con el CRM que el agente ya usa. Dos direcciones y dos tablas.
--
-- LOS TIPOS SON LOS DE ESTE PROYECTO, y esto no es un detalle de estilo: los ids
-- son TEXT y los genera la aplicación, las fechas son BIGINT con epoch en
-- milisegundos, y las listas van en JSONB. Una clave ajena con un tipo distinto
-- del de la columna a la que apunta NO APLICA: la migración falla.
--
-- Y lo que NO se añade: `passes.destinatario_ref` ya existe desde la 0008 —es lo
-- que se incrusta en la marca de agua— y es exactamente el dato que el CRM
-- necesita para saber de qué contacto habla un aviso. Se reutiliza. Una segunda
-- columna con el mismo significado acaba con las dos a medio rellenar y nadie
-- sabiendo cuál manda.

-- ---------------------------------------------------------------------------
-- ENTRANTES: el CRM le pide a Vistta que genere un pase.
-- ---------------------------------------------------------------------------
--
-- El token viaja en la URL porque un CRM no puede iniciar sesión. Eso lo
-- convierte en una credencial que puede acabar escrita en el registro de un
-- tercero, así que se trata como el token de un pase: en la base vive SOLO su
-- hash, se enseña una vez al crearlo y no se puede volver a ver. Lo que se hace
-- con una credencial que se ha podido filtrar es revocarla, y para eso está
-- `revoked_at` y el `last_used_at` que permite darse cuenta.
CREATE TABLE vistta.webhooks_entrada (
  id           TEXT   PRIMARY KEY,
  owner_id     TEXT   NOT NULL REFERENCES vistta.users (id) ON DELETE CASCADE,
  -- A qué dosier crea pases. Puede ir en blanco: entonces lo dice la petición,
  -- y se comprueba que sea del mismo dueño.
  profile_id   TEXT   REFERENCES vistta.profiles (id) ON DELETE CASCADE,
  token_hash   TEXT   NOT NULL UNIQUE,
  nombre       TEXT   NOT NULL,
  created_at   BIGINT NOT NULL,
  revoked_at   BIGINT,
  last_used_at BIGINT,
  CONSTRAINT webhooks_entrada_nombre_razonable CHECK (length(nombre) BETWEEN 1 AND 80)
);

CREATE INDEX idx_webhooks_entrada_duenyo ON vistta.webhooks_entrada (owner_id);

-- ---------------------------------------------------------------------------
-- SALIENTES: Vistta avisa al CRM.
-- ---------------------------------------------------------------------------
--
-- `secreto` se guarda EN CLARO, y es la única credencial del proyecto que no se
-- hashea. No es un descuido: con un hash no se puede firmar. Es una clave de
-- HMAC compartida, hace falta entera para calcular la firma de cada envío, y el
-- CRM tiene la misma del otro lado. Lo que sí se hace es no devolverla nunca
-- después de crearla: se enseña una vez, como el token.
CREATE TABLE vistta.webhooks_salida (
  id           TEXT    PRIMARY KEY,
  owner_id     TEXT    NOT NULL REFERENCES vistta.users (id) ON DELETE CASCADE,
  target_url   TEXT    NOT NULL,
  secreto      TEXT    NOT NULL,
  -- Qué avisos quiere. JSONB como el resto del repositorio, no TEXT[].
  eventos      JSONB   NOT NULL DEFAULT '["apertura","reapertura"]'::jsonb,
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   BIGINT  NOT NULL,
  -- Cuántos envíos seguidos han fallado. Pasado el tope, se apaga solo Y se
  -- avisa en el panel: un webhook roto en silencio es peor que no tenerlo.
  fallos       INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  last_sent_at BIGINT,
  CONSTRAINT webhooks_salida_url_https CHECK (target_url LIKE 'https://%'),
  CONSTRAINT webhooks_salida_fallos_positivos CHECK (fallos >= 0)
);

CREATE INDEX idx_webhooks_salida_duenyo ON vistta.webhooks_salida (owner_id);
