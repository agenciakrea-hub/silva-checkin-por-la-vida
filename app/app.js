/**
 * La app del pasajero. Muestra en qué va la ruta que la persona ayudó a
 * financiar, y su pase si el teléfono la reconoce.
 *
 * Sin framework ni compilación, igual que el resto del sitio: es un archivo que
 * se lee de arriba abajo.
 *
 * ⚠️ Funciona para tres personas distintas, y las tres tienen que poder entrar:
 *    quien compró en el evento y tiene el pase de papel, quien compró por
 *    WhatsApp y no tiene nada físico, y quien todavía no compró. A esta última
 *    se le muestra la ruta igual: es a quien más conviene mostrársela.
 */
(function () {
  'use strict';

  var API = (window.CXV_API || '').trim();
  var TEL = '584241466595';
  var K_YO = 'cxv.yo';
  var K_DISPOSITIVO = 'cxv.dispositivo';
  var K_PERFIL = 'cxv.perfil';   // lo que dejó el formulario, para pintar sin esperar

  var $ = function (id) { return document.getElementById(id); };

  // Todo esto vive en cola.js, que el sitio carga también. ⚠️ La app tiene que
  // vaciar la misma cola que llena el formulario: quien se registra navega
  // hasta acá en el mismo instante en que sale el alta, el envío se corta por
  // la mitad, y si la app no lo reintentara ese registro no llegaría nunca.
  var leer          = window.CXV.leer;
  var escribir      = window.CXV.escribir;
  var dispositivoId = window.CXV.dispositivoId;
  var alServidor    = window.CXV.alServidor;

  var textoWa = function (m) {
    return 'https://wa.me/' + TEL + '?text=' + encodeURIComponent(m);
  };

  // ── Pintar ───────────────────────────────────────────────────────────────

  var ESTADOS = {
    preparando: 'Preparando',
    en_curso:   'En vuelo',
    completado: 'Completada'
  };

  function pintarVuelo(v) {
    if (!v) return;
    if (v.titulo)  $('vuelo-titulo').textContent = v.titulo;
    if (v.origen)  $('origen').textContent  = v.origen;
    if (v.destino) $('destino').textContent = v.destino;
    if (v.nota)    $('avance-nota').textContent = v.nota;
    $('d-estado').textContent = ESTADOS[v.estado] || v.estado || 'Preparando';
  }

  /**
   * Las cifras de la campaña, de datos.js. Son OSOS ADOPTADOS, no personas
   * registradas: una persona puede adoptar varios, y quien compró en el evento
   * sin pasar por la web no está registrada en ningún lado. Contar registros
   * daba un número más chico que el de la portada para la misma cosa.
   */
  function cifrasDeLaCampana() {
    var d = window.CAMPANA;
    if (!d) return null;
    var meta = (typeof d.metaOsos === 'number' && d.metaOsos > 0) ? d.metaOsos : null;
    var adoptados = null;
    if (Object.prototype.toString.call(d.productos) === '[object Array]') {
      adoptados = d.productos.reduce(function (s, p) { return s + (Number(p.vendidas) || 0); }, 0);
    }
    return (meta !== null && adoptados !== null) ? { adoptados: adoptados, meta: meta } : null;
  }

  function pintarAvance(adoptados, meta) {
    if (typeof adoptados !== 'number' || typeof meta !== 'number' || meta <= 0) return;
    $('c-osos').textContent   = String(adoptados);
    $('c-faltan').textContent = String(Math.max(meta - adoptados, 0));
    var pct = Math.min(Math.round(adoptados / meta * 100), 100);
    // Con pocos adoptados sobre una meta grande el porcentaje redondea a cero y
    // la barra se ve vacía, como si estuviera rota. Un mínimo visible dice la
    // verdad —«arrancó»— mejor que una barra en blanco. El número de al lado
    // es el dato exacto.
    var ancho = adoptados > 0 ? Math.max(pct, 3) : 0;
    $('barra').style.transform = 'scaleX(' + (ancho / 100) + ')';
    // Las cifras, no el porcentaje: con 3 de 609 el porcentaje redondea a cero
    // y quien escucha la página oiría «cero por ciento», que suena a que no
    // arrancó. Los números dicen lo mismo sin mentir.
    $('barra-caja').setAttribute('aria-label',
      adoptados + ' de ' + meta + ' Héroes de Rescate adoptados');
  }

  // ── La tripulación ───────────────────────────────────────────────────────

  var META_TRIPU = 2;   // lo que pidió el cliente: «compartir con dos contactos»

  function primerNombre(v) {
    return String(v || '').trim().split(/\s+/)[0] || '';
  }

  function enlacePropio(id) {
    return location.origin + '/?de=' + encodeURIComponent(id);
  }

  function pintarTripulacion(yo) {
    var n = Number(yo.tripulacion) || 0;
    var caja = $('asientos');
    caja.innerHTML = '';
    /* Se dibujan al menos los dos asientos de la meta, y más si ya los pasó:
       a quien invitó a cinco no se le esconden tres. */
    var total = Math.max(META_TRIPU, n);
    for (var i = 0; i < total; i++) {
      var d = document.createElement('span');
      d.className = 'asiento';
      if (i < n) d.setAttribute('data-ocupado', '');
      d.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
        '<path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-4 0-7 2-7 4.5V21h14v-2.5C19 16 16 14 12 14z"/></svg>';
      caja.appendChild(d);
    }
    caja.setAttribute('role', 'img');
    caja.setAttribute('aria-label',
      n === 0 ? 'Todavía no se sumó nadie por tu enlace'
              : (n === 1 ? 'Una persona se sumó por tu enlace'
                         : n + ' personas se sumaron por tu enlace'));

    $('tripu-texto').textContent =
      n === 0 ? 'Comparte tu enlace: vas a ver aquí a quienes se sumen por ti.'
    : n === 1 ? 'Una persona se sumó por ti. Con una más, completas tu tripulación.'
    : n < META_TRIPU ? n + ' personas se sumaron por ti.'
    : n === META_TRIPU ? 'Tu tripulación está completa: ' + n + ' personas se sumaron por ti.'
    : n + ' personas se sumaron por ti. Tu tripulación va más que completa.';

    $('tripu').hidden = false;
  }

  // ── Cierre de la ruta ────────────────────────────────────────────────────

  function pintarCierre(vuelo) {
    if (!vuelo || vuelo.estado !== 'completado') { $('cierre').hidden = true; return; }
    /* Con la ruta terminada, el bloque de avance sobra y además se contradice:
       decía «estamos reuniendo los Héroes» con la barra a medias justo arriba
       del cartel que anuncia que la ruta se completó. */
    $('avance').hidden = true;
    if (vuelo.titulo) $('cierre-titulo').textContent = vuelo.titulo + ' se completó';
    /* El equipo escribe el cierre en la hoja: quiénes viajaron, cómo salió. Sin
       eso queda un agradecimiento genérico, que es lo justo pero no dice nada. */
    if (vuelo.cierre) $('cierre-nota').textContent = vuelo.cierre;
    $('cierre').hidden = false;
  }

  function pintarPersona(yo) {
    $('d-nombre').textContent = yo.nombre || '—';
    $('d-pase').textContent   = yo.ticket || yo.id || '—';
    // El nombre arriba del todo: es el pase de esa persona, no un pase genérico.
    $('pase-rotulo').textContent = yo.nombre ? ('Boarding de ' + yo.nombre) : 'Boarding Pass solidario';
    $('pase').hidden   = false;
    $('entrar').hidden = true;
    $('avance-titulo').textContent = 'La ruta que estás financiando';
    // Quien ya tiene su pase vinculado no necesita que le pidan el de papel.
    $('papel').hidden = !!yo.ticket;
    $('tienda-texto').textContent =
      'Elige lo que quieras y te abrimos WhatsApp con el pedido ya escrito.';
  }

  // A quien no reconocemos se le muestra la ruta igual, y se le ofrece entrar.
  // Mostrar el pase vacío sería peor que no mostrarlo: parece un error.
  //
  // ⚠️ NO PISA LO QUE YA SE PINTÓ CON EL PERFIL DEL TELÉFONO. Quien se acaba de
  // registrar llega acá antes de que el servidor lo conozca —el alta viaja en
  // segundo plano y Apps Script tarda más de 20 segundos en frío—, y sin esta
  // guarda el pase aparecía con su nombre y se borraba solo un instante
  // después, dejándole un formulario de «entra a tu pase» al que acababa de
  // registrarse.
  function pintarDesconocido() {
    var perfil = leer(K_PERFIL, null);
    if (perfil && perfil.nombre) return;
    $('pase').hidden   = true;
    $('entrar').hidden = false;
    $('avance-titulo').textContent = 'La ruta que estamos financiando';
    $('btn-adoptar').textContent = 'Adoptar un Héroe de Rescate';
  }

  // ── Entrar con el teléfono ───────────────────────────────────────────────

  function entrar(telefono, persona) {
    var aviso = $('entrar-aviso');
    aviso.textContent = 'Buscando…';
    alServidor({ action: 'recuperar', telefono: telefono,
                 persona: persona || '', dispositivo: dispositivoId() })
      .then(function (r) {
        if (r && r.ok && r.token) {
          escribir(K_YO, { id: r.id, token: r.token });
          aviso.textContent = '';
          arrancar();
          return;
        }
        // Un teléfono de casa con dos personas registradas: se pregunta cuál
        // es, en vez de adivinar y mostrarle a alguien el pase de otro.
        if (r && r.motivo === 'varias_personas' && r.personas) {
          aviso.textContent = '¿Cuál de estas personas eres?';
          var caja = $('elegir');
          caja.innerHTML = '';
          r.personas.forEach(function (p) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = p.nombre;
            b.addEventListener('click', function () { entrar(telefono, p.id); });
            caja.appendChild(b);
          });
          caja.hidden = false;
          return;
        }
        if (r && r.motivo === 'no_encontrado') {
          aviso.textContent = 'No encontramos ese teléfono. ¿Lo escribiste con el código de área?';
          return;
        }
        if (r && r.motivo === 'telefono_invalido') {
          aviso.textContent = 'Ese teléfono no parece completo. Ejemplo: 0412-1234567.';
          return;
        }
        aviso.textContent = 'No pudimos conectarnos. Intenta de nuevo en un momento.';
      })
      .catch(function () {
        aviso.textContent = 'No pudimos conectarnos. Revisa tu conexión.';
      });
  }

  // ── Arranque ─────────────────────────────────────────────────────────────

  function arrancar() {
    // Sin servidor configurado la app igual sirve: muestra la ruta con los
    // valores que ya están en el HTML. Vale también para un navegador sin
    // fetch, que en el público de esta campaña no es una hipótesis.
    // Las cifras primero y sin depender del servidor: son las mismas que la
    // portada y tienen que coincidir con ella aunque Apps Script no conteste.
    var c = cifrasDeLaCampana();
    if (c) pintarAvance(c.adoptados, c.meta);

    // ⚠️ SE PINTA EL PASE ANTES DE HABLAR CON EL SERVIDOR, con lo que el
    // formulario acaba de guardar en el teléfono. Apps Script en frío tarda más
    // de 20 segundos: esperar su respuesta para recién ahí mostrar algo dejaría
    // a quien se acaba de registrar mirando una pantalla vacía justo en el
    // momento de más entusiasmo.
    var perfil = leer(K_PERFIL, null);
    if (perfil && perfil.nombre) {
      pintarPersona({ nombre: primerNombre(perfil.nombre), ticket: perfil.ticket || '', id: '' });
      $('d-pase').textContent = perfil.ticket || 'Activando…';
    }

    if (!API || typeof fetch !== 'function') { pintarDesconocido(); return; }

    var yo = leer(K_YO, null);
    alServidor({ action: 'estado', token: (yo && yo.token) || '' })
      .then(function (r) {
        if (!r || !r.ok) { pintarDesconocido(); return; }
        pintarVuelo(r.vuelo);
        pintarCierre(r.vuelo);
        if (r.yo) { pintarPersona(r.yo); pintarTripulacion(r.yo); }
        else {
          // El token guardado ya no vale: se descarta para no volver a
          // mandarlo en cada arranque.
          if (yo) { try { localStorage.removeItem(K_YO); } catch (e) {} }
          pintarDesconocido();
        }
      })
      .catch(function () { pintarDesconocido(); });
  }

  // ── Enganches ────────────────────────────────────────────────────────────

  $('form-entrar').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = (this.elements.telefono.value || '').trim();
    if (!v) { $('entrar-aviso').textContent = 'Escribe tu teléfono.'; return; }
    $('elegir').hidden = true;
    entrar(v);
  });

  $('btn-adoptar').addEventListener('click', function (e) {
    e.preventDefault();
    var yo = leer(K_YO, null);
    var m = yo
      ? 'Hola, ya tengo mi Boarding Pass de Un Check-in por la Vida y quiero adoptar otro Héroe de Rescate.'
      : 'Hola, vengo de la web de Un Check-in por la Vida y quiero adoptar un Héroe de Rescate.';
    window.open(textoWa(m), '_blank', 'noopener');
  });

  function compartir(texto, url) {
    if (navigator.share) {
      navigator.share({ title: 'Un Check-in por la Vida', text: texto, url: url })
        .catch(function () {});
      return;
    }
    window.open(textoWa(texto + ' ' + url), '_blank', 'noopener');
  }

  $('btn-compartir').addEventListener('click', function () {
    compartir('Adopté un Héroe de Rescate para que personas con cáncer lleguen a su tratamiento. Súmate:',
              location.origin + '/');
  });

  $('btn-invitar').addEventListener('click', function () {
    var yo = leer(K_YO, null);
    // Sin id no hay enlace propio que compartir, pero la campaña sí: se comparte
    // igual en vez de dejar el botón muerto.
    var url = (yo && yo.id) ? enlacePropio(yo.id) : location.origin + '/';
    compartir('Adopté un Héroe de Rescate para que personas con cáncer lleguen a su tratamiento en Caracas. Súmate a mi tripulación:', url);
  });

  $('btn-otra-ruta').addEventListener('click', function (e) {
    e.preventDefault();
    window.open(textoWa('Hola, mi ruta se completó y quiero sumarme a la próxima con otro Héroe de Rescate.'), '_blank', 'noopener');
  });

  $('btn-regalar').addEventListener('click', function () {
    window.open(textoWa('Hola, quiero regalar un Héroe de Rescate a otra persona. ¿Cómo lo hago?'), '_blank', 'noopener');
  });

  // ── Encargar ─────────────────────────────────────────────────────────────

  // Los productos y sus precios salen de datos.js, el mismo archivo que la
  // portada. Los de respaldo son para el caso de que no cargue: mejor un
  // catálogo con precios viejos que una sección vacía.
  var RESPALDO = [
    { id: 'toalla',  nombre: 'Toalla tipo oso', precio: 10 },
    { id: 'llavero', nombre: 'Llavero',         precio: 20 },
    { id: 'oso',     nombre: 'Oso grande',      precio: 40 }
  ];

  var carrito = {};

  function catalogo() {
    var d = window.CAMPANA;
    if (d && Object.prototype.toString.call(d.productos) === '[object Array]' && d.productos.length) {
      return d.productos.map(function (p) {
        return { id: p.id, nombre: p.nombre, precio: Number(p.precio) || 0 };
      });
    }
    return RESPALDO;
  }

  function pintarTienda() {
    var caja = $('productos');
    caja.innerHTML = '';
    catalogo().forEach(function (p) {
      carrito[p.id] = carrito[p.id] || 0;

      var fila = document.createElement('div');
      fila.className = 'prod';

      var txt = document.createElement('div');
      txt.innerHTML = '<p class="prod-nombre"></p><p class="prod-precio"></p>';
      txt.querySelector('.prod-nombre').textContent  = p.nombre;
      txt.querySelector('.prod-precio').textContent = '$' + p.precio;

      var cant = document.createElement('div');
      cant.className = 'cant';

      var menos = document.createElement('button');
      menos.type = 'button'; menos.textContent = '−';
      menos.setAttribute('aria-label', 'Quitar un ' + p.nombre);

      var salida = document.createElement('output');
      salida.textContent = '0';
      salida.setAttribute('aria-label', p.nombre + ': 0');

      var mas = document.createElement('button');
      mas.type = 'button'; mas.textContent = '+';
      mas.setAttribute('aria-label', 'Sumar un ' + p.nombre);

      function refrescar() {
        var n = carrito[p.id];
        salida.textContent = String(n);
        // El lector de pantalla necesita el nombre en la etiqueta: leer sólo
        // «3» no dice de qué.
        salida.setAttribute('aria-label', p.nombre + ': ' + n);
        menos.disabled = n === 0;
        total();
      }
      menos.addEventListener('click', function () {
        if (carrito[p.id] > 0) { carrito[p.id]--; refrescar(); }
      });
      mas.addEventListener('click', function () {
        if (carrito[p.id] < 99) { carrito[p.id]++; refrescar(); }
      });

      cant.appendChild(menos); cant.appendChild(salida); cant.appendChild(mas);
      fila.appendChild(txt); fila.appendChild(cant);
      caja.appendChild(fila);
      refrescar();
    });
  }

  function total() {
    var suma = 0, piezas = 0;
    catalogo().forEach(function (p) {
      suma   += (carrito[p.id] || 0) * p.precio;
      piezas += (carrito[p.id] || 0);
    });
    $('total').textContent = '$' + suma;
    $('btn-encargar').disabled = piezas === 0;
    return { suma: suma, piezas: piezas };
  }

  $('btn-encargar').addEventListener('click', function () {
    var lineas = [], t = total();
    if (!t.piezas) return;
    catalogo().forEach(function (p) {
      var n = carrito[p.id] || 0;
      if (n) lineas.push('· ' + n + ' × ' + p.nombre + ' ($' + (n * p.precio) + ')');
    });
    var yo = leer(K_YO, null), perfil = leer(K_PERFIL, null);
    var quien = (perfil && perfil.nombre) ? ('Soy ' + perfil.nombre + '. ') : '';
    var pase = (yo && yo.id) ? ('\n\nMi pase: ' + (perfil && perfil.ticket ? perfil.ticket : yo.id)) : '';
    window.open(textoWa(
      'Hola, vengo de mi Boarding Pass de Un Check-in por la Vida. ' + quien +
      'Quiero encargar:\n\n' + lineas.join('\n') +
      '\n\nTotal: $' + t.suma + pase), '_blank', 'noopener');
  });

  // ── Empresas ─────────────────────────────────────────────────────────────

  var PLANES = {
    padrino:  'Hola, vengo de Un Check-in por la Vida. Represento a una empresa y me interesa el plan Padrino de Ruta. ¿Me puedes dar más información?',
    copiloto: 'Hola, vengo de Un Check-in por la Vida. Represento a una empresa y me interesa el plan Copiloto Solidario. ¿Me puedes dar más información?',
    lotes:    'Hola, vengo de Un Check-in por la Vida. Represento a una empresa y quiero cotizar Héroes de Rescate como regalo con propósito. ¿Me puedes dar más información?'
  };

  document.querySelectorAll('[data-plan]').forEach(function (b) {
    b.addEventListener('click', function () {
      window.open(textoWa(PLANES[b.getAttribute('data-plan')] || PLANES.padrino), '_blank', 'noopener');
    });
  });

  // ── El pase de papel ─────────────────────────────────────────────────────

  $('form-papel').addEventListener('submit', function (e) {
    e.preventDefault();
    var aviso = $('papel-aviso');
    var t = (this.elements.ticket.value || '').trim();
    if (!t) { aviso.textContent = 'Escribe el número de tu Boarding Pass.'; return; }

    var yo = leer(K_YO, null);
    if (!yo || !yo.token) {
      aviso.textContent = 'Primero entra con tu teléfono y luego vincula tu pase.';
      return;
    }
    aviso.textContent = 'Vinculando…';
    alServidor({ action: 'vincular', token: yo.token, ticket: t })
      .then(function (r) {
        if (r && r.ok) {
          aviso.textContent = '';
          var perfil = leer(K_PERFIL, {}) || {};
          perfil.ticket = r.ticket || t;
          escribir(K_PERFIL, perfil);
          $('d-pase').textContent = perfil.ticket;
          $('papel').hidden = true;
          return;
        }
        aviso.textContent = (r && r.motivo === 'ticket_invalido')
          ? 'Ese número no parece un Boarding Pass. Revísalo.'
          : 'No pudimos vincularlo. Intenta de nuevo en un momento.';
      })
      .catch(function () { aviso.textContent = 'No pudimos conectarnos. Revisa tu conexión.'; });
  });

  // ── Instalable ───────────────────────────────────────────────────────────

  var yaInstalada = window.matchMedia('(display-mode: standalone)').matches ||
                    window.navigator.standalone === true;

  function registrarServicio() {
    if (!('serviceWorker' in navigator)) return;
    // Sólo por https o en localhost: en http el navegador lo rechaza sin avisar.
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

    navigator.serviceWorker.register('sw.js', { scope: './' })
      .then(function (reg) {
        // Si aparece una versión nueva mientras la app está abierta, se avisa y
        // se deja decidir. Recargar por las malas pierde lo que se esté haciendo.
        reg.addEventListener('updatefound', function () {
          var nuevo = reg.installing;
          if (!nuevo) return;
          nuevo.addEventListener('statechange', function () {
            if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
              $('aviso-nuevo').hidden = false;
            }
          });
        });
      })
      .catch(function () { /* sin service worker la app funciona igual, sólo que sin red no abre */ });

    var recargando = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (recargando) return;      // Chrome lo dispara dos veces y recargaría en bucle
      recargando = true;
      location.reload();
    });
  }

  var pedidoDeInstalar = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    // Sin esto Chrome muestra su propia barra, que aparece donde quiere y dice
    // lo que quiere. Con el botón propio, se ofrece en su lugar y con el texto
    // de la campaña.
    e.preventDefault();
    pedidoDeInstalar = e;
    if (!yaInstalada) $('instalar').hidden = false;
  });

  window.addEventListener('appinstalled', function () {
    pedidoDeInstalar = null;
    $('instalar').hidden = true;
  });

  $('btn-instalar').addEventListener('click', function () {
    if (!pedidoDeInstalar) return;
    pedidoDeInstalar.prompt();
    pedidoDeInstalar.userChoice.then(function () { pedidoDeInstalar = null; });
  });

  $('btn-recargar').addEventListener('click', function () {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && reg.waiting) reg.waiting.postMessage('actualizar');
        else location.reload();
      });
    } else location.reload();
  });

  // ⚠️ iOS NO TIENE `beforeinstallprompt` y no lo va a tener: Safari no expone
  // ninguna forma de pedir la instalación desde la página. Lo único que se
  // puede hacer es explicar dónde está el botón de Compartir. Sin esto, en
  // iPhone la sección de instalar no aparecería nunca.
  (function () {
    if (yaInstalada) return;
    var ua = navigator.userAgent;
    var esIOS = /iPad|iPhone|iPod/.test(ua) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!esIOS) return;
    $('instalar').hidden = false;
    $('btn-instalar').hidden = true;
    $('pasos-ios').hidden = false;
    $('instalar-texto').textContent =
      'Agrégalo a tu pantalla de inicio y ábrelo como una aplicación:';
  })();

  // Cuando el alta encolada por el formulario llega al servidor, el pase deja
  // de decir «Activando…» sin que la persona tenga que recargar nada, y se
  // vuelve a preguntar por el estado: al abrir la app el servidor todavía no
  // conocía a esta persona, así que respondió sin su tripulación ni su pase.
  // Sin esto, quien se acaba de registrar no ve nada de eso hasta recargar.
  window.addEventListener('cxv:alta', function (e) {
    var perfil = leer(K_PERFIL, null);
    if (perfil && !perfil.ticket && e.detail && e.detail.id) {
      $('d-pase').textContent = e.detail.id;
    }
    arrancar();
  });

  registrarServicio();
  pintarTienda();
  window.CXV.arrancarCola();
  arrancar();
})();
