# Documentación legal y de cumplimiento

Estos documentos describen **el sistema que hay en este repositorio**, no una
plantilla. Cuando el código cambia, cambian ellos: cada versión tiene su commit.

## Qué es cada cosa

| Documento       | Público | Para qué                                                                                                        |
| --------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `terminos.md`   | Sí      | Términos del servicio. Incluye por referencia la AUP y el contrato de encargado.                                |
| `privacidad.md` | Sí      | Qué hace Vistta con los datos **de sus clientes** (Vistta como responsable).                                    |
| `encargado.md`  | Sí      | Contrato del art. 28 sobre el **contenido** que suben los clientes (Vistta como encargado).                     |
| `aup.md`        | Sí      | Qué no se puede subir y cómo se avisa de un contenido (notice-and-takedown).                                    |
| `rat.md`        | **No**  | Registro de actividades del art. 30. Interno; se entrega a la AEPD si lo pide.                                  |
| `eipd.md`       | **No**  | Análisis del art. 35: por qué hoy no hace falta una evaluación de impacto, y el análisis de riesgos igualmente. |

## Los dos papeles, que no se mezclan

- Sobre **los datos de la cuenta** (quién contrata, qué plan, qué pagó), Vistta es
  **responsable**. → `privacidad.md`
- Sobre **el contenido que se sube**, el responsable es el **cliente** y Vistta es
  **encargado**. → `encargado.md`

Confundirlos es el error más común en este tipo de servicio, y cambia quién
responde ante quién.

## Marcadores que hay que rellenar antes de publicar

Los documentos llevan estos marcadores, que salen de la configuración del
despliegue y **no se escriben a mano en el texto**:

- `TITULAR_NOMBRE` — nombre o razón social de quien explota el servicio
- `TITULAR_IDENTIFICACION` — NIF o CIF
- `TITULAR_DIRECCION` — domicilio a efectos de notificaciones
- `CONTACTO_LEGAL` — correo para privacidad y avisos de contenido

Ver `DESPLIEGUE.md`. La API los expone en `GET /api/legal`, y **si no están
configurados, la aplicación lo dice en vez de enseñar un documento con huecos**.

## Antes de abrir el servicio al público

Esto no está hecho y sin ello el despliegue **no está listo para clientes
reales**:

1. **Rellenar los cuatro datos del titular** en la configuración.
2. **Fijar la jurisdicción** del VPS y del bucket de R2, y anotarla en `rat.md`,
   punto D.
3. **Guardar el contrato de encargado de cada proveedor.** Un subencargado sin
   contrato es un incumplimiento del art. 28.4, por bien que funcione el sistema.
4. **No activar el registro de acceso de Caddy.** Comprobado el 2026-09-03: hoy
   no existe —el `Caddyfile` no lleva `log`— y por eso de una visita no queda ni
   IP ni URL. La URL de un pase es la credencial, así que activarlo sin excluir
   `/api/open/*` y `/m/*` guardaría testigos en texto plano. Si se activa, se
   anota en `rat.md`, punto C.
5. **Que un abogado revise estos textos.** Están escritos desde el conocimiento
   del sistema, que es la parte que un abogado no puede aportar, pero la revisión
   jurídica es la que no puede aportar quien escribió el código.
