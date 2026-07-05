# Auditoría BarInventory — Reporte de errores y correcciones

Repositorio analizado: `eduardolalo9/index` (commit al día de la auditoría).
Alcance: `index.html`, `manifest.json`, `sw.js` (+ `js/sw.js`), `styles.css`, todos los módulos
en `js/`, `firebase-config.js`, `firebase-credentials_example.js`, `firebase.json`,
`firestore.rules`, `firestore_indexes.json`, `README.md`.

**Contexto importante:** este código ya venía con múltiples capas de correcciones documentadas
de auditorías previas (timestamps por producto, guardas `isAdmin()`, listeners idempotentes,
merge aditivo en auditoría, etc.). Esta pasada se enfocó en encontrar lo que **quedó pendiente**,
no en repetir lo ya corregido.

---

## 1. Errores críticos de pérdida de datos (corregidos)

### 🔴 BUG-AUDIT-1 — El reinicio de auditoría borraba el inventario operativo diario
**Archivo:** `js/audit.js` — funciones `auditoriaResetear()` (rama admin) y `applyRemoteReset()`.

**Qué pasaba:** ambas funciones ejecutaban `state.inventarioConteo = {};` junto con el reset de
la auditoría ciega. El problema es que `inventarioConteo` **no es parte de la auditoría** — es el
conteo operativo del día a día (el que alimenta `product.stockByArea`, usado en Inicio, Productos
y Pedidos, sincronizado vía la colección `stockAreas`). Son dos features independientes:

- **Auditoría ciega:** `auditoriaConteo`, `auditoriaConteoPorUsuario`, `auditoriaStatus`.
- **Inventario operativo:** `inventarioConteo` → `stockByArea`.

**Consecuencia real:** cada vez que el admin iniciaba un nuevo ciclo de auditoría (una acción que
en el diálogo de confirmación solo anuncia "se borrarán los conteos de auditoría"), **todos los
dispositivos conectados perdían instantáneamente su inventario diario ya contado** — bartenders
que llevaban horas contando barra1/barra2/almacén se encontraban con todo en cero, sin relación
alguna con la acción que el admin creía estar ejecutando.

**Cómo se detectó:** el propio código ya tenía la versión correcta del reset del lado de Firestore
(`resetConteoAtomicoEnFirestore()` en `sync.js`), que borra únicamente `conteoAreas` y
`conteoPorUsuario` — **nunca** toca `stockAreas`. Eso confirma que el reset local sobre-alcanzaba
por descuido, no por diseño.

**Corrección:** se eliminaron las dos líneas `state.inventarioConteo = {}`. El reset de auditoría
ahora solo toca los campos de auditoría, igual que su contraparte en la nube.

---

### 🔴 BUG-CHUNK-1 — Condición de carrera en el "renombrado" de chunks de Firestore
**Archivo:** `js/sync.js` — función `_writeChunkedSubcollection()` (usada para guardar
`inventoriesChunks` / `ordersChunks`, el historial dividido en documentos de 500 KB).

**Qué pasaba:** el mecanismo de dos fases (escribir `new_chunk_N` → luego renombrar a `chunk_N` y
borrar sobrantes) armaba un **único batch** recorriendo todos los documentos existentes. Para el
mismo ID final (ej. `chunk_0`), el código podía añadir un `delete()` (al procesar el doc viejo
`chunk_0`) **y** un `set()` (al procesar `new_chunk_0`, renombrado). Cuál de las dos operaciones
"ganaba" dependía del orden en que Firestore devuelve los documentos en `colRef.get()` — orden que
la API **no garantiza** sin un `orderBy()` explícito.

**Consecuencia real (peor caso):** si el `delete()` quedaba añadido al batch después del `set()`,
ese chunk terminaba **borrado en vez de actualizado** → pérdida silenciosa de un trozo del
historial de inventarios/pedidos guardado en la nube. El bug no se manifestaba siempre (dependía
del orden interno de Firestore), lo que lo hacía especialmente difícil de detectar en pruebas
manuales.

**Corrección:** se separó la lógica en dos recorridos independientes que garantizan que **ningún
ID de documento recibe `delete()` y `set()` en el mismo batch**: los IDs finales (`chunk_0..N-1`)
solo reciben `set()`; los temporales (`new_chunk_*`) y los sobrantes de un ciclo anterior con más
chunks solo reciben `delete()`. El comportamiento externo es idéntico, pero ahora es determinista.

---

## 2. Errores que rompían el funcionamiento offline (corregidos)

### 🟠 BUG-IDX-7 — Excel (importar catálogo / exportar inventario y auditoría) no funcionaba sin internet
**Archivo:** `index.html`.

**Qué pasaba:** la librería XLSX se cargaba únicamente desde
`cdnjs.cloudflare.com/.../xlsx.full.min.js`. El propio Service Worker **excluye a propósito** los
CDNs externos de su caché (siempre pide versión fresca, política correcta para no servir vendor
libs desactualizadas). Resultado: si la conexión caía antes de que ese script cargara — el
escenario típico de "WiFi inestable en la barra" — `window.XLSX` quedaba `undefined` y tanto
importar el catálogo como exportar Inventario/Auditoría a Excel fallaban.

