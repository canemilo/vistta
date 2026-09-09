# Inteligencia de dosier

> **Resumen:** Qué mira quien recibe un dosier, y qué se puede hacer con eso. Tres funciones para el agente inmobiliario —informe al propietario, termómetro de interés y comparativa entre propiedades— con las reglas que las hacen defendibles y las limitaciones que no se ocultan.

## Qué problema resuelve

Un CRM inmobiliario sabe **a quién** se le mandó un dosier. No sabe quién lo
abrió, qué miró dentro ni quién volvió a abrirlo el domingo por la noche. Eso lo
sabe Vistta, porque el dosier lo sirve Vistta.

De ahí salen tres cosas que un agente puede usar el lunes por la mañana:

1. **Informe al propietario** — el papel que se lleva a la reunión de los
   quince días, cuando toca contestar a «¿por qué no se vende mi casa?».
2. **Termómetro de interés** — a quién llamar hoy, y por qué.
3. **Comparativa entre propiedades** — dónde merece la pena el esfuerzo.

En esta funcionalidad, un **perfil** de Vistta es **una propiedad**. No se ha
renombrado nada: el producto sigue sirviendo para enseñar cualquier trabajo, y
esto es una lectura de la misma pieza.

## Lo que se mide, y lo que no

Se mide **tiempo visible agregado por apartado**, más tres marcas: que se abrió,
que se cerró y que se llegó al final. Nada más.

No hay columnas —no es que no se rellenen, es que **no existen**— para IP,
user-agent, resolución, ubicación ni identificador de navegador. Hay una prueba
que falla si alguien las añade. Vistta **no sabe quién abre** un pase: lo que
puede saber, si el agente lo escribe, es a quién dijo que se lo mandaba.

### El tiempo va saneado, y esto decide si el dato sirve

Un número inflado no es «un poco peor» que no tener número: es peor a secas,
porque acaba dicho en voz alta en una llamada de venta. Tres reglas, todas en el
navegador y todas medidas en `web/src/app/viewer/lectura.spec.ts`:

| Regla                                     | Qué evita                                         |
| ----------------------------------------- | ------------------------------------------------- |
| El reloj **para** con la pestaña al fondo | Que una pestaña olvidada cuente como lectura      |
| **Corte al minuto** sin tocar nada        | Que irse a comer con el dosier abierto cuente     |
| **Tope de cinco minutos** por apartado    | Que una foto abierta media hora domine el ranking |

Y aun así: **el tiempo es aproximado**. Lo mide un navegador. El panel y el
informe lo dicen con esas palabras, y por eso todo sale redondeado —«unos tres
minutos»—: la precisión al segundo sugiere una exactitud que no existe.

## 1. Informe al propietario

`GET /api/profiles/:id/informe?desde=&hasta=` · pantalla `/panel/informe/:id`

Sale con la marca del agente —su nombre, su logotipo, su color— para que pueda
reenviarlo tal cual. El PDF lo hace el **«Guardar como PDF» del navegador**, que
es el mismo motor que ya imprime `docs/`: sin librería nueva y sale igual que en
pantalla.

Contiene, por periodo: enviados, abiertos y porcentaje de apertura; tiempo medio
de lectura; **ranking de apartados** y cuáles se saltaron; relecturas; y la
comparación con el periodo anterior.

### Las dos reglas que no se saltan

**Es agregado y anónimo.** Nunca aparece un destinatario concreto:

- ✅ «Enviado a 12 compradores · 9 lo abrieron (75%)»
- ✅ «El 70% se detuvo en Planos; solo 2 llegaron a Precio»
- ❌ «Juan Pérez estuvo 4 minutos»

Por dos razones, y cada una basta: identificar compradores ante un tercero es una
comunicación de datos que nadie ha declarado, y el agente **pierde su papel de
intermediario** el día que el propietario ve la lista de sus clientes.

**Umbral de cuatro lecturas.** Por debajo no se emiten porcentajes: salen los
números absolutos y un aviso. Con dos datos, «el 50%» es ruido con aspecto de
hecho, y además singulariza. El servidor manda esos campos a `null` para que la
interfaz no pueda pintarlos por descuido.

