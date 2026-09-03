-- La referencia del destinatario, para que la marca de agua diga a quién se le
-- enseñó esto.
--
-- Lo que cambia de naturaleza aquí: hasta ahora la marca llevaba el pase y la
-- hora, y por eso Vistta NO SABÍA QUIÉN abría un enlace —está escrito así en
-- `legal/rat.md` y en la EIPD—. Esto sigue siendo cierto: Vistta sigue sin
-- saberlo. Lo que cambia es que el CLIENTE puede escribir a quién se lo mandó,
-- y entonces esa referencia es un dato personal de un TERCERO que el cliente
-- introduce y del que el cliente es responsable.
--
-- Consecuencias que no son opcionales, y que van con esta migración:
--   - no aparece en logs (los logs registran método, patrón de ruta y tipo de
--     error, y así siguen);
--   - no sale por la API más que a quien es dueño del pase;
--   - se borra con el pase, sin excepción (ON DELETE CASCADE ya lo garantiza
--     para pass_media; aquí van en la propia fila, así que se van con ella).
ALTER TABLE vistta.passes
  -- Lo que el cliente escribe: un correo, un teléfono, un nombre de empresa.
  -- Vistta no lo valida ni lo usa para nada más: solo lo pinta en la imagen.
  ADD COLUMN destinatario_ref TEXT,
  -- Nota privada del cliente para reconocer el pase en su lista. NO se pinta en
  -- ninguna imagen ni sale del panel de su dueño.
  ADD COLUMN destinatario_nota TEXT;

-- Topes de longitud en la base y no solo en Zod: la referencia acaba dentro de
-- un SVG que se compone para Sharp, y una cadena enorme ahí no es un problema
-- de validación, es una imagen que no se dibuja.
ALTER TABLE vistta.passes
  ADD CONSTRAINT passes_destinatario_corto CHECK (
    (destinatario_ref IS NULL OR length(destinatario_ref) <= 120) AND
    (destinatario_nota IS NULL OR length(destinatario_nota) <= 120)
  );
