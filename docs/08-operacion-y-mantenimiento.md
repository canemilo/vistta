# Operación y mantenimiento

> **Resumen:** Qué hay que hacer para mantener Vistta en pie: rutinas, copias, incidencias y niveles de servicio. El runbook técnico está en `DESPLIEGUE.md`; esto es lo que lo rodea.

## Qué se opera

Cuatro contenedores en un VPS: Caddy, la API, el trabajador —dentro del proceso
de la API— y PostgreSQL. Los medios viven en Cloudflare R2. El detalle de
puesta en marcha, variables y actualización está en **`DESPLIEGUE.md`**, junto
al código que describe.

## Rutinas

| Cuándo                 | Qué                                                    | Cómo                                    |
| ---------------------- | ------------------------------------------------------ | --------------------------------------- |
| **Diario, automático** | Copia de la base                                       | `scripts/backup.sh` por cron a las 4:15 |
| **Diario, 2 min**      | Mirar solicitudes de contraseña y pagos pendientes     | Panel de administración                 |
| **Semanal, 10 min**    | Revisar que la última copia existe y pesa lo razonable | `ls -la copias/`                        |
| **Mensual, 30 min**    | **Restaurar una copia** en una base de prueba          | Ver abajo                               |
| **Mensual**            | Actualizar imágenes base y volver a desplegar          | `docker build` + `up -d`                |
| **Trimestral**         | Revisar el registro del art. 30 y los subencargados    | `legal/rat.md`                          |
| **Cuando toque**       | Confirmar cobros contra el extracto                    | Panel de administración                 |

### La rutina que más se salta y más importa

**Restaurar una copia, todos los meses.** Una copia que nunca se ha restaurado
no es una copia, es un archivo. El procedimiento está en `DESPLIEGUE.md` y ya se
ha probado: restaura 11 tablas y las filas vuelven.

El script **comprueba el volcado antes de rotar**: si no se puede leer, sale con
error y no borra nada. Al revés, una noche con la base caída se llevaría por
delante las copias buenas.

> **Las copias NO incluyen los medios**, que viven en R2 con su propio
> versionado. Una restauración de la base sin los medios deja perfiles apuntando
> a objetos que puede que ya no estén.

## Niveles de servicio

Lo que se puede sostener con esta arquitectura y este tamaño de equipo. **No es
un SLA contractual** mientras no se firme como tal en un encargo.

| Concepto                              | Objetivo           | Cómo se mide                      |
| ------------------------------------- | ------------------ | --------------------------------- |
| Disponibilidad                        | ~99 % mensual      | Comprobación externa de `/health` |
| RPO (dato máximo que se puede perder) | **24 h**           | Frecuencia de la copia            |
| RTO (tiempo hasta volver)             | **4 h laborables** | Restaurar + levantar              |
| Respuesta a incidencia crítica        | 4 h laborables     | Desde el aviso                    |
| Respuesta a incidencia normal         | 2 días laborables  | Desde el aviso                    |
| Aviso de contenido (acuse)            | 72 h hábiles       | `legal/aup.md`                    |
| Aviso de contenido (decisión)         | 7 días hábiles     | `legal/aup.md`                    |
| Tolerancia cero (CSAM, no consentido) | **Inmediato**      | Sin plazo previo                  |

**El RPO de 24 h es una decisión, no un descuido.** Bajarlo exige archivado
continuo (WAL) y un sitio donde ponerlo. Conviene revisarlo cuando haya clientes
de pago cuyo trabajo no esté también en su disco.

## Clasificación de incidencias

| Nivel       | Qué es                                                       | Ejemplos                                        | Respuesta                                |
| ----------- | ------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------- |
| **Crítica** | El servicio no funciona o hay riesgo de pérdida o filtración | Base caída; un cliente ve datos de otro; brecha | 4 h laborables, se avisa a los afectados |
| **Alta**    | Una función principal no funciona                            | No se pueden generar pases; las subidas fallan  | 1 día laborable                          |
| **Normal**  | Molesto pero hay forma de seguir                             | Un botón no responde; un texto mal              | 2 días laborables                        |
| **Mejora**  | Nada está roto                                               | «Estaría bien poder…»                           | Se valora en el siguiente encargo        |

## Qué hacer ante una brecha

1. **Contener**: suspender lo que haya que suspender, revocar sesiones.
2. **Registrar** qué pasó, a qué afecta y desde cuándo.
3. **Avisar a los clientes afectados sin dilación indebida**, con lo que se sepa
   aunque la investigación no esté cerrada. Como **encargado**, Vistta avisa al
   cliente; **la notificación a la AEPD en 72 h le corresponde al cliente**, que
   es el responsable. Ver `legal/encargado.md`, punto 9.
4. **Corregir** y dejar una prueba que se ponga roja si vuelve.

## Comprobaciones después de cada despliegue

```bash
curl -sI https://TU-DOMINIO/ | grep -i content-security-policy   # script-src 'self'
curl -s  https://TU-DOMINIO/health                               # {"ok":true}
curl -s  https://TU-DOMINIO/api/legal | grep '"completo":true'   # aviso legal puesto
```

Y **a ojo, una vez**: abrir un pase de prueba y mirar que la foto lleva la marca
encima. Es lo único que no detecta ninguna comprobación automática, y es la
mitad del producto.

## Señales de que algo va mal

| Señal                                  | Probable causa                            | Dónde mirar                                                |
| -------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| Las fotos salen sin letras en la marca | Faltan fuentes en la imagen               | La construcción tumba esto: `scripts/comprobar-fuentes.ts` |
| La API reinicia en bucle               | Configuración inválida o base inaccesible | `docker compose logs api`: dice el motivo                  |
| Las subidas fallan con 413             | Cuota del perfil agotada                  | Cuota del plan; el reaper libera a las 24 h                |
| Las subidas fallan con 429             | Demasiadas reservas sin terminar          | Se resuelve solo                                           |
| Un cliente dice que su enlace no abre  | Ya se abrió                               | Es el producto funcionando                                 |
| Certificado caducado                   | Volumen de Caddy perdido                  | `caddy_data` tiene que persistir                           |

## Lo que NO se hace en producción

- **No se edita la base a mano** salvo incidencia, y entonces se anota.
- **No se conceden permisos de administración por HTTP.** Solo con
  `pnpm admin:create` desde la máquina que tiene la base.
- **No se leen contraseñas**: no se puede, y las temporales se generan.
- **No se mira el contenido de los clientes.** Vistta es encargado del
  tratamiento, no espectador. Solo una denuncia lo justifica.
