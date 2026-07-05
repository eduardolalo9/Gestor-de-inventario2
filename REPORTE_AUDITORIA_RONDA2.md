# Auditoría BarInventory — Ronda 2 (validación de inputs y funciones)

Continuación de `REPORTE_AUDITORIA.md`. Esta ronda se enfocó en: validaciones de inputs,
funciones que no hacen lo que deberían, y una re-verificación de que ningún botón/handler
de la UI apunte a una función inexistente.

---

## 1. Bug confirmado (el del ejemplo que diste)

### 🟠 BUG-INPUT-1 — El input "Botellas Enteras" bloqueaba el flujo de captura
**Archivo:** `index.html` — modal `inventarioModal`, input `#inv_enteras`.
**Este es el input que se abre al tocar un producto en la pantalla de conteo** (Inventario /
Auditoría) — el de mayor uso de toda la app, ya que cada bartender lo usa por cada producto y
cada área.

**Qué pasaba exactamente:**
```html
oninput="if(parseFloat(this.value)<0||isNaN(parseFloat(this.value)))this.value=0;"
```
Este código corre en **cada tecla**. Cuando el bartender borraba el campo para escribir un
número nuevo (ej. borrar "24" para poner "35"), el campo pasaba por un estado intermedio vacío
`""`. `parseFloat("")` es `NaN`, así que la validación forzaba `this.value = 0` **antes** de que
pudiera teclear el siguiente dígito. Resultado: no se podía limpiar el campo con normalidad; el
"0" se auto-insertaba a mitad de la corrección, produciendo valores como "05" o saltos de cursor.
No causaba pérdida de datos (la función que guarda, `saveInventarioModal()`, ya normalizaba bien
al final con `Math.max(0, parseFloat(...) || 0)`), pero sí interrumpía la escritura fluida —
justo el problema que describiste.

**Dato interesante:** ya existía en el propio repo un input casi idéntico (el de "peso de botella
abierta" en `actions.js`) con la versión correcta de esta validación (`this.value=''` en vez de
`this.value=0`), así que la corrección solo necesitaba alinear ambos.

**Corrección aplicada:**
```html
oninput="if(this.value!==''&&(parseFloat(this.value)<0||isNaN(parseFloat(this.value))))this.value='';"
onblur="if(this.value===''||isNaN(parseFloat(this.value))||parseFloat(this.value)<0)this.value=0;"
```
- `oninput` ya no toca el campo mientras está vacío — deja terminar de escribir. Solo limpia una
  entrada claramente inválida o negativa.
- `onblur` normaliza a `0` si el campo queda vacío o inválido al salir de él, así nunca se ve en
  un estado "roto" una vez que el bartender termina de editar.

**Nota técnica al margen:** el comentario `FIX BUG-IDX-4` que ya traía ese mismo `<input>` estaba
escrito **dentro** de la etiqueta (entre `<input` y sus atributos) — HTML inválido que los
navegadores toleran por pura casualidad, pero es arriesgado (un `>` suelto ahí adentro puede
cerrar la etiqueta antes de tiempo y corromper todo lo que sigue). Lo aproveché para sacar ese
comentario y el nuevo fuera de la etiqueta, donde corresponde. Validé el HTML resultante con un
parser para confirmar que la estructura de tags queda balanceada.

---

## 2. Bug menor encontrado al revisar "funciones que no funcionan"

### 🟡 BUG-PROD-1 — Guardar un producto con capacidad/peso en 0 lo guardaba como "sin dato"
**Archivos:** `js/actions.js` (`saveProduct()`) y `js/products.js` (`updateProduct()`).

```js
const capV = parseFloat(_el('productCapacidadMl')?.value) || null;
```
Patrón clásico de JavaScript: `0 || null` da `null`, porque `0` es "falsy". Si alguien guardaba
un producto con Capacidad (mL) = 0, el sistema lo convertía silenciosamente en `null` en vez de
guardar el 0 real.

**Impacto real, siendo honesto:** bajo. Revisé todos los lugares donde se usa `capacidadMl` y
`pesoBotellaLlenaOz` en el proyecto (conversión de botellas, importación de Excel, reportes) y
**todos** ya comparan con `> 0`, así que un valor de `0` se trata exactamente igual que `null` en
la práctica — no cambia ningún cálculo ni pantalla hoy. Lo corregí de todas formas porque es un
bug real (no hace lo que el código aparenta hacer) y evita que rompa algo el día que se agregue
código nuevo que sí distinga `0` de `null`.

**Corrección:** se reemplazó el patrón `parseFloat(x) || null` por un parseo explícito que solo
cae a `null` cuando el campo está vacío o no es un número válido, preservando un `0` real.

---

## 3. Verificación de "funciones que no funcionan" (sin hallazgos adicionales)

Hice un cruce automatizado de **todas** las funciones invocadas desde `onclick`, `onchange`,
`oninput` y `onsubmit` en `index.html` y en los módulos que generan HTML dinámico
(`render.js`, `actions.js`, `audit.js`, `ajustes.js`, `reportes.js`, `notificaciones.js`, `ui.js`)
contra las funciones realmente expuestas en `window.*` (o declaradas como función global). De 53
llamadas distintas, las 53 corresponden a una función real — cero botones/handlers "colgados".

También revisé `js/render.js` (motor de las 7 pantallas) y `js/reportes.js` completos, que no
habían sido cubiertos línea por línea en la ronda anterior. No encontré errores adicionales de
lógica, pérdida de datos ni condiciones de carrera ahí — el mapeo de campos entre
`state.products` (inglés: `name`/`unit`/`group`) y los reportes publicados (español:
`nombre`/`unidad`/`grupo`) es intencional y consistente en ambos sentidos (escritura y lectura),
no es un bug aunque a primera vista parezca un desajuste de nombres.

---

## 4. Recomendaciones adicionales de esta ronda

- **Usabilidad del conteo:** ya que `#inv_enteras` hace `select()` automático al abrir el modal
  (selecciona el valor actual), el primer toque de tecla ya reemplaza todo el contenido sin pasar
  por el bug. El fix de esta ronda cubre el caso, también muy común, de corregir un valor ya
  parcialmente escrito (borrar y volver a teclear).
- **Consistencia de validación:** si en el futuro agregas más campos numéricos con `oninput`,
  usa el patrón ya corregido (no tocar el campo si está vacío; normalizar solo en `onblur`) en vez
  de copiar el patrón antiguo — es fácil de copiar/pegar por error.
- **Linter de HTML:** dado que ya apareció un comentario mal ubicado dentro de una etiqueta,
  vale la pena pasar `index.html` por un validador de HTML (ej. https://validator.w3.org/ o la
  extensión de VS Code) antes de cada release, para detectar este tipo de errores estructurales
  temprano — son fáciles de introducir sin darse cuenta al pegar comentarios largos.

---

## 5. Archivos entregados en esta ronda

| Archivo | Cambio |
|---|---|
| `index.html` | Fix BUG-INPUT-1 (validación de `#inv_enteras` sin bloquear la escritura) + limpieza de comentario mal ubicado |
| `js/actions.js` | Fix BUG-PROD-1 en `saveProduct()` |
| `js/products.js` | Fix BUG-PROD-1 en `updateProduct()` |
| Resto de archivos | Sin cambios en esta ronda (ya corregidos en la ronda 1, ver `REPORTE_AUDITORIA.md`) |

Verificado con `node --check` (JS) y un parser HTML (estructura de tags balanceada, 0 errores)
antes de esta entrega.
