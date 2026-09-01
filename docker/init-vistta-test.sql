-- Se ejecuta una sola vez, al crear el volumen de Postgres.
-- La base de desarrollo (`vistta`, la que crea POSTGRES_DB) y la de pruebas son
-- distintas a propósito: el arnés hace TRUNCATE entre tests, y con una sola base
-- `pnpm test` se llevaría por delante el contenido de `pnpm db:seed:local`.
CREATE DATABASE vistta_test OWNER vistta;
