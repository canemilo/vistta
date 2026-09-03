# Documentación de Vistta

> **Resumen:** Índice de la documentación del proyecto: qué documento sirve para qué, a quién va dirigido y dónde está la versión buena de cada cosa.

Vistta es una herramienta para **presentar trabajo** —portfolio, galería,
documentos— a un cliente concreto mediante un **enlace privado de un solo uso
que caduca al abrirse**.

## Cómo está organizada

El Markdown de esta carpeta es la **única versión buena**: es lo que se revisa,
lo que tiene historial y lo que se puede diferenciar en un commit. Los PDF de
`docs/pdf/` son un derivado, como `dist/`, y se regeneran enteros con:

```
pnpm docs:pdf
```

**No se editan a mano.** Un PDF corregido a mano se separa del texto en la
primera revisión y acaban circulando dos versiones distintas del mismo
documento.

## Qué hay aquí

| Documento                         | Para quién        | Qué responde                                          |
| --------------------------------- | ----------------- | ----------------------------------------------------- |
| `01-como-funciona.md`             | Todos             | Qué hace el producto y qué promete de verdad          |
| `02-propuesta-comercial.md`       | Cliente           | Planes, precios y qué incluye cada uno                |
| `03-hoja-de-ruta.md`              | Cliente y equipo  | Qué está hecho, qué falta y en qué orden              |
| `04-ficha-tecnica.md`             | Técnico y compras | Stack, límites, requisitos y dependencias             |
| `05-arquitectura.md`              | Técnico           | Cómo está construido y por qué así                    |
| `06-casos-de-uso.md`              | Todos             | Actores, casos de uso y flujos principales            |
| `07-manual-del-cliente.md`        | Cliente           | Cómo se usa, paso a paso                              |
| `08-operacion-y-mantenimiento.md` | Técnico           | Despliegue, copias, incidencias y niveles de servicio |
| `09-acuerdos-y-encargos.md`       | Cliente           | Alcance, soporte, cómo se piden cambios               |
| `10-metricas.md`                  | Todos             | Estado medido del proyecto y qué medir del producto   |
| `11-puesta-en-produccion.md`      | Técnico           | Del dominio a Vistta funcionando, paso a paso         |
| `12-vps-produccion.md`            | Técnico           | El VPS concreto: acceso, endurecimiento, Docker y DNS |
| `13-migracion-a-r2.md`            | Técnico           | Bucket, token, verificación y migración de los medios |
| `14-supabase-opcional.md`         | Técnico           | La base fuera de la máquina: cómo, y por qué no       |

## Lo que NO está aquí

Los **textos legales en vigor** viven en `legal/`, no en `docs/`, porque son
documentos con efecto jurídico y no material de presentación:

- `legal/terminos.md`, `legal/privacidad.md`, `legal/encargado.md` y
  `legal/aup.md` son **públicos** y la aplicación los sirve desde ahí.
- `legal/rat.md` (registro del art. 30) y `legal/eipd.md` (análisis de riesgos)
  son **internos**: se entregan a la autoridad de control si los pide.

La documentación operativa del despliegue está en `DESPLIEGUE.md`, en la raíz,
junto al código que describe. El estado de trabajo del equipo, en `HANDOFF.md`.

## Aviso sobre las cifras

Los importes de `02-propuesta-comercial.md` son **provisionales**: están
marcados como tales en el propio documento y en `src/lib/planes.ts`. No se
entregan a un cliente sin revisarlos.

Los textos legales están escritos desde el conocimiento del sistema, que es la
parte que un abogado no puede aportar, pero **les falta la revisión jurídica**,
que es la parte que no puede aportar quien escribió el código.
