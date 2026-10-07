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

const VERSION = 'v45';
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
  /* ⚠️ LOS QUE LA APP PIDE DE VERDAD. Acá estaba el `.png` del logo, que la app
     NO usa: el `<img>` apunta al `.webp` desde hace versiones, así que sin
     conexión se bajaba un archivo que nadie iba a mostrar y el que sí hacía
     falta no estaba. Van los dos formatos del isotipo porque el navegador elige
     uno u otro según lo que soporte, y los dos juntos pesan 5 KB. */
  '../img/iso-silva-blanco-96.avif',
  '../img/iso-silva-blanco-96.webp',
  '../img/logo-silva-blanco-400.webp',
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

    /* ⚠️ EL DOCUMENTO VA A LA RED PRIMERO, CON UN TOPE CORTO. El resto sigue
       siendo caché primero.

       Con caché primero para todo, al publicar una versión nueva la primera
       visita de cada persona recibía el `index.html` VIEJO junto con el
       `app.js` NUEVO —porque el JS entra por otra petición y a veces llega
       fresco—. El JS buscaba elementos que ese HTML todavía no tenía, y la app
       quedaba en blanco hasta recargar. Pasó de verdad, con el bloque del
       ranking recién publicado.

       El HTML es lo que define qué elementos existen, así que es lo único que
       no puede ir atrasado respecto del código. Pesa unos 60 kB y va solo: mil
       quinientos milisegundos es lo que se le da para llegar. Si no llega
       —que en la red de esta campaña pasa— se sirve el guardado, igual que
       antes, y no se pierde nada. */
    if (guardado && req.mode === 'navigate') {
      const carrera = await Promise.race([
        enLaRed,
        new Promise(r => setTimeout(() => r(null), 1500))
      ]);
      if (carrera) return carrera;
      event.waitUntil(enLaRed);
      return guardado;
    }

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

/* ═══════════════════════════════════════════════════════════════════════════
   NOTIFICACIONES

   ⚠️ EL PUSH LLEGA VACÍO. Cifrar la carga de un push exige AES-GCM y Apps
   Script no lo tiene, así que el servidor manda un push SIN CUERPO: sólo sirve
   para despertar a este worker. El texto lo pide acá, por el mismo camino de
   siempre, y nunca pasa por el servicio de push de Google o Apple.

   ⚠️ UN SERVICE WORKER NO TIENE `localStorage`. Lo que necesita para preguntar
   —a dónde, y con qué token— lo deja la app en IndexedDB `cxv-push`. Si eso
   no está, igual hay que mostrar ALGO: un push que despierta y no muestra nada
   hace que el navegador muestre su propio aviso genérico («Esta página se
   actualizó en segundo plano»), que es peor que cualquier texto propio.
   ═══════════════════════════════════════════════════════════════════════════ */

const PUSH_BD = 'cxv-push';
const PUSH_ALMACEN = 'datos';

function abrirBD() {
  return new Promise((ok, mal) => {
    const p = indexedDB.open(PUSH_BD, 1);
    p.onupgradeneeded = () => {
      if (!p.result.objectStoreNames.contains(PUSH_ALMACEN)) {
        p.result.createObjectStore(PUSH_ALMACEN, { keyPath: 'id' });
      }
    };
    p.onsuccess = () => ok(p.result);
    p.onerror = () => mal(p.error);
  });
}

function leerBD(id) {
  return abrirBD().then(bd => new Promise(ok => {
    const p = bd.transaction(PUSH_ALMACEN, 'readonly').objectStore(PUSH_ALMACEN).get(id);
    p.onsuccess = () => ok(p.result || null);
    p.onerror = () => ok(null);
  })).catch(() => null);
}

function guardarBD(valor) {
  return abrirBD().then(bd => new Promise(ok => {
    const p = bd.transaction(PUSH_ALMACEN, 'readwrite').objectStore(PUSH_ALMACEN).put(valor);
    p.onsuccess = () => ok(true);
    p.onerror = () => ok(false);
  })).catch(() => false);
}