Lo llamativo es que **ya existía una copia local** de la misma versión (`libs/xlsx.full.min.js`,
0.18.5) en el repositorio, pero nunca se usaba — probablemente una migración a offline que quedó
a medias.

**Corrección:** `index.html` ahora carga `libs/xlsx.full.min.js` (mismo origen). Al ser same-origin,
el Service Worker sí lo cachea con su estrategia normal, y queda disponible offline tras la
primera carga (y desde el primer arranque, ver siguiente punto).

### 🟠 BUG-SW-2 — El PWA dependía de haber tenido internet antes para funcionar offline
**Archivo:** `sw.js`.

**Qué pasaba:** `ASSETS_TO_CACHE` solo precacheaba `./`, `index.html` y `manifest.json`. Todo lo
demás (`styles.css`, los 15 módulos de `js/*.js`, `firebase-config.js`, la librería de Excel)
dependía del "cacheo oportunista" del `fetch` handler — es decir, solo quedaban disponibles
offline **después** de una primera carga exitosa con internet. Si el primer uso del PWA en un
dispositivo/tablet ocurría sin WiFi, la app podía cargar en blanco o sin funciones clave.

Además, `cache.addAll()` es todo-o-nada: si un solo archivo de la lista fallaba (404, ruta mal
escrita), **toda** la instalación del Service Worker fallaba y el PWA quedaba sin ningún soporte
offline.

**Corrección:** se amplió `ASSETS_TO_CACHE` con los 15 módulos JS, `styles.css`,
`firebase-config.js` y `libs/xlsx.full.min.js`, y se cambió `cache.addAll()` por
`Promise.allSettled()` + `cache.put()` por archivo, para que un archivo faltante no tumbe el
precache de los demás. Se subió la versión de caché a `1.2.0` para que los dispositivos ya
instalados recojan el cambio.

---

## 3. Higiene de seguridad y despliegue (corregidos, sin riesgo funcional)

### 🟡 Credenciales reales en el archivo de plantilla
**Archivo:** `firebase-credentials_example.js`.

Este archivo se documenta a sí mismo como "PLANTILLA — NO contiene datos reales", pero contenía
las credenciales reales de producción (`apiKey`, `projectId`, etc. del proyecto
`bar-inventario-1109e`) — exactamente lo que el mecanismo de `firebase-credentials.js` gitignored
está pensado para evitar. También tenía un error de sintaxis (`};a` al final del archivo) que
lo rompería si alguna vez se copiara tal cual.

**Nota importante:** estas mismas credenciales siguen embebidas como *fallback* dentro de
`firebase-config.js`, y **no las tocamos ahí** — `index.html` no carga ningún
`firebase-credentials.js`, así que ese fallback es hoy la única vía por la que la app se conecta a
Firebase en producción. Cambiarlo habría roto la sincronización en vivo. Ver recomendaciones de
seguridad más abajo sobre qué hacer con esto a mediano plazo.

**Corrección:** se reemplazaron los valores reales por placeholders (`REEMPLAZA_TU_...`,
consistente con la validación que ya hace `firebase-config.js`), y se corrigió el error de sintaxis.

### 🟡 Los índices compuestos de Firestore nunca se desplegaban vía CLI
**Archivos:** `firebase.json`, `firestore_indexes.json` → `firestore.indexes.json` (nuevo).

`firebase.json` declara `"indexes": "firestore.indexes.json"` (con punto), pero el archivo
presente en el repo se llamaba `firestore_indexes.json` (con guion bajo) — un nombre que la
Firebase CLI **no busca**. El propio `.gitignore` documentaba (al revés) esta confusión.
Consecuencia: `firebase deploy --only firestore:indexes` no desplegaba los índices que necesitan
las consultas de `notificaciones.js`, `ajustes.js` y `reportes.js` (si esos índices existen hoy en
producción es porque se crearon a mano desde la consola de Firebase, no desde este repo).

**Corrección:** se creó `firestore.indexes.json` con el nombre correcto y el mismo contenido.
Se corrigió el comentario del `.gitignore`. **Acción manual pendiente de tu parte:** borra
`firestore_indexes.json` del repositorio (ya redundante) — no se puede borrar un archivo desde
aquí, solo dejar de usarlo.

---

## 4. Cosas que se revisaron y **ya estaban bien** (para que no las toques por error)

- **Ciclo de vida de los 10 listeners `onSnapshot`** (`sync.js` + `ajustes.js` + `notificaciones.js`
  + `reportes.js`): `startRealtimeListeners()` es idempotente (llama a `stopRealtimeListeners()`
  antes de re-suscribir) y el logout (`cleanupRoles()`) los cierra correctamente. En un dispositivo
  compartido con varios logins/logout durante el turno, no se acumulan listeners duplicados.
- **Guardas de admin** en `deleteAllProducts()`, `resetAllInventario()`: verificadas client-side
  y reforzadas server-side por `firestore.rules` (un bartender no puede escribir el campo
  `products` ni `cart` aunque manipule el cliente).
