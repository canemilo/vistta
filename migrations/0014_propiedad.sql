-- La ficha de la propiedad, para el informe al propietario.
--
-- POR QUÉ EN TABLA APARTE Y NO EN `vistta.profiles`, que era la otra opción:
--
--   1. `profiles` es genérico. En este producto un perfil es «un dosier», y da
--      igual que dentro haya un piso, una reforma o un porfolio de fotografía.
--      `referencia` y `exclusiva_desde` son vocabulario de UNA vertical. Metidos
--      en la tabla del núcleo se quedan ahí para siempre, y el día que la
--      vertical no sea la buena hay que migrar la tabla que abre cada pase.
--   2. `profiles` se lee en el camino caliente —cada apertura de pase, cada
--      comprobación de cuota— y nada de ese camino usa estos tres campos.
--   3. La ausencia de fila es el estado normal: la mayoría de los dosieres no
--      son inmuebles. Tres columnas nulas en todas las filas dicen menos que una
--      tabla que solo existe cuando alguien la rellena.
--
-- Y LO QUE NO HAY AQUÍ, que es tan decisión como lo que hay: NO se guarda el
-- nombre, ni el correo, ni el teléfono del propietario del inmueble. El informe
-- se lo entrega el agente por su cuenta; Vistta no necesita saber quién es. Es
-- el mismo criterio con el que no se guarda el correo de los clientes.
-- Añadir esas columnas obliga a rehacer `legal/rat.md` y la EIPD antes.
CREATE TABLE vistta.propiedad_meta (
  -- 1:1 con el dosier, y se va con él. Sin id propio: no es una entidad, es
  -- una extensión de la que ya hay.
  profile_id       TEXT PRIMARY KEY REFERENCES vistta.profiles (id) ON DELETE CASCADE,
  -- Referencia interna del inmueble en el CRM del agente. Es SUYA, no nuestra.
  referencia       TEXT,
  -- Nota del agente para el agente. No sale de su panel y no entra en el
  -- informe: si entrara, sería texto libre viajando a un tercero.
  propietario_nota TEXT,
  -- Desde cuándo tiene la exclusiva. Es lo que da sentido al periodo del
  -- informe: «lo que ha pasado desde que me lo diste».
  exclusiva_desde  BIGINT,
  actualizado_en   BIGINT NOT NULL,
  CONSTRAINT propiedad_referencia_razonable
    CHECK (referencia IS NULL OR length(referencia) <= 80),
  CONSTRAINT propiedad_nota_razonable
    CHECK (propietario_nota IS NULL OR length(propietario_nota) <= 2000)
);
