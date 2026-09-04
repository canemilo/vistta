-- El logotipo del cliente, dentro de la propia fila del perfil.
--
-- Va aquí y no en `vistta.media` a propósito, y por tres razones:
--
--   1. NO se marca al agua. Los medios pasan por `/m/*`, que incrusta la marca
--      de la visita en cada imagen; un logotipo marcado sería absurdo. Meterlo
--      por ese camino habría obligado a una excepción dentro del único sitio
--      que garantiza que todo lo que sale lleva marca, que es justo el sitio
--      donde no conviene tener excepciones.
--   2. NO gasta cuota del plan. La cuota es para el TRABAJO que se enseña; que
--      un cliente no pueda poner su logotipo porque va justo de megabytes sería
--      un límite absurdo.
--   3. Pesa poco de verdad. El servidor lo reduce a 320x120 como mucho y lo
--      guarda en WebP dentro de un data URI, así que viaja con la respuesta del
--      pase y no cuesta una petición más. El tope duro está abajo.
--
-- El CHECK es la red: si algún día el reencodificado se estropeara, la base
-- rechaza un logotipo enorme en vez de dejar que engorde la respuesta de cada
-- apertura de pase.
ALTER TABLE vistta.profiles
  ADD COLUMN logo TEXT,
  ADD CONSTRAINT profiles_logo_pequeno CHECK (logo IS NULL OR length(logo) <= 32768);
