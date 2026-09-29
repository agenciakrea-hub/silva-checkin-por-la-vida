/**
 * La cola de altas, compartida por el sitio y por la app.
 *
 * ⚠️ ESTO VIVE EN UN ARCHIVO APARTE POR UNA RAZÓN CONCRETA, NO POR PROLIJIDAD.
 * Antes la cola existía sólo en el sitio. El formulario encolaba el alta y
 * navegaba a la app en el mismo instante; el envío se cortaba por la mitad, y
 * la app —que no sabía nada de esa cola— no lo reintentaba nunca. Resultado:
 * la persona entraba a su Boarding Pass y su registro no llegaba al servidor.
 * Perder eso es perder lo único que el cliente pidió como fundamental.
 *
 * Ahora las dos páginas cargan este archivo y las dos vacían la misma cola.
 */
(function () {
  'use strict';

  var K_DISPOSITIVO = 'cxv.dispositivo';
  var K_PENDIENTES  = 'cxv.pendientes';
  var K_YO          = 'cxv.yo';
  var MAX_COLA      = 40;   // tope de altas guardadas esperando señal
  var MAX_INTENTOS  = 6;    // tras esto se deja de insistir con un mismo envío

  // localStorage falla entero en modo privado de algunos navegadores y cuando
  // el usuario bloquea el almacenamiento. Nada de esto es importante como para
  // romper la página: si no se puede guardar, se sigue sin guardar.
  function leer(clave, porDefecto) {
    try { var v = localStorage.getItem(clave); return v ? JSON.parse(v) : porDefecto; }
    catch (e) { return porDefecto; }
  }
  function escribir(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); return true; }
    catch (e) { return false; }
  }
  // Lo guardado puede venir de una versión anterior, o corrupto. Si no es una
  // lista, se empieza de cero en vez de reventar en el primer `.push`.
  function leerCola() {
    var c = leer(K_PENDIENTES, []);
    return Object.prototype.toString.call(c) === '[object Array]' ? c : [];
  }

  function idUnico() {
    return (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // Identifica al teléfono, no a la persona. Sirve para saber si alguien vuelve
  // desde el mismo aparato; no se usa para nada más.
  function dispositivoId() {
    var id = leer(K_DISPOSITIVO, null);
    if (!id) { id = idUnico(); escribir(K_DISPOSITIVO, id); }
    return id;
  }

  function api() { return (window.CXV_API || '').trim(); }
  function hayRed() { return api() && typeof fetch === 'function'; }

  // ⚠️ SIN CABECERA Content-Type, a propósito. Poniéndola, el navegador manda
  // antes una petición OPTIONS de permiso, y Apps Script no contesta ese tipo
  // de petición: la llamada falla entera sin llegar nunca al servidor. Sin
  // cabecera, el navegador la trata como envío simple de formulario y pasa
  // derecho. El servidor lee el cuerpo como JSON igual.
  //
  // ⚠️ SE LEE COMO TEXTO Y SE PARSEA APARTE. `r.json()` directo revienta cuando
  // Apps Script contesta HTML, y contesta HTML más seguido de lo que parece:
  // un despliegue que quedó en «solo yo» devuelve la página de inicio de
  // sesión, y la cuota agotada devuelve otra.
  function alServidor(cuerpo) {
    return fetch(api(), { method: 'POST', keepalive: true, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        try { return JSON.parse(t); }
        catch (e) { return { ok: false, motivo: 'respuesta_no_json' }; }
      });
  }

  // Guarda en la cola ANTES de intentar mandar: si el envío se pierde por falta
  // de señal, o porque la página navega a la app en el mismo instante, queda
  // anotado y se reintenta. Es lo único que evita perder datos en una red
  // lenta, que es la red de esta campaña.
  function guardarPersona(valores, extra) {
    if (!hayRed()) return;
    var cuerpo = {
      action: 'registro', origen: 'web', dispositivo: dispositivoId(),
      nombre: valores.nombre || '', telefono: valores.telefono || '',
      correo: valores.correo || '', ticket: valores.ticket || ''
    };
    if (extra) { for (var k in extra) { if (extra[k]) cuerpo[k] = extra[k]; } }

    var cola = leerCola();
    cola.push({ id: idUnico(), intentos: 0, cuerpo: cuerpo });
    // Se descarta por el principio sólo cuando de verdad hay demasiado: lo más
    // viejo es lo que más tiempo lleva esperando, y tirarlo es perderlo.
    escribir(K_PENDIENTES, cola.slice(-MAX_COLA));
    enviarPendientes();
  }

  // Quita un envío por su id. ⚠️ POR ID, NUNCA POR POSICIÓN: con dos pestañas
  // abiertas, o con una alta nueva entrando mientras otra está en vuelo, el
  // envío que respondió ya no está donde estaba, y recortar el primero borra
  // un registro que jamás salió.
  function sacarDeCola(id) {
    var antes = leerCola();
    var despues = antes.filter(function (x) { return x && x.id !== id; });
    if (despues.length === antes.length) return true;   // ya no estaba
    // Si el almacenamiento acepta leer pero no escribir (cuota llena), el
    // envío nunca desaparece y esto se llamaría en bucle: cientos de
    // peticiones que queman la cuota diaria del servidor, que es el de todos.
    return escribir(K_PENDIENTES, despues);
  }

  var enviando = false;
  function enviarPendientes() {
    if (!hayRed() || enviando) return;
    var cola = leerCola();
    if (!cola.length) return;

    // Se recorre la cola entera, no sólo el primero. Con el modelo viejo, un
    // solo envío que el servidor no aceptaba tapaba a todos los de atrás y no
    // volvía a salir ninguno nunca más.
    var pendiente = null;
    for (var i = 0; i < cola.length; i++) {
      if ((cola[i].intentos || 0) < MAX_INTENTOS) { pendiente = cola[i]; break; }
    }
    if (!pendiente) return;

    enviando = true;
    alServidor(pendiente.cuerpo)
      .then(function (r) {
        var listo = r && r.ok;
        /* ⚠️ YA NO SE DESCARTA NADA POR «INVÁLIDO». Eso costó un registro real:
           el servidor rechazaba un teléfono argentino, el cliente leía
           «invalido» y borraba el envío de la cola, y esa persona no quedaba en
           ninguna parte. Hoy el servidor guarda hasta lo que no entiende, así
           que lo único que puede volver mal es un fallo de verdad — y eso se
           reintenta, no se tira. */
        var irrecuperable = false;

        if (listo && r.token) {
          escribir(K_YO, { id: r.id, token: r.token });
          // La app está mirando: se le avisa para que cambie «Activando…» por
          // el número de pase sin que la persona tenga que recargar.
          try {
            window.dispatchEvent(new CustomEvent('cxv:alta', { detail: { id: r.id } }));
          } catch (e) {}
        }

        if (listo || irrecuperable) {
          if (!sacarDeCola(pendiente.id)) { enviando = false; return; }
        } else {
          var cola2 = leerCola();
          for (var k = 0; k < cola2.length; k++) {
            if (cola2[k].id === pendiente.id) { cola2[k].intentos = (cola2[k].intentos || 0) + 1; }
          }
          if (!escribir(K_PENDIENTES, cola2)) { enviando = false; return; }
        }
        enviando = false;
        enviarPendientes();
      })
      .catch(function () { enviando = false; });   // sin señal: queda para la próxima
  }

  // Sin esto, «se reintenta la próxima vez que abra el sitio» es una promesa
  // vacía: quien se va y no vuelve deja su registro muerto en el teléfono.
  // Volver a la pestaña o recuperar la señal alcanzan.
  function arrancarCola() {
    if (!hayRed()) return;
    enviarPendientes();
    window.addEventListener('online', enviarPendientes);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) enviarPendientes();
    });
  }

  window.CXV = {
    leer: leer, escribir: escribir, leerCola: leerCola,
    dispositivoId: dispositivoId, alServidor: alServidor,
    guardarPersona: guardarPersona, enviarPendientes: enviarPendientes,
    arrancarCola: arrancarCola, hayRed: hayRed
  };
})();
