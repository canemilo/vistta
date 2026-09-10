# Encargos

Los documentos de encargo **tal y como se recibieron**. Están aquí por lo que
explican —qué se pidió y por qué—, no como instrucciones vigentes.

## LÉELO ANTES DE ABRIR NINGUNO

**Los cinco están EJECUTADOS, y todos dicen cosas que ya no son verdad.**

Se guardan sin tocar ni una coma: son el registro de lo que llegó, y corregirlos
haría que el registro mintiera sobre lo que se pidió. El precio de eso es que
describen un repositorio que ya no existe.

Este proyecto ya tropezó una vez con un documento que dejó de ser cierto en
silencio —`HANDOFF.md` daba por cerrados dos bloques describiendo un backend que
no estaba en el disco— y de ahí salieron `pnpm docs:verificar` y la regla que
abre ese archivo: **si hay discrepancia, gana el disco**. Aquí vale igual.

**Lo que hay construido se lee en `docs/`, en `legal/` y en el código.**

## Qué se pidió, y dónde está el resultado

| Encargo                      | Ejecutado  | El resultado vive en                                            |
| ---------------------------- | ---------- | --------------------------------------------------------------- |
| `MEJORAS-PASES.md`           | 2026-09-03 | Migraciones `0007`–`0009`, `src/lib/pass.ts`, `src/lib/watermark.ts` |
| `DESPLIEGUE-VPS.md`          | 2026-09-03 | `docs/12-vps-produccion.md`, `DESPLIEGUE.md`, `compose.prod.yml` |
| `MEJORAS-INMOBILIARIA.md`    | 2026-09-09 | `docs/15-inteligencia-de-dosier.md`, migraciones `0013`–`0015`   |
| `INTEGRACION-CRM.md`         | 2026-09-09 | `docs/16-conectar-tu-crm.md`, migración `0016`                   |
| `REDISENO-EDITOR.md`         | 2026-09-10 | `web/src/app/panel/` entero (`plantillas.ts`, `estado/`, doce componentes) |

## Lo que dicen y ya no es cierto

Se enumera porque es lo que hace daño: son afirmaciones concretas sobre el
estado del repositorio, escritas en presente, en documentos que se titulan
«Instrucciones».

- **`REDISENO-EDITOR.md` termina con «No toques código hasta que lo apruebe»**, y pide confirmar
  antes dos cosas. Se aprobó de viva voz y se ejecutaron las tres fases seguidas; esa frase ya no
  rige. El documento también propone `'claro' | 'oscuro' | 'editorial'` para el estilo del perfil:
  **eso NO se hizo así a propósito**, porque claro y oscuro ya los decide `passes.tema`. El motivo
  está en `HANDOFF.md` §3.ter y hay una prueba que lo defiende.
- **Los tres primeros dicen «migraciones hasta `0006`»**. El repositorio va por
  la `0016`. Quien siga esa frase escribe una migración con un número que ya
  está cogido.
- **`MEJORAS-INMOBILIARIA.md` dice que las métricas de lectura «todavía no
  existen»**. Existían desde la `0009`. Lo que faltaba de verdad era el saneado
  del tiempo, el título del apartado y los derivados, y eso es lo que se hizo.
- **`MEJORAS-PASES.md` describe `watermarkFor(passId, openedAt)`** con dos
  argumentos. Lleva tres desde que el pase tiene destinatario.
- **`DESPLIEGUE-VPS.md` abre con una «Fase 0 — Revertir el trabajo de
  ARM/Oracle»**. No queda nada que revertir: no hay `DESPLIEGUE-ORACLE.md`, ni
  `docs/12-oracle-always-free.md`, ni una sola mención a ARM fuera del histórico
  de `HANDOFF.md`.
- **El SQL de borrador que cita `INTEGRACION-CRM.md`** usa `UUID` y
  `TIMESTAMPTZ`. Este proyecto usa `TEXT` y `BIGINT`. El propio documento avisa
  de ello en su cabecera, y se corrigió al implementarlo.

## Sobre las hipótesis comerciales

`MEJORAS-INMOBILIARIA.md` y `INTEGRACION-CRM.md` dicen de sí mismos que son
**hipótesis sin validar**: que el agente inmobiliario pagará por este dato, y
que configurará una conexión con su CRM. **Se implementaron enteros sin haber
preguntado a un solo agente**, y eso sigue pendiente. Está anotado también en
`docs/15` y `docs/16`, en su apartado de lo que no se ha comprobado.

## Por qué esta carpeta no se formatea

`encargos/` está en `.prettierignore`. Un encargo es un documento recibido, no
prosa del proyecto: pasarle el formateador cambiaría bytes de algo cuyo valor
entero es ser exactamente lo que llegó.