/* La app deja acá lo que el worker va a necesitar cuando lo despierten. */
self.addEventListener('message', event => {
  if (event.data && event.data.tipo === 'push-datos') {
    event.waitUntil(guardarBD({ id: 'yo', api: event.data.api, token: event.data.token }));
  }
});

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    const POR_DEFECTO = {
      titulo: 'Un Check-in por la Vida',
      texto: 'Hay novedades de la ruta que ayudaste a financiar.'
    };
    let aviso = POR_DEFECTO, estado = '', vuelo = '';
    try {
      const yo = await leerBD('yo');
      if (yo && yo.api) {
        /* ⚠️ CON TOPE DE TIEMPO. El navegador le da a un worker despertado unos
           pocos segundos; si el `fetch` no vuelve, la promesa queda colgada y
           el aviso no se muestra nunca. Apps Script en frío tarda más que eso,
           así que el respaldo genérico no es un caso raro: es lo que se ve la
           primera vez del día. */
        const corte = new Promise(r => setTimeout(() => r(null), 8000));
        const pedido = fetch(yo.api, {
          method: 'POST',
          body: JSON.stringify({ action: 'avisos', token: yo.token || '' })
        }).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch (e) { return null; } })
          .catch(() => null);
        const r = await Promise.race([pedido, corte]);
        if (r && r.ok && r.aviso && r.aviso.titulo) {
          aviso = r.aviso; estado = r.estado || '';
          /* De qué ruta habla este aviso. Desde que una empresa puede financiar
             su propio vuelo, el servidor lo dice y acá hace falta para dos
             cosas: no pisar el aviso de otra ruta y no callar el de la segunda
             por haber visto la primera. */
          vuelo = r.vuelo || '';
        }
      }
    } catch (e) {}

    /* ⚠️ NO SE REPITE EL MISMO AVISO. El servicio de push puede entregar el
       mismo mensaje más de una vez, y `avisarDelVuelo` se puede tocar dos
       veces sin querer. Con `tag` el navegador reemplaza el anterior en vez de
       apilar dos iguales, y la marca en IndexedDB evita volver a sonar por una
       etapa que esta persona ya vio. */
    /* ⚠️ LA MARCA DE «ya lo vi» ES POR RUTA. Guardando sólo la etapa, el
       teléfono de alguien que está en dos rutas —la campaña y la de su
       empresa— se callaba el segundo «tu ruta está en el aire» porque ya había
       visto el de la otra. */
    const visto = await leerBD('visto');
    const clave = (vuelo || '') + '|' + estado;
    if (estado && visto && visto.estado === clave) {
      /* Ya se avisó de esta etapa. Igual HAY QUE MOSTRAR ALGO: un `push`
         atendido sin notificación hace que el navegador muestre la suya. Se
         muestra el mismo, con el mismo `tag`, así que reemplaza y no suma. */
    }
    if (estado) await guardarBD({ id: 'visto', estado: clave });

    return self.registration.showNotification(aviso.titulo, {
      body: aviso.texto,
      icon: '../img/icon-192.png',
      badge: '../img/icon-192.png',
      /* ⚠️ EL `tag` LLEVA LA RUTA. Con `cxv-vuelo-en_curso` a secas, el aviso
         de la ruta de una empresa REEMPLAZABA en el teléfono al de la campaña
         —el navegador trata el mismo `tag` como el mismo aviso— y la persona
         veía uno solo donde había dos noticias distintas. */
      tag: 'cxv-vuelo' + (vuelo ? '-' + vuelo : '') + (estado ? '-' + estado : ''),
      renotify: false,
      data: { url: './' }
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    /* Si la app ya está abierta se la trae al frente en vez de abrir otra: dos
       pestañas de la misma app es lo que pasa si no se mira. */
    for (const c of abiertas) {
      if (c.url.indexOf('/app/') > -1 && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});
