# Propuesta comercial

> **Resumen:** Planes, precios y qué incluye cada uno. Las cifras de límites están fijadas; los importes son provisionales y hay que revisarlos antes de publicarlos.

> ## ⚠ Los importes de este documento son PROVISIONALES
>
> Los **límites** (perfiles, pases, cuota, retención) están fijados y son los que
> aplica el software. Los **precios** son una propuesta de partida y están
> marcados como pendientes de decidir también en el código
> (`src/lib/planes.ts`). No se entregan a un cliente sin revisarlos.

## Los planes

|                             | **Prueba** | **Pro**                  | **Bóveda**               |
| --------------------------- | ---------- | ------------------------ | ------------------------ |
| **Precio mensual**          | 0 €        | 12 €                     | 29 €                     |
| **Precio anual**            | —          | 120 € _(2 meses gratis)_ | 290 € _(2 meses gratis)_ |
| Perfiles activos            | 1          | 3                        | 10                       |
| Pases abiertos a la vez     | 5          | 30                       | ilimitado                |
| Cuota por perfil            | 70 MB      | 200 MB                   | 1 GB                     |
| **Retención del contenido** | 7 días     | 15 días                  | **nunca caduca**         |
| Marca de agua por visita    | sí         | sí                       | sí                       |
| Panel, pases y viewer       | sí         | sí                       | sí                       |

Precios en euros, IVA no incluido. El importe **se congela al pedir el plan**:
si mañana suben los precios, quien pidió el código ayer paga el que se le dijo.

## Qué distingue a cada plan

**Prueba** existe para que se vea funcionando con trabajo de verdad, no con
fotos de ejemplo. Un perfil, cinco pases a la vez y una semana de retención dan
para una entrega completa.

**Pro** es el plan de trabajo: tres perfiles permiten separar líneas —por
ejemplo, «bodas», «producto» y «arquitectura»— y quince días de retención
cubren el ciclo normal de una entrega y su revisión.

**Bóveda** es el único plan donde **el contenido no caduca**, y eso es lo que se
paga. Diez perfiles y pases ilimitados a la vez son para quien presenta a
diario.

## Cómo se cobra

**No hay pasarela de pago, y es deliberado en esta fase.** El cliente pide un
plan, recibe un código `VISTTA-XXXXXX`, lo escribe en el concepto de un Bizum o
un PayPal, y una persona coteja el extracto y lo da por cobrado.

Lo que eso significa para el cliente:

- **No hay domiciliación ni cobro automático**, así que tampoco hay nada que
  cancelar: si no se paga, el plan vence solo.
- **Renovar antes de tiempo encadena** el periodo, no lo reinicia: adelantarse
  no cuesta días.
- **Cambiar de plan empieza de cero**, porque es otro producto.
- **Vencer no borra nada**: la cuenta baja a Prueba y lo que sobre se congela,
  recuperable pagando. Lo único irrecuperable es el tiempo.

Y lo que significa para quien opera Vistta: el cobro es una acción manual, con
una persona mirando un extracto. Es sostenible con decenas de clientes, no con
miles. **Cuándo pasar a una pasarela** está en la hoja de ruta.

## Lo que NO se cobra aparte

- El tráfico de las visitas.
- Los pases generados.
- El almacenamiento dentro de la cuota del plan.
- Las actualizaciones del producto.

## Cómo se contrata

Las cuentas **las crea un administrador**: no hay registro público. Es una
decisión de producto, no una carencia —el producto se vende hablando con el
cliente, no por autoservicio— y tiene una consecuencia que conviene conocer: el
alta y la recuperación de contraseña pasan por una persona.

## Comparación honesta con la alternativa

|                    | Enlace de Drive / WeTransfer | Vistta                            |
| ------------------ | ---------------------------- | --------------------------------- |
| Se puede reenviar  | Sí, indefinidamente          | El segundo que lo abra no ve nada |
| Caduca             | Solo si te acuerdas          | Por diseño, según el plan         |
| Marca de la visita | No                           | Incrustada en los píxeles         |
| Presentación       | Carpeta de archivos          | Documento compuesto               |
| Impide capturas    | No                           | **Tampoco**                       |
| Precio             | Incluido en otro producto    | 12–29 €/mes                       |

La última fila es la importante: si lo que se necesita es impedir que alguien
copie una imagen, **ningún producto puede hacerlo**, y Vistta tampoco. Lo que
cambia es que aquí queda registrado de qué visita salió cada copia.
