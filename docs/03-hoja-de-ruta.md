# Hoja de ruta

> **Resumen:** Qué está construido y verificado, qué falta, y en qué orden conviene hacerlo. Con el estado real medido sobre el repositorio, no sobre un plan.

## Método de trabajo

El proyecto avanza por **bloques cerrados**. Un bloque no se da por cerrado
porque el código exista: se cierra cuando cumple su definición de hecho, que
incluye pruebas **verificadas por mutación** —se rompe el código a propósito y
se comprueba que la prueba se pone roja—.

Esa disciplina nació de un fallo real: la primera prueba del consumo del pase
pasaba **aunque el consumo estuviera mal escrito**. Dos peticiones simultáneas
casi nunca se solapan. Desde entonces, todo invariante de concurrencia se prueba
con una **ráfaga de 16 peticiones** y con el pool de conexiones caliente.

## Estado por fases

| Fase                         | Qué entrega                                   | Estado     |
| ---------------------------- | --------------------------------------------- | ---------- |
| **A** Decisiones             | Runtime, base de datos, almacenamiento        | ✅ Cerrada |
| **P0** Higiene               | Línea base verde: CI, migraciones, scripts    | ✅ Cerrada |
| **D0** Núcleo                | Node + Hono + PostgreSQL + Argon2id           | ✅ Cerrada |
| **B+C** Dominio              | Cuentas, sesiones, perfiles, contenido, pases | ✅ Cerrada |
| **D** Medios                 | Subida en dos pasos, marca de agua, cola      | ✅ Cerrada |
| **E** Planes                 | Límites, congelado reversible, purga          | ✅ Cerrada |
| **F** Administración y cobro | Rol admin, auditoría, código de pago          | ✅ Cerrada |
| **G** Frontend               | Panel, viewer, accesibilidad medida           | ✅ Cerrada |
| **H** Producción             | Imágenes, Caddy, R2, copias verificadas       | ✅ Cerrada |
| **I** Cumplimiento           | RGPD, AUP, notice-and-takedown                | ✅ Cerrada |

**El plan original está completo.** Lo que sigue no son fases pendientes: son
decisiones y validaciones que no dependen de escribir más código.

## Lo que falta antes de abrir al público

Ninguna de estas es opcional, y ninguna es trabajo de programación.

### 1. Decisiones del negocio

| Qué                       | Dónde vive          | Por qué importa                                                                                                      |
| ------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Precios definitivos**   | `src/lib/planes.ts` | Hoy son provisionales                                                                                                |
| **`GRACIA_CONGELADO_MS`** | `src/lib/planes.ts` | Hoy 30 días. Cuando vence, se destruye trabajo de un cliente sin vuelta atrás. Es el plazo más delicado del proyecto |

### 2. Estreno de la infraestructura

- **Probar contra R2 de verdad.** El adaptador está escrito y verificado contra
  MinIO, que valida la firma igual, pero **nunca ha hablado con R2**: hace falta
  una cuenta con tarjeta.
- **Levantar el VPS.** La pila entera se ha probado en local; en un servidor, no.

### 3. Cumplimiento

- Rellenar la identidad del titular y el contacto legal en la configuración.
- **Fijar la jurisdicción** del VPS y del bucket, y anotarla en el registro.
- **Guardar el contrato de encargado de cada proveedor.** Un subencargado sin
  contrato es un incumplimiento del art. 28.4, funcione el sistema como funcione.
- Decidir la retención del registro de acceso de Caddy, que sí guarda IP.
- **Revisión de un abogado** de los cuatro textos públicos.

## Después del lanzamiento

Ordenado por cuándo lo pide la realidad, no por lo apetecible:

**Cuando el cobro manual empiece a doler** (orientativamente, más de ~30 clientes
de pago): pasarela de pago. El diseño ya lo contempla —el importe se congela en
la fila del pago y los periodos se encadenan—, así que es sustituir quién
confirma, no rehacer la facturación.

**Cuando el vídeo sea importante para los clientes**: marca de agua en vídeo.
Hoy se sirve sin marca y el panel lo dice. Exige transcodificar, que es un coste
por visita y un trabajo en cola, no un cambio de pantalla.

**Cuando haya más de un administrador**: hoy el rol se concede con un script
desde la máquina que tiene la base, a propósito. Con un equipo, hará falta
revisar si eso sigue siendo cómodo sin abrir una vía de escalada.

**Cuando el volumen lo justifique**: sacar el trabajador a su propio proceso. La
toma de trabajos ya usa `FOR UPDATE SKIP LOCKED`, así que varios trabajadores no
se pisan; es cuestión de arrancarlo aparte.

## Lo que se ha decidido NO hacer

Escrito para no volver a discutirlo cada vez:

- **Analítica de aperturas** (quién abrió, desde dónde). Rompería la propiedad
  de que Vistta no sabe quién es el destinatario, y obligaría a rehacer el
  registro del art. 30, el contrato de encargado y el análisis de riesgos.
- **Registro público.** Las cuentas las crea un administrador porque el producto
  se vende hablando.
- **Recuperación de contraseña por correo.** No se almacena el correo de los
  clientes. Se resuelve con una bandeja de solicitudes.
- **Refactor a «Clean Architecture» por capas nominales.** Lo que hay ya es
  puertos y adaptadores; renombrar carpetas tocaría 40 archivos y no arreglaría
  ningún fallo.