- **`resetConteoAtomicoEnFirestore()`** (la mitad en la nube del reset de auditoría): correctamente
  acotada a `conteoAreas`/`conteoPorUsuario`, nunca toca `stockAreas`. Esto fue justamente la pista
  que llevó a encontrar BUG-AUDIT-1.
- **Anti-eco de escrituras propias** (`_shouldIgnoreSnapshot`, timestamps `_lastLocalWriteTs` /
  `_lastLocalAreaWireTs`) en los listeners: la lógica para no reprocesar tu propia escritura al
  rebotar desde Firestore está bien implementada.
- **`firestore_indexes.json`** en sí (contenido): los 4 índices compuestos definidos coinciden
  exactamente con las consultas reales del código.

---

## 5. Recomendaciones a mediano/largo plazo

**Rendimiento**
- Los 15 módulos de `js/` se cargan como imports ES individuales (sin bundler). Funciona bien para
  el tamaño actual, pero son ~15 requests HTTP/2 en cascada en la carga inicial. Si el catálogo de
  productos sigue creciendo, considera un build step simple (esbuild/Vite) solo para producción,
  manteniendo los módulos separados en desarrollo.
- `styles.css` (2100+ líneas): revisa si hay reglas duplicadas o específicas de versiones viejas de
  la UI (MYou3) que ya no se usan; un CSS más chico ayuda especialmente en la primera carga en
  redes móviles del bar.

**Seguridad**
- El mecanismo documentado en `firebase-config.js` para mantener las credenciales fuera del repo
  (`firebase-credentials.js` gitignored) **no está conectado**: `index.html` nunca lo carga. Si
  quieres que funcione de verdad, agrega `<script src="firebase-credentials.js"></script>` antes
  de `firebase-config.js`, y sube ese archivo real solo a tu hosting (nunca a git). Mientras tanto,
  como el `apiKey` ya es público en este repo, la protección real recae en `firestore.rules`
  (que están bien) y en la configuración de Firebase Auth: verifica en la consola que el
  registro por email/password no esté abierto a cualquiera — cualquiera que descubra el `apiKey`
  podría auto-registrarse y, según la regla actual de `/usuarios/{uid}`, crear su propio perfil con
  rol `user` y leer todo el inventario. Si tu equipo opera bajo el dominio `institutoulinks.org`,
  vale la pena restringir esa regla de creación de perfil a correos de ese dominio.
- Considera rotar el `apiKey` de Firebase si nunca lo has hecho desde que quedó expuesto en el
  historial de git de un repo público (no es un secreto crítico por diseño de Firebase, pero es
  buena práctica no dejarlo "encontrable" sin necesidad).

**Usabilidad / mantenimiento**
- `README.md` está prácticamente vacío. Vale la pena documentar: cómo desplegar (`firebase deploy`),
  cómo configurar `firebase-credentials.js`, y el mapa de módulos (`js/sync.js` = motor de
  sincronización, `js/audit.js` = auditoría ciega, etc.) para que retomar el proyecto en el futuro
  (o que alguien más lo mantenga) sea más rápido.
- `js/sw.js` es una copia casi idéntica de `sw.js` (raíz) que **no se usa** (`app.js` registra
  `./sw.js`, no `./js/sw.js`). Bórralo para evitar que alguien lo edite pensando que es el activo.
- `js/excel-import.js` está intencionalmente vacío (ya documentado en el propio archivo como
  código muerto). Puedes borrarlo directamente, no aporta nada.
- Los timestamps de conflicto (`_lastModified`, `_ts` por producto) usan `Date.now()` del cliente.
  Esto funciona bien en la práctica, pero si alguna vez notas conteos "perdidos" de forma
  intermitente en dispositivos Android más viejos, revisa el reloj del sistema de esos equipos —
  un reloj desincronizado puede hacer que ese dispositivo "pierda" comparaciones de
  last-write-wins aunque haya escrito después en tiempo real. Migrar a
  `firebase.firestore.FieldValue.serverTimestamp()` eliminaría ese riesgo por completo, aunque es
  un cambio más invasivo que no se incluyó aquí para no arriesgar romper el sistema actual.

---

## 6. Resumen de archivos entregados

| Archivo | Cambio |
|---|---|
| `js/audit.js` | Fix BUG-AUDIT-1 (crítico) |
| `js/sync.js` | Fix BUG-CHUNK-1 (crítico) |
| `index.html` | Fix BUG-IDX-7 (offline Excel) |
| `sw.js` | Fix BUG-SW-2 (precache completo + resiliencia a fallos) |
| `firebase-credentials_example.js` | Placeholders reales + fix de sintaxis |
| `firestore.indexes.json` | **Nuevo** — nombre correcto para que `firebase deploy` lo tome |
| `.gitignore` | Comentario corregido sobre el archivo de índices |
| Resto de archivos (`manifest.json`, `styles.css`, demás `js/*.js`, `firestore.rules`, etc.) | Sin cambios — revisados, sin errores encontrados |

Todos los archivos JS y JSON modificados fueron validados con `node --check` / parseo JSON antes
de esta entrega.
