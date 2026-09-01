-- Bloque E — planes, cuotas y volatilidad.
--
-- Dos ideas, y conviene no mezclarlas:
--
--   1. El PLAN dice cuánto puede tener una cuenta (perfiles, pases a la vez,
--      megabytes) y cuánto se conserva su contenido.
--   2. El ESTADO del perfil dice si ese perfil concreto cuenta hoy. Al bajar de
--      plan no se borra nada: lo que sobra pasa a 'congelado', el cliente elige
--      qué deja activo, y solo si nadie lo rescata en el plazo de gracia se
--      borra. Un cambio de plan no puede destruir trabajo por sorpresa.
--
-- Las cifras NO están aquí: viven en src/lib/planes.ts, que es el único sitio
-- donde se tocan. Aquí solo está la forma.

ALTER TABLE vistta.users
  ADD COLUMN plan       TEXT   NOT NULL DEFAULT 'prueba',
  -- Desde cuándo tiene este plan. La necesita la facturación del bloque F, y
  -- sirve para no aplicar una retención nueva a contenido de la etapa anterior.
  ADD COLUMN plan_since BIGINT NOT NULL DEFAULT 0;

ALTER TABLE vistta.users
  ADD CONSTRAINT users_plan_valido CHECK (plan IN ('prueba', 'pro', 'boveda'));

-- Las cuentas que ya existían empiezan hoy en su plan.
UPDATE vistta.users SET plan_since = (EXTRACT(EPOCH FROM now()) * 1000)::bigint
WHERE plan_since = 0;

ALTER TABLE vistta.profiles
  ADD COLUMN status    TEXT NOT NULL DEFAULT 'activo',
  -- Cuándo se congeló. De aquí sale la fecha de borrado, sumándole la gracia;
  -- guardar la fecha de borrado en vez de esta obligaría a reescribir todas las
  -- filas cada vez que se cambie el plazo.
  ADD COLUMN frozen_at BIGINT;

ALTER TABLE vistta.profiles
  ADD CONSTRAINT profiles_status_valido CHECK (status IN ('activo', 'congelado')),
  -- Un perfil congelado tiene fecha de congelación y uno activo no. Si el
  -- código se equivocara al descongelar, la base lo rechaza en vez de dejar un
  -- perfil activo con una cuenta atrás corriendo por detrás.
  ADD CONSTRAINT profiles_congelado_coherente CHECK (
    (status = 'congelado' AND frozen_at IS NOT NULL) OR
    (status = 'activo'    AND frozen_at IS NULL)
  );

-- El índice que usa la purga: congelados por fecha.
CREATE INDEX idx_profiles_congelados ON vistta.profiles (status, frozen_at);

-- La purga por antigüedad busca medios confirmados hace mucho. El índice
-- incluye el perfil porque la retención sale del plan de su dueño.
CREATE INDEX idx_media_confirmados ON vistta.media (confirmed_at) WHERE status = 'ready';
