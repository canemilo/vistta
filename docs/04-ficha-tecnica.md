# Ficha técnica

> **Resumen:** Stack, límites del sistema, dependencias, requisitos de despliegue y lo que hace falta contratar. La hoja de datos del producto.

## Identificación

|                           |                                    |
| ------------------------- | ---------------------------------- |
| **Producto**              | Vistta                             |
| **Tipo**                  | Aplicación web SaaS multiinquilino |
| **Idioma de la interfaz** | Español                            |
| **Repositorio**           | `github.com/canemilo/vistta`       |
| **Licencia del código**   | Privada                            |

## Stack

| Capa           | Tecnología                                   | Por qué esta                                                             |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Lenguaje       | TypeScript (estricto)                        | Un solo lenguaje en todo el proyecto                                     |
| Runtime        | Node 22                                      | Argon2id y Sharp no corren nativos en Workers                            |
| API            | Hono                                         | Ligero, sin magia, `fetch` estándar                                      |
| Base de datos  | PostgreSQL 16                                | Los invariantes del producto son de concurrencia y exigen MVCC real      |
| Migraciones    | node-pg-migrate                              | SQL plano, en el esquema `vistta`                                        |
| Contraseñas    | Argon2id (`@node-rs/argon2`)                 | Precompilado; el hash PHC lleva sal y coste dentro                       |
| Imagen         | Sharp (libvips)                              | Marca de agua incrustada y medida de dimensiones                         |
| Validación     | Zod                                          | Entrada validada en el borde                                             |
| Frontend       | Angular 20 (standalone + signals)            | Dos superficies: panel y viewer                                          |
| Estilos        | Tailwind 4                                   | Sin hoja de estilos propia que mantener                                  |
| Almacenamiento | Puerto `Storage`                             | Adaptadores: R2, Supabase, disco, memoria                                |
| Proxy y TLS    | Caddy 2                                      | Certificados automáticos                                                 |
| Empaquetado    | esbuild                                      | El contenedor corre `node dist/server.js`: no se transpila en producción |
| Pruebas        | Vitest (backend) · Karma + Chrome (frontend) | Contra PostgreSQL real, sin dobles                                       |

## Límites del sistema

### Por archivo

| Tipo   | Tope  | Marca de agua                 |
| ------ | ----- | ----------------------------- |
| Imagen | 10 MB | **Sí**, incrustada por visita |
| PDF    | 15 MB | No                            |
| Vídeo  | 50 MB | No                            |

El tamaño **declarado** por el cliente no vale nada: se valida contra los bytes
reales al confirmar la subida, y el tipo se detecta de los _magic bytes_, no de
la cabecera `Content-Type`.

### Por cuenta, según plan

|                         | Prueba | Pro     | Bóveda        |
| ----------------------- | ------ | ------- | ------------- |
| Perfiles activos        | 1      | 3       | 10            |
| Pases abiertos a la vez | 5      | 30      | sin límite    |
| Cuota por perfil        | 70 MB  | 200 MB  | 1 GB          |
| Retención               | 7 días | 15 días | sin caducidad |

> «Ilimitado» y «nunca» se escriben como ausencia de límite en el código, no
> como un número grande. Un tope enorme sigue siendo un tope y alguien acabaría
> comparándolo o sumándolo.

### Plazos

| Qué                                     | Cuánto                             | Dónde se cambia          |
| --------------------------------------- | ---------------------------------- | ------------------------ |
| Pase sin abrir                          | 15 minutos                         | `src/lib/pass.ts`        |
| Sesión del panel                        | 8 horas                            | `src/lib/auth.ts`        |
| Gracia de perfil congelado              | 30 días **(pendiente de decidir)** | `src/lib/planes.ts`      |
| Aviso antes de purgar                   | 7 días                             | `src/lib/planes.ts`      |
| Código de pago sin pagar                | 14 días                            | `src/lib/planes.ts`      |
| Reserva de subida sin confirmar         | ver `TTL_RESERVA_MS`               | `src/lib/media-store.ts` |
| Medio sin referencias antes de borrarse | 24 horas                           | `src/lib/reaper.ts`      |
| Copias de seguridad conservadas         | 14 días                            | `scripts/backup.sh`      |

