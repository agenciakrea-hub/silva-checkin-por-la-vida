/**
 * Service worker de la app del pasajero.
 *
 * ⚠️ SCOPE `/app/` Y NADA MÁS. El sitio de la campaña no tiene service worker y
 * no debe tenerlo: se sirve por GitHub Pages con su propia caché y agregarle
 * uno sólo traería una capa más donde quedarse pegado. Por eso este archivo
 * vive en `/app/` y no en la raíz — la ubicación es la que fija el alcance.
 *
 * Aunque el alcance sea `/app/`, sí intercepta lo que esta página pide de
 * afuera (las fuentes, `datos.js`), porque el alcance dice qué páginas controla,
 * no a qué servidores pueden hablarle.
 *
 * Patrón tomado de `silva-salud-fatiga`, que corre esto mismo en producción
 * para el mismo cliente.
 *
 * ⚠️ AL CAMBIAR CUALQUIER ARCHIVO DE LA APP, SUBIR VERSION. Un service worker
 * viejo sirviendo archivos viejos es el error más caro de este tipo de app
 * porque no parece un problema de caché: parece que el cambio nunca se hizo.
 */
'use strict';

const VERSION = 'v4';
const CACHE   = 'checkin-app-' + VERSION;

/* Lo que hace falta para que la pantalla se dibuje entera sin red. Las cifras
   y la dirección del servidor entran acá a propósito: sin `datos.js` la app
   muestra los números de respaldo del HTML, que envejecen. */
const PRECARGA = [
  './',
  './index.html',
  './app.js',
  '../config.js',
  '../cola.js',
  '../datos.js',
  '../fonts/BigShoulders-700-latin.woff2',
  '../fonts/MartianMono-700-cifras.woff2',
  '../fonts/SourceSans3-400-latin.woff2',
  '../fonts/SourceSans3-600-latin.woff2',
  '../img/logo-silva-blanco-180.png',
  '../img/icon-192.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* Uno por uno y sin cortar ante un fallo: con `addAll`, un solo archivo que
       falte tumba la instalación entera y la app se queda sin service worker
       para siempre, sin decir por qué. */
    await Promise.all(PRECARGA.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { /* ese archivo se buscará en la red cuando haga falta */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const viejas = (await caches.keys()).filter(k => k.startsWith('checkin-app-') && k !== CACHE);
    await Promise.all(viejas.map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;

  /* Sólo GET. Los registros van por POST al servidor y no se cachean nunca:
     una respuesta guardada de un alta sería una mentira la próxima vez. */
  if (req.method !== 'GET') return;

  /* Al servidor se va siempre por la red. Es el estado del vuelo: servirlo de
     una caché es mostrar un vuelo que ya despegó como si estuviera esperando. */
  if (req.url.indexOf('script.google.com') > -1 ||
      req.url.indexOf('script.googleusercontent.com') > -1) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const guardado = await cache.match(req, { ignoreSearch: true });

    /* La red corre siempre por detrás, haya o no algo guardado: es lo que
       impide que una versión vieja se quede pegada. */
    const enLaRed = fetch(req).then(resp => {
      if (resp && resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
      return resp;
    }).catch(() => null);

    /* Caché primero: la pantalla se dibuja en milisegundos en vez de esperar a
       la red. En una red lenta —la de esta campaña— la diferencia es entre ver
       el pase al instante o mirar una pantalla vacía. */
    if (guardado) { event.waitUntil(enLaRed); return guardado; }

    const respuesta = await enLaRed;
    if (respuesta) return respuesta;

    /* Sin red y sin nada guardado: si pedían una página, se les da la app. */
    if (req.mode === 'navigate') {
      const app = await cache.match('./index.html');
      if (app) return app;
    }
    return new Response('Sin conexión', { status: 503, statusText: 'Sin conexión' });
  })());
});

/* La app pide saltar la espera cuando el usuario acepta actualizar. */
self.addEventListener('message', event => {
  if (event.data === 'actualizar') self.skipWaiting();
});
