-- Modos de expiración del pase.
--
-- Hasta aquí un pase se abría UNA vez. Se añaden dos formas más, pensadas para
-- una negociación de días y no para un vistazo: por número de accesos y por
-- ventana de tiempo desde la primera apertura.
--
-- `modo` nace con DEFAULT 'unico', así que los pases que ya existen no cambian
-- de comportamiento: siguen abriéndose una vez y solo una.
--
-- LA DISTINCIÓN QUE SE CONFUNDE, y por eso está escrita aquí:
--
--   expires_at   = plazo para la PRIMERA apertura. Si nadie abre el enlace
--                  antes, el pase muere sin haberse usado. Es lo de siempre.
--   valido_hasta = a partir de la primera apertura, hasta cuándo se puede
--                  seguir abriendo. Se calcula AL ABRIR, no al crear, porque
--                  la ventana cuenta desde que el destinatario entra.
--
-- No se sustituyen: el primero gobierna hasta que alguien abre, el segundo a
-- partir de ese momento. Aplicar `expires_at` también después rompería el modo
-- 'ventana' entero: el plazo por defecto para abrir son 15 minutos, así que una
-- ventana de 24 h moriría a los 15 minutos de crearse.
ALTER TABLE vistta.passes
  ADD COLUMN modo                TEXT    NOT NULL DEFAULT 'unico',
  ADD COLUMN max_accesos         INTEGER,
  ADD COLUMN accesos_usados      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN ventana_ms          BIGINT,
  ADD COLUMN primera_apertura_at BIGINT,
  ADD COLUMN valido_hasta        BIGINT;

-- Las combinaciones imposibles las rechaza la base, no solo Zod. Mismo criterio
-- que `passes_consumo_coherente`: si alguna vez el código se equivoca, que se
-- note aquí en vez de quedar una fila que nadie sabe interpretar.
--
-- 'accesos' EXIGE ventana_ms, y no es un capricho: sin plazo, un pase de tres
-- accesos que solo se abre una vez se queda abrible para siempre, y como la
-- purga no toca los medios de un pase abrible, ese contenido quedaría
-- inmovilizado contra la retención del plan. Para siempre también.
ALTER TABLE vistta.passes
  ADD CONSTRAINT passes_modo_valido CHECK (modo IN ('unico', 'accesos', 'ventana')),
  ADD CONSTRAINT passes_modo_coherente CHECK (
    (modo = 'unico'   AND max_accesos IS NULL     AND ventana_ms IS NULL) OR
    (modo = 'accesos' AND max_accesos IS NOT NULL AND ventana_ms IS NOT NULL) OR
    (modo = 'ventana' AND max_accesos IS NULL     AND ventana_ms IS NOT NULL)
  ),
  ADD CONSTRAINT passes_accesos_coherentes CHECK (
    accesos_usados >= 0 AND (max_accesos IS NULL OR max_accesos >= 2)
  ),
  -- La ventana solo existe si el pase se ha abierto, y todo pase abierto que
  -- tenga ventana_ms tiene que tenerla calculada. 'unico' se cierra en el acto,
  -- así que ahí valido_hasta se queda en NULL a propósito.
  ADD CONSTRAINT passes_ventana_coherente CHECK (
    (primera_apertura_at IS NULL AND valido_hasta IS NULL) OR
    (primera_apertura_at IS NOT NULL AND (ventana_ms IS NULL OR valido_hasta IS NOT NULL))
  );
