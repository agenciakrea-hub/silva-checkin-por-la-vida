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
  /* 200 y no 40: cada alta ocupa unos 200 bytes y el navegador da megabytes,
     así que el tope de 40 sólo servía para descartar en silencio a los más
     viejos. El caso real es el stand del evento, con gente registrándose una
     atrás de otra y sin señal. */
  var MAX_COLA      = 200;  // tope de altas guardadas esperando señal
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
    var pedido = fetch(api(), { method: 'POST', keepalive: true, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        try { return JSON.parse(t); }
        catch (e) { return { ok: false, motivo: 'respuesta_no_json' }; }
      });
    /* Tope de tiempo: un `fetch` que no resuelve nunca —Apps Script colgado,
       una conexión abierta que no trae datos— dejaba la bandera `enviando` en
       verdadero para siempre y la cola no volvía a moverse en toda la vida de
       la página. Noventa segundos es lo que tarda el peor arranque en frío. */
    return new Promise(function (ok, mal) {
      var reloj = setTimeout(function () { mal(new Error('sin respuesta')); }, 90000);
      pedido.then(function (v) { clearTimeout(reloj); ok(v); },
                  function (e) { clearTimeout(reloj); mal(e); });
    });
  }

  // Guarda en la cola ANTES de intentar mandar: si el envío se pierde por falta
  // de señal, o porque la página navega a la app en el mismo instante, queda
  // anotado y se reintenta. Es lo único que evita perder datos en una red
  // lenta, que es la red de esta campaña.
  function guardarPersona(valores, extra) {
    var cuerpo = {
      action: 'registro', origen: 'web', dispositivo: dispositivoId(),
      nombre: valores.nombre || '', telefono: valores.telefono || '',
      correo: valores.correo || '', ticket: valores.ticket || ''
    };
    if (extra) { for (var k in extra) { if (extra[k]) cuerpo[k] = extra[k]; } }

    encolar(cuerpo);
  }

  /* El formulario de `/empresas/`. Va por la misma cola que las personas y no
     por un `fetch` suelto: si la red corta mientras un gerente lo envía, se
     reintenta solo. Es el único envío del sitio que no se puede perder —una
     persona vuelve a entrar a la campaña por su cuenta; una empresa que
     escribió una vez y no recibió respuesta, no—. */
  function guardarEmpresa(valores) {
    encolar({
      action: 'empresa', origen: 'web/empresas', dispositivo: dispositivoId(),
      empresa: valores.empresa || '', contacto: valores.contacto || '',
      correo: valores.correo || '', telefono: valores.telefono || '',
      modalidad: valores.modalidad || ''
    });
  }

  /* ⚠️ ESTO ERA EL CUERPO DE `guardarPersona` Y SE SACÓ TAL CUAL. No tiene nada
     de personas: encola, y si el almacenamiento no aceptó la escritura manda
     igual con lo que tiene en la mano. El `token` sólo lo devuelve `registro`,
     así que el `if` de abajo simplemente no se cumple para los demás envíos. */
  function encolar(cuerpo) {
    /* ⚠️ SE ENCOLA AUNQUE NO HAYA A DÓNDE MANDARLO TODAVÍA. Antes había un
       `return` acá arriba cuando faltaba la dirección del servidor o el
       navegador no tenía `fetch`, y el alta se evaporaba sin dejar rastro. Si
       `config.js` no llegó a cargar —una red que corta un subrecurso, nada
       raro— la persona veía su pase «Activando…» para siempre y no existía en
       ninguna parte. Encolado, al menos sale en la próxima visita. */
    var id = idUnico();
    var cola = leerCola();
    cola.push({ id: id, intentos: 0, creado: Date.now(), cuerpo: cuerpo });
    // Se descarta por el principio sólo cuando de verdad hay demasiado: lo más
    // viejo es lo que más tiempo lleva esperando, y tirarlo es perderlo.
    var seGuardo = escribir(K_PENDIENTES, cola.slice(-MAX_COLA));

    /* ⚠️ Y SE INTENTA MANDAR CON EL CUERPO QUE YA ESTÁ EN LA MANO, sin volver a
       leerlo del almacenamiento. Ésta es la diferencia entre guardar a la
       persona y perderla: en modo privado de Safari, con el almacenamiento
       lleno, o dentro del navegador de Instagram, `escribir` falla en silencio
       y la cola queda vacía. Como `enviarPendientes` relee de ahí, no salía un
       solo pedido. Ahora el envío no depende de que el teléfono haya podido
       anotar nada. */
    if (!hayRed()) return;

    if (!seGuardo) {
      alServidor(cuerpo)
        .then(function (r) {
          if (r && r.ok && r.token) {
            escribir(K_YO, { id: r.id, token: r.token });
            try { window.dispatchEvent(new CustomEvent('cxv:alta', { detail: { id: r.id } })); } catch (e) {}
          }
        })
        .catch(function () {});
      return;
    }
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
    //
    // ⚠️ `x && x.cuerpo`: un elemento corrupto o nulo tiraba una excepción que
    // se llevaba puesto el arranque entero de la página, y con él el enganche
    // del formulario.
    var ahora = Date.now();
    var pendiente = null, esperando = false;
    for (var i = 0; i < cola.length; i++) {
      var x = cola[i];
      if (!x || !x.cuerpo) continue;
      if ((x.intentos || 0) >= MAX_INTENTOS) continue;
      if (x.proximo && x.proximo > ahora) { esperando = true; continue; }
      pendiente = x; break;
    }
    /* Todos los que quedan están esperando su turno: se vuelve cuando toque.
       Sin esto, los seis intentos se quemaban en doscientos milisegundos
       seguidos y el registro quedaba muerto para siempre — cinco minutos de
       caída de Apps Script mataban todo lo que se hubiera registrado en esos
       cinco minutos. */
    if (!pendiente) {
      if (esperando) setTimeout(enviarPendientes, 5000);
      return;
    }

    enviando = true;
    alServidor(pendiente.cuerpo)
      .then(function (r) {
        var listo = r && r.ok;
        /* ⚠️ CASI NADA SE DESCARTA POR «INVÁLIDO». Eso costó un registro real:
           el servidor rechazaba un teléfono argentino, el cliente leía
           «invalido» y borraba el envío de la cola, y esa persona no quedaba en
           ninguna parte. Hoy el servidor guarda hasta lo que no entiende.

           Las dos excepciones no tienen nada que perder: `sin_datos` es un
           cuerpo que llegó VACÍO —no hay dato que guardar— y `accion_desconocida`
           es un envío que este servidor nunca va a aceptar. Reintentarlos es
           mandar una petición y escribir una línea de bitácora en cada visita,
           para siempre: `arrancarCola` les devuelve los intentos cada vez que
           alguien abre el sitio, así que sin esto no se limpian nunca. */
        var motivo = (r && r.motivo) || '';
        var irrecuperable = motivo === 'sin_datos' || motivo === 'accion_desconocida';

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
          /* El servidor contestó, pero mal. Se cuenta el intento y se espera
             cada vez más antes del siguiente: 2, 4, 8, 16 segundos. Insistir de
             corrido sólo sirve para quemar los seis intentos contra una caída
             que iba a durar un minuto. */
          var cola2 = leerCola();
          for (var k = 0; k < cola2.length; k++) {
            if (cola2[k] && cola2[k].id === pendiente.id) {
              cola2[k].intentos = (cola2[k].intentos || 0) + 1;
              cola2[k].proximo = Date.now() + Math.min(Math.pow(2, cola2[k].intentos) * 1000, 60000);
            }
          }
          if (!escribir(K_PENDIENTES, cola2)) { enviando = false; return; }
          enviando = false;
          setTimeout(enviarPendientes, 2000);
          return;
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
    /* ⚠️ CADA VISITA LES DA OTRA OPORTUNIDAD A LOS QUE SE RINDIERON. Lo que
       agotó sus intentos contra una caída de Apps Script no está mal: está
       esperando a que Google vuelva. Sin esto quedaba en el teléfono para
       siempre, sin que nadie —ni la persona, ni el equipo, ni la bitácora— se
       enterara de que existía. */
    var cola = leerCola(), tocado = false;

    /* ⚠️ PERO NO PARA SIEMPRE. Un envío que el servidor rechaza de forma
       determinista y que no cae en la lista de irrecuperables —un cuerpo
       corrupto, algo de una versión vieja de la app— se quedaría en el teléfono
       reintentando en cada visita durante años. Treinta días es más que
       suficiente para cualquier caída de Apps Script, y es el único caso en que
       este archivo tira algo: por eso el número es holgado y no dos días. */
    var VENCE_MS = 30 * 24 * 60 * 60 * 1000, ahora = Date.now();
    var vivos = cola.filter(function (x) {
      return !(x && x.creado && (ahora - x.creado) > VENCE_MS);
    });
    if (vivos.length !== cola.length) { cola = vivos; tocado = true; }

    for (var i = 0; i < cola.length; i++) {
      if (cola[i] && (cola[i].intentos || 0) >= MAX_INTENTOS) {
        cola[i].intentos = 0; cola[i].proximo = 0; tocado = true;
      }
    }
    if (tocado) escribir(K_PENDIENTES, cola);

    enviarPendientes();
    window.addEventListener('online', enviarPendientes);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) enviarPendientes();
    });
  }

  window.CXV = {
    leer: leer, escribir: escribir, leerCola: leerCola,
    dispositivoId: dispositivoId, alServidor: alServidor,
    guardarPersona: guardarPersona, guardarEmpresa: guardarEmpresa,
    enviarPendientes: enviarPendientes,
    arrancarCola: arrancarCola, hayRed: hayRed
  };
})();
