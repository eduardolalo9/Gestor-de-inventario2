// ============================================================
// SERVICE WORKER — BarInventory
// Versión: 1.2.0
// ============================================================

// FIX Fase-2: Una sola constante como fuente de verdad para el nombre del caché.
// Antes había CACHE_NAME='bar-inventory-v2' y CACHE_VERSION='v1.1.0' inconsistentes.
// Si solo se cambiaba uno, el caché del usuario no se invalidaba correctamente.
// FIX BUG-SW-1: CACHE_NAME y CACHE_VERSION unificados en una sola constante.
const CACHE_NAME = 'bar-inventory-v1.2.0';

// Archivos que se guardan para funcionar sin internet
//
// FIX BUG-SW-2 (offline en primer uso): antes solo se precacheaban './',
// './index.html' y './manifest.json'. styles.css y todos los módulos de
// js/*.js (además de firebase-config.js y la librería local de Excel)
// dependían de que el usuario tuviera internet la PRIMERA vez que abría la
// app para que el "cacheo oportunista" del fetch handler los guardara.
// Si el primer uso ocurría con la barra sin WiFi, la app cargaba en blanco
// o sin estilos/funciones. Ahora se precachean explícitamente en la
// instalación, así el PWA queda 100% operativo offline desde el primer
// arranque, sin depender de haber tenido conexión antes.
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './firebase-config.js',
  './libs/xlsx.full.min.js',
  './js/app.js',
  './js/state.js',
  './js/constants.js',
  './js/storage.js',
  './js/auth.js',
  './js/auth-roles.js',
  './js/sync.js',
  './js/audit.js',
  './js/products.js',
  './js/actions.js',
  './js/render.js',
  './js/ui.js',
  './js/ajustes.js',
  './js/reportes.js',
  './js/notificaciones.js'
];

// ── Instalación ──────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Instalando versión:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Guardando archivos en caché');
        // FIX BUG-SW-2: addAll() es todo-o-nada — si UN solo archivo de la
        // lista falla (404, typo de ruta, etc.) toda la instalación fallaba
        // y la app se quedaba SIN service worker (sin offline en absoluto).
        // Se usa Promise.allSettled + cache.put por archivo para que un
        // archivo faltante no tumbe el precache de todos los demás.
        return Promise.allSettled(
          ASSETS_TO_CACHE.map(url =>
            fetch(url).then(resp => {
              if (resp && resp.ok) return cache.put(url, resp);
              console.warn('[SW] No se pudo precachear (respuesta no OK):', url);
            }).catch(err => console.warn('[SW] No se pudo precachear:', url, err))
          )
        );
      })
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Error en caché:', err))
  );
});

// ── Activación ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activado:', CACHE_NAME);
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Borrando caché viejo:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ── Interceptar peticiones ───────────────────────────────────
self.addEventListener('fetch', event => {
  // Solo interceptar peticiones GET
  if (event.request.method !== 'GET') return;

  // FIX Fase-2: Ignorar URLs de extensiones del navegador.
  // El SW intentaba cachearlas y fallaba con "Request scheme chrome-extension unsupported".
  const url = event.request.url;
  if (url.startsWith('chrome-extension://') || url.startsWith('chrome://') || url.startsWith('moz-extension://')) return;
  if (
    url.includes('firebaseio.com') ||
    url.includes('googleapis.com') ||
    url.includes('firestore.googleapis.com') ||
    url.includes('identitytoolkit.googleapis.com') ||
    url.includes('cdnjs.cloudflare.com') ||
    url.includes('cdn.tailwindcss.com') ||
    url.includes('gstatic.com') ||
    url.includes('kit.fontawesome.com') ||
    url.includes('use.fontawesome.com') ||
    url.includes('fonts.googleapis.com') ||
    url.includes('fonts.gstatic.com')
  ) {
    return; // No cachear CDNs externos — siempre pedir versión fresca
  }

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) {
          // Devolver caché y actualizar en segundo plano
          fetch(event.request)
            .then(response => {
              if (response && response.status === 200) {
                caches.open(CACHE_NAME)
                  .then(cache => cache.put(event.request, response));
              }
            })
            .catch(() => {}); // Sin conexión — ignorar
          return cached;
        }

        // No está en caché — pedir a la red
        return fetch(event.request)
          .then(response => {
            if (!response || response.status !== 200) return response;
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, responseClone));
            return response;
          })
          .catch(() => {
            // Sin conexión y sin caché
            if (event.request.destination === 'document') {
              return caches.match('./index.html');
            }
          });
      })
  );
});

// ── Mensajes desde la app ────────────────────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});
