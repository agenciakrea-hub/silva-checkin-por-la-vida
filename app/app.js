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
  var K_REGALO = 'cxv.regalo';   // si ya encargó un Héroe para otra persona

  var $ = function (id) { return document.getElementById(id); };

  // Todo esto vive en cola.js, que el sitio carga también. ⚠️ La app tiene que
  // vaciar la misma cola que llena el formulario: quien se registra navega
  // hasta acá en el mismo instante en que sale el alta, el envío se corta por
  // la mitad, y si la app no lo reintentara ese registro no llegaría nunca.
  // ⚠️ SIN ESTO LA APP SE QUEDA MUDA HASTA 27 SEGUNDOS. Apps Script arranca en
  // frío en más de 21 s (medido), y hasta que contesta no aparecía ni el pase
  // ni el formulario para buscarlo: quien abría el enlace desde WhatsApp veía
  // una pantalla sin nada suyo y concluía que su pase no existía.
  // Y sin corte por tiempo, una petición colgada dejaba esa pantalla así para
  // siempre: `fetch` no falla solo.
  var TOPE_MS = 9000;          // para leer: si tarda más, se muestra el respaldo
  var TOPE_ESCRIBIR_MS = 40000;  // para escribir: Apps Script en frío pasa de 20 s

  function conTope(promesa, ms) {
    return new Promise(function (resolver, rechazar) {
      var reloj = setTimeout(function () { rechazar(new Error('tardó demasiado')); }, ms || TOPE_MS);
      promesa.then(function (v) { clearTimeout(reloj); resolver(v); },
                   function (e) { clearTimeout(reloj); rechazar(e); });
    });
  }

  var leer          = window.CXV.leer;
  var escribir      = window.CXV.escribir;
  var dispositivoId = window.CXV.dispositivoId;
  var alServidor    = window.CXV.alServidor;

  var textoWa = function (m) {
    return 'https://wa.me/' + TEL + '?text=' + encodeURIComponent(m);
  };

  // ── Pintar ───────────────────────────────────────────────────────────────

  // El orden es el del viaje. La hoja `vuelo` sólo tiene que decir en cuál está.
  var ETAPAS = ['preparando', 'asignando', 'en_curso', 'completado'];

  var ESTADOS = {
    preparando: 'Preparando',
    asignando:  'Asignando',
    en_curso:   'En vuelo',
    completado: 'Completada'
  };

  // Un porcentaje no cuenta en qué anda un vuelo; las etapas sí. Sólo la de hoy
  // lleva peso: las anteriores están hechas y las siguientes no son noticia.
  function pintarEtapas(estado) {
    var i = ETAPAS.indexOf(estado);
    if (i < 0) i = 0;
    ETAPAS.forEach(function (nombre, k) {
      var li = document.querySelector('.etapa[data-etapa="' + nombre + '"]');
      if (!li) return;
      li.removeAttribute('data-hecha');
      li.removeAttribute('data-ahora');
      li.removeAttribute('aria-current');
      if (k < i) li.setAttribute('data-hecha', '');
      if (k === i) { li.setAttribute('data-ahora', ''); li.setAttribute('aria-current', 'step'); }
    });
  }

  function pintarVuelo(v) {
    if (!v) return;
    if (v.titulo)  $('vuelo-titulo').textContent = v.titulo;
    if (v.origen)  $('origen').textContent  = v.origen;
    if (v.destino) $('destino').textContent = v.destino;
    if (v.nota)    $('vuelo-nota').textContent = v.nota;
    // Lo manda el servidor en cada respuesta y la app lo descartaba.
    if (v.proximo) { $('proximo').textContent = v.proximo; $('proximo-caja').hidden = false; }
    else $('proximo-caja').hidden = true;
    $('d-estado').textContent = ESTADOS[v.estado] || v.estado || 'Preparando';
    pintarEtapas(v.estado || 'preparando');

    /* Los números del Sheet le ganan a `datos.js`, si vienen. Sirve para que
       el jefe corrija el avance cambiando una celda, sin tocar el repo ni
       esperar a que GitHub Pages publique.

       ⚠️ SÓLO SI VIENEN LOS DOS Y SON NÚMEROS. La hoja devuelve todo como
       texto, y la celda arranca vacía a propósito: vacía significa «manda
       `datos.js`», que es lo que ya pintó `arrancar()` hace rato. Un `Number('')`
       da 0 —no NaN—, así que preguntar por el texto vacío ANTES de convertir no
       es una precaución de más: sin eso, una celda en blanco pinta la campaña
       en cero y borra el avance real de la portada. */
    var a = numeroDeHoja(v.adoptados), m = numeroDeHoja(v.meta);
    if (a !== null && m !== null && m > 0) pintarAvance(a, m);
  }

  /** Una celda de la hoja `vuelo` como número, o null si no lo es. */
  function numeroDeHoja(t) {
    if (t === null || t === undefined) return null;
    var s = String(t).trim();
    if (s === '') return null;
    var n = Number(s);
    return (isFinite(n) && n >= 0) ? n : null;
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

  // ── Misiones ─────────────────────────────────────────────────────────────
  //
  // La mecánica de juego que pidió el cliente, sin puntos ni insignias: esta
  // campaña es sobre niños con cáncer y un marcador con premios estaría fuera
  // de lugar. Cada misión es algo que de verdad acerca la ruta a despegar.
  //
  // La primera nace cumplida a propósito: quien llega acá ya activó su pase, y
  // empezar con algo logrado es lo que hace que quiera seguir.

  var META_TRIPU = 2;

  function primerNombre(v) {
    return String(v || '').trim().split(/\s+/)[0] || '';
  }

  function enlacePropio(id) {
    return location.origin + '/?de=' + encodeURIComponent(id);
  }

  var TILDE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" ' +
              'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M4 12.5l5.5 5.5L20 7"/></svg>';
  var PERSONA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
                '<path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-4 0-7 2-7 4.5V21h14v-2.5C19 16 16 14 12 14z"/></svg>';

  function pintarMisiones(yo) {
    var n = Number(yo && yo.tripulacion) || 0;
    var regalo = leer(K_REGALO, null) === 'si';
    /* ⚠️ EL NOMBRE ALCANZA. Quien completó el formulario ya activó su pase,
       aunque el servidor tarde veinte segundos en devolverle un id. Atando
       esta misión al id, el contador le decía «0 de 4» justo en el momento en
       que acababa de hacer la primera — que es exactamente lo contrario de lo
       que la mecánica busca. */
    var tienePase = !!(yo && (yo.ticket || yo.id || yo.nombre || yo.nombreCompleto));
    var compro = !!(yo && yo.ticket);

    var lista = [
      { hecha: tienePase,
        titulo: 'Activa tu Boarding Pass',
        texto: 'Listo: ya eres pasajero de honor de esta ruta.' },

      { hecha: n >= META_TRIPU,
        titulo: 'Suma 2 personas a tu tripulación',
        texto: n === 0 ? 'Comparte tu enlace. Quien entre por él viaja contigo.'
             : n === 1 ? 'Una ya se sumó. Con una más, tu tripulación está completa.'
             : 'Ya son ' + n + '. Tu tripulación está completa.',
        asientos: n,
        // La recompensa no puede ser sólo un tilde: la consecuencia es lo que
        // hace que valga la pena.
        produce: n >= META_TRIPU ? null : 'Cada persona que entra suma su Héroe a esta ruta',
        accion: n >= META_TRIPU ? null : { texto: 'Invitar', como: 'invitar' } },

      { hecha: compro,
        titulo: 'Vincula tu pase de papel',
        texto: compro ? 'Tu pase impreso está vinculado a esta cuenta.'
                      : '¿Compraste tu Héroe en el evento? Escribe el número de tu pase.',
        campo: !compro },

      { hecha: regalo,
        titulo: 'Regala un Héroe de Rescate',
        texto: regalo ? 'Gracias. Ese Héroe viaja por alguien más.'
                      : 'A alguien que quieras, o a un paciente de la próxima ruta.',
        /* ⚠️ ESTA MISIÓN ERA IMPOSIBLE. Estaba en `hecha: false` fijo, así que
           el techo real del contador era «3 de 4» y el mensaje de «las
           completaste todas» nunca corría: código muerto. Una lista donde la
           última tarea no se puede terminar entrena a la persona a ignorar el
           contador entero.
           Se resuelve preguntando: se abre WhatsApp y al volver la app pregunta
           si lo encargó. En una campaña solidaria, confiar en la respuesta es
           lo correcto y no cuesta nada. */
        accion: regalo ? null : { texto: 'Regalar', como: 'regalar', suave: true },
        confirmar: !regalo && leer(K_REGALO, null) === 'preguntando' }
    ];

    var caja = $('lista-mis');
    caja.innerHTML = '';
    var hechas = 0;

    lista.forEach(function (m) {
      if (m.hecha) hechas++;
      var li = document.createElement('li');
      li.className = 'mis';
      if (m.hecha) li.setAttribute('data-hecha', '');

      var marca = document.createElement('span');
      marca.className = 'mis-marca';
      if (m.hecha) marca.innerHTML = TILDE;
      li.appendChild(marca);

      var cuerpo = document.createElement('div');
      cuerpo.className = 'mis-cuerpo';
      var b = document.createElement('b'); b.textContent = m.titulo;
      var pp = document.createElement('p'); pp.textContent = m.texto;
      cuerpo.appendChild(b); cuerpo.appendChild(pp);

      // La tripulación se ve, no se cuenta de memoria.
      if (m.produce) {
        var pr = document.createElement('p');
        pr.className = 'mis-produce';
        pr.textContent = m.produce;
        cuerpo.appendChild(pr);
      }

      if (typeof m.asientos === 'number') {
        var fila = document.createElement('div');
        fila.className = 'mis-asientos';
        fila.setAttribute('role', 'img');
        fila.setAttribute('aria-label',
          m.asientos === 0 ? 'Ninguna persona se sumó todavía'
          : m.asientos === 1 ? 'Una persona se sumó por tu enlace'
          : m.asientos + ' personas se sumaron por tu enlace');
        for (var i = 0; i < Math.max(META_TRIPU, m.asientos); i++) {
          var a = document.createElement('span');
          a.className = 'mis-asiento';
          if (i < m.asientos) a.setAttribute('data-ocupado', '');
          a.innerHTML = PERSONA;
          fila.appendChild(a);
        }
        cuerpo.appendChild(fila);
      }

      if (m.campo) {
        var f = document.createElement('form');
        f.className = 'mis-fila';
        f.noValidate = true;
        f.innerHTML = '<input name="ticket" type="text" autocomplete="off" ' +
                      'aria-label="Número de tu Boarding Pass" placeholder="Ej.: BP-0042">' +
                      '<button type="submit">Vincular</button>';
        var av = document.createElement('p');
        av.className = 'mis-aviso'; av.setAttribute('role', 'alert');
        f.addEventListener('submit', function (e) { e.preventDefault(); vincular(f, av); });
        cuerpo.appendChild(f); cuerpo.appendChild(av);
      }

      // «¿Ya lo encargaste?» — aparece al volver de WhatsApp.
      if (m.confirmar) {
        var pre = document.createElement('div');
        pre.className = 'mis-confirma';
        var si = document.createElement('button');
        si.type = 'button'; si.className = 'mis-accion'; si.textContent = 'Sí, ya lo encargué';
        si.addEventListener('click', function () { escribir(K_REGALO, 'si'); arrancar(); });
        var no = document.createElement('button');
        no.type = 'button'; no.className = 'mis-accion suave'; no.textContent = 'Todavía no';
        no.addEventListener('click', function () { escribir(K_REGALO, null); arrancar(); });
        pre.appendChild(si); pre.appendChild(no);
        cuerpo.appendChild(pre);
      }

      if (m.accion) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mis-accion' + (m.accion.suave ? ' suave' : '');
        btn.textContent = m.accion.texto;
        btn.addEventListener('click', function () {
          if (m.accion.como === 'invitar') invitar();
          if (m.accion.como === 'regalar') regalar();
        });
        cuerpo.appendChild(btn);
      }

      li.appendChild(cuerpo);
      caja.appendChild(li);
    });

    var barra = $('mis-barra');
    barra.innerHTML = '';
    for (var b2 = 0; b2 < lista.length; b2++) {
      var seg = document.createElement('i');
      if (b2 < hechas) seg.setAttribute('data-hecha', '');
      barra.appendChild(seg);
    }

    $('mis-hechas').textContent = String(hechas);
    $('mis-total').textContent  = String(lista.length);
    $('misiones-bajada').textContent = hechas >= lista.length
      ? 'Las completaste todas. Gracias de verdad.'
      : 'Cada una acerca la ruta a despegar.';
  }

  // ── Tu aporte y la fecha de las cifras ───────────────────────────────────

  function pintarAporte(vuelo) {
    var c = cifrasDeLaCampana();
    if (c) $('a-meta').textContent = String(c.meta);
    if (vuelo && vuelo.origen)  $('a-origen').textContent  = vuelo.origen;
    if (vuelo && vuelo.destino) $('a-destino').textContent = vuelo.destino;
  }

  // «Cuándo fue verdad esto» es señal de confianza para quien aportó, y el dato
  // ya viene en datos.js: el sitio lo muestra y la app lo ignoraba.
  function pintarFecha() {
    var d = window.CAMPANA;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.actualizado || '')) return;
    var partes = d.actualizado.split('-');
    var meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                 'septiembre','octubre','noviembre','diciembre'];
    var mes = meses[parseInt(partes[1], 10) - 1];
    if (!mes) return;
    $('pie-fecha').textContent =
      'Cifras actualizadas el ' + parseInt(partes[2], 10) + ' de ' + mes + ' de ' + partes[0] + '.';
    $('pie-fecha').hidden = false;
  }

  // ── Cierre de la ruta ────────────────────────────────────────────────────

  function pintarCierre(vuelo) {
    if (!vuelo || vuelo.estado !== 'completado') { $('cierre').hidden = true; return; }
    /* Con la ruta terminada, la barra de avance y el «próximo paso» sobran y se
       contradicen con el cartel que dice que se completó. */
    $('barra-caja').hidden = true;
    $('proximo-caja').hidden = true;
    if (vuelo.titulo) $('cierre-titulo').textContent = vuelo.titulo + ' se completó';
    /* El equipo escribe el cierre en la hoja: quiénes viajaron, cómo salió. Sin
       eso queda un agradecimiento genérico, que es lo justo pero no dice nada. */
    if (vuelo.cierre) $('cierre-nota').textContent = vuelo.cierre;
    $('cierre').hidden = false;
  }

  /* ⚠️ REGISTRADO NO ES LO MISMO QUE ACTIVADO. Quien completó el formulario
     está adentro y sus datos están guardados —que es lo que la campaña
     necesita—, pero el pase, la ruta y las misiones son de quien adoptó un
     Héroe de verdad. Sin código: el pase se ve a la espera, sin número, y lo
     primero que aparece es cómo activarlo. */
  function pintarActivacion(yo) {
    var activo = !!(yo && yo.activo);
    $('activar-pase').hidden = activo;
    $('pase-falta').hidden   = activo;
    if (activo) $('pase').removeAttribute('data-falta');
    else        $('pase').setAttribute('data-falta', '');
    // Las secciones que hablan de «tu» aporte no aplican a quien no aportó.
    var aporte = document.querySelector('.aporte');
    if (aporte) aporte.hidden = !activo;
    $('misiones').hidden = !activo;
    return activo;
  }

  function pintarPersona(yo) {
    // El completo en el pase —en un boarding pass el nombre es el documento— y
    // el de pila en el rótulo, que tiene que entrar en una línea.
    $('d-nombre').textContent = yo.nombreCompleto || yo.nombre || '—';
    /* ⚠️ NUNCA EL `id` INTERNO. `P507E6F3712` es una clave de base de datos y
       en la línea que dice «N.º de pase» se lee como un error del sistema.
       Lo que va acá es lo que la persona tiene escrito en algún lado: el
       número del pase de papel si lo vinculó, o su código de activación. */
    $('d-pase').textContent = yo.activo ? (yo.ticket || yo.codigo || '—') : '—';
    // El nombre arriba del todo: es el pase de esa persona, no un pase genérico.
    var pila = primerNombre(yo.nombre || yo.nombreCompleto || '');
    $('pase-rotulo').textContent = pila ? ('Boarding de ' + pila) : 'Boarding Pass solidario';
    $('pase').hidden   = false;
    $('entrar').hidden = true;
    pintarActivacion(yo);
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
    // Sin pase no hay misiones que mostrar: son de la persona, no de la ruta.
    $('misiones').hidden = true;
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

  // Un fallo de conexión y «no estás registrado» son dos cosas distintas, y
  // mezclarlas es el error más caro: a quien tiene su pase perfectamente
  // válido se le decía «entra a tu pase», escribía su teléfono, fallaba otra
  // vez, y terminaba creyendo que perdió lo que compró.
  function pintarSinConexion() {
    if (leer(K_PERFIL, null)) return;          // ya tiene su pase en pantalla
    $('entrar').hidden = false;
    $('entrar-titulo').textContent = 'No pudimos conectarnos';
    $('entrar-texto').textContent =
      'Tu Boarding Pass está a salvo: es el servidor el que no responde. '
      + 'Vuelve a intentarlo en un momento.';
    $('form-entrar').hidden = true;
    $('btn-reintentar').hidden = false;
  }

  function limpiarSinConexion() {
    $('entrar-titulo').textContent = 'Busca tu Boarding Pass';
    $('entrar-texto').textContent =
      'Escribe el teléfono con el que te registraste y lo recuperamos.';
    $('form-entrar').hidden = false;
    $('btn-reintentar').hidden = true;
  }

  /* ⚠️ `arrancar()` SE LLAMABA UNA SOLA VEZ. Si ese pedido fallaba —y Apps
     Script devuelve HTML más seguido de lo que parece: cuota, despliegue,
     arranque en frío— la app se quedaba con los valores de respaldo del HTML,
     la etapa del vuelo equivocada incluida, sin ninguna señal y sin forma de
     recuperarse salvo recargar a mano. Comprobado en producción: la hoja decía
     «en vuelo» y la pantalla seguía en «reuniendo Héroes».
     Ahora insiste, con espera creciente, y recién avisa cuando de verdad no
     hay caso. */
  var REINTENTOS = 4;
  var intento = 0;

  function reintentarEstado() {
    if (intento >= REINTENTOS) return false;
    intento++;
    setTimeout(arrancar, Math.min(Math.pow(2, intento) * 1000, 20000));
    return true;
  }

  function arrancar() {
    // Sin servidor configurado la app igual sirve: muestra la ruta con los
    // valores que ya están en el HTML. Vale también para un navegador sin
    // fetch, que en el público de esta campaña no es una hipótesis.
    // Las cifras primero y sin depender del servidor: son las mismas que la
    // portada y tienen que coincidir con ella aunque Apps Script no conteste.
    var c = cifrasDeLaCampana();
    if (c) pintarAvance(c.adoptados, c.meta);
    pintarAporte(null);
    pintarFecha();

    // ⚠️ SE PINTA EL PASE ANTES DE HABLAR CON EL SERVIDOR, con lo que el
    // formulario acaba de guardar en el teléfono. Apps Script en frío tarda más
    // de 20 segundos: esperar su respuesta para recién ahí mostrar algo dejaría
    // a quien se acaba de registrar mirando una pantalla vacía justo en el
    // momento de más entusiasmo.
    var perfil = leer(K_PERFIL, null);
    if (perfil && perfil.nombre) {
      var yoLocal = { nombre: primerNombre(perfil.nombre), nombreCompleto: perfil.nombre,
                      ticket: perfil.ticket || '', id: (leer(K_YO, {}) || {}).id || '',
                      tripulacion: 0 };
      /* Lo que el teléfono sabe no incluye si está activa: eso lo dice el
         servidor. Hasta que conteste se asume que falta, que es el caso más
         probable de alguien que acaba de llegar. */
      pintarPersona(yoLocal);
      /* ⚠️ Y LAS MISIONES TAMBIÉN. `pintarPersona` muestra el bloque, pero
         dibujarlo es otra función: sin esta línea, quien se acababa de
         registrar veía el panel de misiones con el contador «1 de 4» del HTML
         y la lista vacía debajo. Es lo primero que le apareció a Krea. */
      $('d-pase').textContent = '—';
    }

    if (!API || typeof fetch !== 'function') { pintarDesconocido(); return; }

    var yo = leer(K_YO, null);

    // Mientras se espera, se dice que se está buscando. Es lo que separa «esto
    // está trabajando» de «esto está roto».
    var perfilLocal = leer(K_PERFIL, null);
    if (!perfilLocal) {
      $('entrar').hidden = false;
      $('entrar-titulo').textContent = 'Buscando tu Boarding Pass…';
      $('entrar-texto').textContent = 'Un momento.';
      $('form-entrar').hidden = true;
    }

    conTope(alServidor({ action: 'estado', token: (yo && yo.token) || '' }))
      .then(function (r) {
        // El servidor no contestó JSON: es un problema de conexión o de
        // despliegue, no que esta persona no exista. Se vuelve a intentar antes
        // de contarle nada a nadie.
        if (!r || (!r.ok && r.motivo === 'respuesta_no_json')) {
          if (reintentarEstado()) return;
          limpiarSinConexion();
          pintarSinConexion();
          return;
        }
        limpiarSinConexion();
        intento = 0;
        if (!r.ok) { pintarDesconocido(); return; }
        pintarVuelo(r.vuelo);
        pintarAporte(r.vuelo);
        pintarCierre(r.vuelo);
        if (r.yo) {
          pintarPersona(r.yo);
          if (r.yo.activo) pintarMisiones(r.yo);
        }
        else {
          // El token guardado ya no vale: se descarta para no volver a
          // mandarlo en cada arranque.
          if (yo) { try { localStorage.removeItem(K_YO); } catch (e) {} }
          pintarDesconocido();
        }
      })
      .catch(function () {
        if (reintentarEstado()) return;
        pintarSinConexion();
      });
  }

  // ── Enganches ────────────────────────────────────────────────────────────

  $('form-entrar').addEventListener('submit', function (e) {
    e.preventDefault();
    var campo = this.elements.telefono;
    var v = (campo.value || '').trim();
    campo.setAttribute('aria-invalid', 'false');
    if (!v) {
      $('entrar-aviso').textContent = 'Escribe tu teléfono.';
      campo.setAttribute('aria-invalid', 'true');
      campo.focus();
      return;
    }
    $('elegir').hidden = true;
    entrar(v);
  });

  function compartir(texto, url) {
    if (navigator.share) {
      navigator.share({ title: 'Un Check-in por la Vida', text: texto, url: url })
        .catch(function () {});
      return;
    }
    window.open(textoWa(texto + ' ' + url), '_blank', 'noopener');
  }

  $('btn-otra-ruta').addEventListener('click', function () {
    window.open(textoWa('Hola, mi ruta se completó y quiero sumarme a la próxima con otro Héroe de Rescate.'), '_blank', 'noopener');
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

  // Para quién es lo que se encarga. Son las tres salidas que pidió el cliente
  // —otro para mí, un regalo, o uno que reciba un paciente— y cada una cambia
  // el mensaje: quien atiende el WhatsApp necesita saberlo para preparar el
  // pedido, no es un detalle decorativo.
  var DESTINO = {
    mio:    { frase: 'Quiero encargar', cola: '' },
    regalo: { frase: 'Quiero regalar',  cola: '\n\nEs un regalo.' },
    donar:  { frase: 'Quiero donar',    cola: '\n\nQuiero que lo reciba un paciente de la próxima ruta.' }
  };

  function destinoElegido() {
    var r = document.querySelector('input[name="destino"]:checked');
    return DESTINO[(r && r.value) || 'mio'] || DESTINO.mio;
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
    var d = destinoElegido();
    window.open(textoWa(
      'Hola, vengo de mi Boarding Pass de Un Check-in por la Vida. ' + quien +
      d.frase + ':\n\n' + lineas.join('\n') +
      '\n\nTotal: $' + t.suma + d.cola + pase), '_blank', 'noopener');
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

  // ── Lo que hacen las misiones ────────────────────────────────────────────

  function invitar() {
    var yo = leer(K_YO, null);
    // Sin id no hay enlace propio, pero la campaña sí: se comparte igual en
    // vez de dejar el botón muerto.
    var url = (yo && yo.id) ? enlacePropio(yo.id) : location.origin + '/';
    compartir('Adopté un Héroe de Rescate para que personas con cáncer lleguen a su tratamiento en Caracas. Súmate a mi tripulación:', url);
  }

  function regalar() {
    // Se anota que se preguntó: al volver, la misión ofrece confirmarlo.
    escribir(K_REGALO, 'preguntando');
    setTimeout(arrancar, 400);
    window.open(textoWa(
      'Hola, vengo de mi Boarding Pass de Un Check-in por la Vida. Quiero regalar un Héroe de Rescate. '
      + '¿Me puedes decir cómo?'), '_blank', 'noopener');
  }

  function vincular(form, aviso) {
    var campo = form.elements.ticket;
    var t = (campo.value || '').trim();
    campo.setAttribute('aria-invalid', 'false');
    if (!t) {
      aviso.textContent = 'Escribe el número de tu Boarding Pass.';
      campo.setAttribute('aria-invalid', 'true'); campo.focus(); return;
    }
    var yo = leer(K_YO, null);
    if (!yo || !yo.token) {
      aviso.textContent = 'Espera unos segundos a que se active tu pase y vuelve a intentarlo.';
      return;
    }
    aviso.textContent = 'Vinculando…';
    conTope(alServidor({ action: 'vincular', token: yo.token, ticket: t }), TOPE_ESCRIBIR_MS)
      .then(function (r) {
        if (r && r.ok) {
          aviso.textContent = '';
          var perfil = leer(K_PERFIL, {}) || {};
          perfil.ticket = r.ticket || t;
          escribir(K_PERFIL, perfil);
          $('d-pase').textContent = perfil.ticket;
          // Se vuelven a pintar: esa misión pasa a estar cumplida.
          arrancar();
          return;
        }
        campo.setAttribute('aria-invalid', 'true');
        aviso.textContent = (r && r.motivo === 'ticket_invalido')
          ? 'Ese número no parece un Boarding Pass. Revísalo.'
          : 'No pudimos vincularlo. Intenta de nuevo en un momento.';
      })
      .catch(function () { aviso.textContent = 'No pudimos conectarnos. Revisa tu conexión.'; });
  }

  // ── Activar el pase ──────────────────────────────────────────────────────

  var MOTIVOS = {
    codigo_invalido:    'Ese código no tiene la forma correcta. Debe ser como ONCO-4K7M.',
    codigo_desconocido: 'No encontramos ese código. Revisa que esté bien escrito.',
    codigo_usado:       'Ese código ya se usó. Si crees que es un error, escríbenos.',
    ya_activo:          'Tu pase ya está activo.',
    token_invalido:     'Espera unos segundos a que termine tu registro y vuelve a intentarlo.',
    sin_token:          'Espera unos segundos a que termine tu registro y vuelve a intentarlo.'
  };

  $('form-activar').addEventListener('submit', function (e) {
    e.preventDefault();
    var campo = this.elements.codigo;
    var aviso = $('activar-aviso');
    var c = (campo.value || '').trim();
    campo.setAttribute('aria-invalid', 'false');
    if (!c) {
      aviso.textContent = 'Escribe el código que vino con tu Héroe.';
      campo.setAttribute('aria-invalid', 'true'); campo.focus(); return;
    }
    var yo = leer(K_YO, null);
    if (!yo || !yo.token) {
      aviso.textContent = MOTIVOS.sin_token;
      return;
    }
    aviso.textContent = 'Activando…';
    /* ⚠️ CUARENTA SEGUNDOS, NO NUEVE, Y EL MOTIVO ES CARO. Con el tope de
       lectura, Apps Script arrancando en frío —más de 20 s medidos— hacía que
       la app cortara la espera y dijera «revisa tu conexión». Pero el servidor
       SÍ había activado el código: la persona veía un error, su código quedaba
       gastado, y creía que lo había perdido. Le pasó a Krea con ONCO-7TXA.
       Escribir no es leer: si el pedido salió, hay que esperarlo. */
    conTope(alServidor({ action: 'activar', token: yo.token, codigo: c }), TOPE_ESCRIBIR_MS)
      .then(function (r) {
        if (r && r.ok) {
          aviso.textContent = '';
          var perfil = leer(K_PERFIL, {}) || {};
          perfil.codigo = r.codigo;
          escribir(K_PERFIL, perfil);
          arrancar();          // se vuelve a pedir todo: ahora hay pase
          return;
        }
        campo.setAttribute('aria-invalid', 'true');
        aviso.textContent = (r && MOTIVOS[r.motivo])
          || 'No pudimos activarlo. Intenta de nuevo en un momento.';
      })
      .catch(function () {
        /* ⚠️ NO SE PUEDE DECIR QUE FALLÓ. El pedido pudo haber llegado y haber
           activado el código igual; decir «no se pudo» empuja a la persona a
           intentar con otro código y a gastar dos. Se mira cómo quedó todo
           antes de contarle nada. */
        aviso.textContent = 'Está tardando más de lo normal. Verificando…';
        conTope(alServidor({ action: 'estado', token: yo.token }), TOPE_ESCRIBIR_MS)
          .then(function (r2) {
            if (r2 && r2.ok && r2.yo && r2.yo.activo) {
              aviso.textContent = '';
              arrancar();
              return;
            }
            aviso.textContent = 'No pudimos confirmarlo. Espera un momento y vuelve a intentar '
              + 'con el mismo código: si ya quedó activado, te lo vamos a decir.';
          })
          .catch(function () {
            aviso.textContent = 'No pudimos conectarnos. Tu código sigue siendo válido: '
              + 'vuelve a intentar con el mismo en un momento.';
          });
      });
  });

  $('btn-quiero').addEventListener('click', function () {
    var perfil = leer(K_PERFIL, null);
    var quien = (perfil && perfil.nombre) ? (' Soy ' + perfil.nombre + '.') : '';
    window.open(textoWa('Hola, vengo de Un Check-in por la Vida y quiero adoptar un Héroe de Rescate.'
      + quien + ' ¿Cómo lo hago?'), '_blank', 'noopener');
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

  $('btn-reintentar').addEventListener('click', function () {
    $('entrar-titulo').textContent = 'Buscando tu Boarding Pass…';
    $('entrar-texto').textContent = 'Un momento.';
    $('btn-reintentar').hidden = true;
    intento = 0;          // el toque de la persona reabre el crédito de intentos
    arrancar();
  });

  $('btn-ayuda').addEventListener('click', function () {
    var perfil = leer(K_PERFIL, null);
    var quien = (perfil && perfil.nombre) ? (' Soy ' + perfil.nombre + '.') : '';
    window.open(textoWa('Hola, tengo una consulta sobre mi Boarding Pass de Un Check-in por la Vida.' + quien),
                '_blank', 'noopener');
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