### De la persona propietaria no se guarda nada

Ni nombre, ni correo, ni teléfono. No hay columnas en `vistta.propiedad_meta` y
tampoco campos en el esquema de entrada. El informe se lo entrega el agente por
el canal que ya tiene con ella; Vistta no necesita conocerla, y lo que no se
guarda no se filtra.

## 2. Termómetro de interés

`GET /api/panel/termometro` · pantalla `/panel/actividad`

Las señales, de más a menos predictiva:

1. **Relectura** — volver a abrirlo. La más fuerte.
2. **Llegar al final** — ha visto el precio.
3. **Atención concentrada** en un apartado.
4. **Apertura rápida** tras el envío.

**No hay puntuación del 1 al 100.** Estados cualitativos, y **cada uno dice por
qué lo es**: «Caliente · volvió a abrirlo ayer», «Tibio · lo abrió, pero no llegó
al final». Un número sin explicación no genera confianza ni acción, y encima
invita a leerlo como un juicio sobre una persona.

Y no se perfila a nadie: se describe el comportamiento **sobre ese dosier**,
nunca sobre quien lee.

### Avisos

Cuando alguien vuelve a abrir un dosier, el agente recibe un aviso en el panel.
**Agrupado**: cinco reaperturas dejan un aviso que dice cinco, no cinco avisos.
La agrupación vive en un índice único parcial de la base, no en un `if`, porque
es un tope con un contador y en este proyecto eso significa carrera hasta que se
demuestre lo contrario (hay ráfaga de 16, verificada por mutación).

Se apagan desde la misma pantalla donde se ven.

## 3. Comparativa entre propiedades

`GET /api/panel/comparativa` · pantalla `/panel/actividad`

Una fila por propiedad, ordenable por cualquier columna, con lo que destaca en
positivo **y en negativo**: «apertura muy baja» es tan útil como «la más
abierta», porque sugiere que el problema está en cómo se envía y no en el
inmueble.

**Solo entre propiedades del mismo agente.** Nunca contra datos de otro usuario:
ni crudos, ni en media, ni «anonimizados». Con dos cuentas en la tabla, una media
revela la otra. El filtro por `owner_id` va en el WHERE de la consulta y hay una
prueba que lo comprueba.

Mismo umbral que el informe: sin lecturas suficientes, números absolutos.

## Lo que no se ha podido comprobar aquí

Como en `docs/11`, lo que no se ha probado se dice:

- **El informe no se ha impreso en un PDF real desde un navegador de escritorio
  y un móvil.** Las reglas de `@media print` están escritas y el bloque no parte
  entre páginas por construcción, pero eso se ve imprimiendo.
- **Nadie ha enseñado todavía un informe a un agente inmobiliario de verdad.**
  Toda esta funcionalidad es una **hipótesis comercial sin validar**: que el
  agente pagará por este dato. Lo sensato antes de invertir más es enseñar el
  informe a dos o tres agentes reales; si no les entusiasma, ni el termómetro ni
  la comparativa lo arreglan.
- **El corte por inactividad no se ha medido con personas reales leyendo.** Los
  sesenta segundos son un valor razonado, no observado.

## Dónde está cada cosa

| Qué                     | Dónde                                             |
| ----------------------- | ------------------------------------------------- |
| Saneado del tiempo      | `web/src/app/viewer/lectura.ts`                   |
| Eventos y derivados     | `src/lib/eventos.ts`                              |
| Informe                 | `src/lib/informe.ts`                              |
| Termómetro              | `src/lib/termometro.ts`                           |
| Comparativa             | `src/lib/comparativa.ts`                          |
| Avisos                  | `src/lib/avisos.ts` + migración `0015_avisos.sql` |
| Ficha del inmueble      | `src/lib/propiedad.ts` + `0014_propiedad.sql`     |
| Pruebas                 | `test/inmobiliaria.spec.ts`                       |
| Tratamientos declarados | `legal/rat.md` §B.2 a §B.5                        |
