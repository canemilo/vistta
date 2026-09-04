-- El aspecto con el que se enseña un pase.
--
-- Lo elige QUIEN MANDA el enlace, y por eso viaja en la fila del pase y no en
-- una preferencia del navegador de quien lo abre. Son dos cosas distintas y se
-- confunden fácil:
--
--   * el tema de la APLICACIÓN lo elige cada usuario para su panel, se guarda
--     en su navegador y no sale de ahí;
--   * el tema del PASE es una decisión de presentación sobre el trabajo que se
--     enseña —una serie de fotos nocturnas pide fondo oscuro; unos planos, casi
--     siempre claro— y tiene que verse igual en el móvil de quien lo reciba,
--     tenga puesto lo que tenga.
--
-- El DEFAULT es 'oscuro' porque es como se ha visto Vistta hasta hoy: los pases
-- que ya existen no cambian de aspecto por esta migración.
ALTER TABLE vistta.passes
  ADD COLUMN tema TEXT NOT NULL DEFAULT 'oscuro',
  ADD CONSTRAINT passes_tema_valido CHECK (tema IN ('oscuro', 'claro'));