### Escala razonable de esta arquitectura

| Dimensión             | Cómodo              | Empieza a doler | Qué hacer entonces                                      |
| --------------------- | ------------------- | --------------- | ------------------------------------------------------- |
| Cuentas de pago       | decenas             | ~30+            | Pasarela de pago                                        |
| Aperturas simultáneas | decenas por segundo | cientos         | Cachear no vale: la marca es por visita. Escalar la API |
| Medios por perfil     | cientos             | miles           | Paginar el panel                                        |
| Procesos de API       | 1                   | —               | El trabajador ya soporta varios (`SKIP LOCKED`)         |

**El cuello de botella conocido**: cada visita a una imagen la decodifica, la
marca y la recodifica en el servidor, y **no se puede cachear**, porque una
respuesta guardada sería la marca de otra visita. Es el precio de que «marca de
agua por visita» sea verdad y no marketing.

## Dependencias de ejecución

Cinco, y ninguna por comodidad:

| Paquete             | Para qué                | Se podría quitar                  |
| ------------------- | ----------------------- | --------------------------------- |
| `hono`              | Enrutado HTTP           | No                                |
| `@hono/node-server` | Adaptador a Node        | No                                |
| `pg`                | Cliente de PostgreSQL   | No                                |
| `sharp`             | Marca de agua y medidas | No: es media función del producto |
| `@node-rs/argon2`   | Hash de contraseñas     | No                                |
| `zod`               | Validación de entrada   | Con esfuerzo, a mano              |
| `node-pg-migrate`   | Migraciones             | Solo en el arranque               |

**No se usa el SDK de AWS** para R2 ni `@supabase/supabase-js`: de cada uno se
usarían tres llamadas y arrastran decenas de dependencias a una imagen que se
despliega. La firma SigV4 está escrita a mano y verificada contra MinIO.

## Qué hay que contratar

| Servicio            | Para qué             | Coste orientativo     | Tarjeta |
| ------------------- | -------------------- | --------------------- | ------- |
| VPS (2 vCPU / 4 GB) | Aplicación y base    | 10–20 €/mes           | Sí      |
| Cloudflare R2       | Medios en producción | Por uso; **egreso 0** | Sí      |
| Dominio             | —                    | ~12 €/año             | Sí      |
| Let's Encrypt       | Certificados         | Gratis                | No      |

R2 se elige por el **egreso**: cada visita relee el original para marcarlo, y un
proveedor que cobre el tráfico de salida cobraría ese diseño dos veces.

## Requisitos del servidor

- Linux con Docker y Docker Compose.
- Puertos 80 y 443 abiertos; el dominio apuntando a la IP.
- 2 vCPU y 4 GB de RAM como punto de partida. Sharp es lo que consume: el tope
  de píxeles de entrada está limitado para que un archivo pequeño no pueda
  reventar la memoria al descomprimirse.
- Disco: la base es pequeña; los medios viven en R2.

## Requisitos del navegador

Navegadores con soporte de `<dialog>` y `aspect-ratio`: Chrome, Edge, Firefox y
Safari en versiones de los últimos dos años. **JavaScript es obligatorio**: el
panel y el viewer son aplicaciones cliente.

## Accesibilidad, medido

Lighthouse sobre el **build de producción**, no sobre el servidor de desarrollo:

| Superficie         | Accesibilidad | Buenas prácticas | SEO |
| ------------------ | ------------- | ---------------- | --- |
| Panel              | 100           | 100              | 63  |
| Documento del pase | 100           | 100              | —   |

El **63 de SEO es correcto y debe seguir así**: lo único que falla es
`is-crawlable`, o sea el `noindex`, que está puesto a propósito en tres sitios.
Un buscador que encontrara un pase y lo abriera lo consumiría.
