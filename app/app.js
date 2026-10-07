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
  /* El `?de=` de quien la invitó, guardado hasta que haya un token con el cual
     anotarlo. Sin esto, abrir el enlace de un amigo y caer en la app —en vez
     de en el formulario del sitio— perdía la invitación para siempre. */
  var K_INVITO = 'cxv.invito';
  /* El último ranking que contestó el servidor. Apps Script en frío tarda
     entre 15 y 20 segundos y el panel no tiene valores de respaldo en el HTML
     como sí los tienen las cifras: sin esto, quién abre la app y mira no ve
     nada y cierra antes de que llegue. Mismo patrón que la portada usa para
     «44 de 609», con localStorage en vez de sessionStorage porque acá lo que
     importa es la visita de mañana, no la navegación de ahora. */
  var K_RANKING = 'cxv.ranking';
  var RANKING_VIVE_MS = 24 * 60 * 60 * 1000;

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
  /* ⚠️ VEINTICINCO SEGUNDOS, Y SUBIÓ DESDE NUEVE POR UNA MEDICIÓN. Con doce
     pedidos simultáneos contra producción —doce teléfonos abriendo la app en el
     mismo momento, que es un evento chico— la mediana fue 7,4 s y el pico 21 s.
     Con el tope en 9 s, un tercio de la gente cortaba el pedido y veía los
     valores fijos del HTML; peor todavía, `reintentarEstado` volvía a pedir a
     los dos segundos y ESE reintento llegaba mientras el servidor seguía
     ocupado, o sea que el tope corto empeoraba la saturación que lo causaba.
     Esperar más no deja a nadie mirando una pantalla vacía: el contenido de
     respaldo ya está dibujado desde el primer frame y el latido dice que se
     está buscando. Lo único que cambia es cuánto aguantamos antes de rendirnos.
     Sigue habiendo corte, porque un `fetch` colgado no falla solo. */
  var TOPE_MS = 25000;         // para leer: si tarda más, se muestra el respaldo
  var TOPE_ESCRIBIR_MS = 40000;  // para escribir: Apps Script en frío pasa de 20 s

  /* ⚠️ `conTope` RECIBE UNA FUNCIÓN, NO UNA PROMESA YA LANZADA, y el cambio no
     es cosmético. Antes tomaba la promesa hecha y sólo dejaba de esperarla: el
     `fetch` seguía vivo y su ejecución corriendo en Google. Como quien llama
     reintenta, el reintento se SUMABA al anterior — hasta cinco pedidos por
     teléfono para el mismo dato, multiplicando la carga justo cuando el
     servidor ya no daba abasto.
     Recibiendo la función, `conTope` se la pasa a `alServidor` como su tope
     interno, y ése sí aborta con `AbortController`. Cada teléfono tiene como
     mucho un pedido vivo.
     Sigue aceptando una promesa ya hecha para no romper a quien lo llame así,
     pero ese camino no cancela nada y no debería usarse. */
  function conTope(promesaOFn, ms) {
    var tope = ms || TOPE_MS;
    if (typeof promesaOFn === 'function') return promesaOFn(tope);
    return new Promise(function (resolver, rechazar) {
      var reloj = setTimeout(function () { rechazar(new Error('tardó demasiado')); }, tope);
      promesaOFn.then(function (v) { clearTimeout(reloj); resolver(v); },
                      function (e) { clearTimeout(reloj); rechazar(e); });
    });
  }

  var leer          = window.CXV.leer;
  var escribir      = window.CXV.escribir;
  var dispositivoId = window.CXV.dispositivoId;
  var alServidor    = window.CXV.alServidor;

  /* ⚠️ SON DOS COSAS DISTINTAS Y CONFUNDIRLAS ROMPIÓ LA CAMPAÑA ENTERA.
     `wa.me/<numero>` escribe A ESE NÚMERO; `wa.me/` sin número abre el
     SELECTOR DE CONTACTOS para elegir a quién mandarle.
     Hasta hoy había una sola función, con el número de Aeroambulancias, y
     `compartir()` la usaba de respaldo: en cualquier navegador sin Web Share
     —el escritorio, los navegadores de Instagram y Facebook— tocar «Invitar»
     le mandaba la invitación A LA EMPRESA. Toda la mecánica de códigos de las
     fases 3 y 4 no llegaba a una sola persona por ese camino.
     Antes de usar una de las dos, preguntarse: ¿esto se lo escribo a la
     campaña, o se lo mando a un amigo? */
  var waALaEmpresa = function (m) {
    return 'https://wa.me/' + TEL + '?text=' + encodeURIComponent(m);
  };
  var waAUnContacto = function (m) {
    return 'https://wa.me/?text=' + encodeURIComponent(m);
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

  function pintarVuelo(v, ososActivados) {
    if (!v) return;
    if (v.titulo)  $('vuelo-titulo').textContent = v.titulo;
    if (v.origen)  $('origen').textContent  = v.origen;
    if (v.destino) $('destino').textContent = v.destino;
    if (v.nota)    $('vuelo-nota').textContent = v.nota;
    /* El nombre corto de la ruta, en la barra de abajo. Sale de la celda `ruta`
       de la hoja `vuelo`: cambiarla ahí lo cambia en el sitio Y en la app, sin
       tocar código. Es la misma celda que el cliente usó para pedir que diga
       «Ruta Sanitaria 001» en vez de «ONCO 001». */
    if (v.ruta && $('rf-ruta')) $('rf-ruta').textContent = v.ruta;
    textosDeLaRuta(v);
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
    if (a !== null && m !== null && m > 0) {
      /* La celda `adoptados` de la hoja, si está escrita, es la palabra final:
         se usa para corregir el avance a mano sin tocar el repo. */
      pintarAvance(a, m);
    } else {
      /* El camino normal: los osos que el servidor contó de los códigos
         activados, más el ajuste de `datos.js`. */
      /* ⚠️ LA META DE `datos.js` ES DE LA CAMPAÑA. Sin esta condición, una ruta
         de empresa con la celda `meta` vacía se medía contra los 609 de la
         campaña: «3 de 609 · faltan 606», con la barra en 0,5 %. Y con la meta
         vacía, un `adoptados` escrito a mano en esa misma fila se ignoraba en
         silencio, porque el camino de arriba exige las dos celdas. Si no es la
         campaña y la hoja no dice la meta, no hay meta que mostrar. */
      var meta = m !== null && m > 0 ? m
               : (v.esCampania === false ? null : (cifrasDeLaCampana() || {}).meta);
      /* ⚠️ EL HISTÓRICO DE `datos.js` ES DE LA CAMPAÑA, NO DE CUALQUIER RUTA.
         Desde que una empresa puede financiar su propio vuelo (2026-10-06), el
         pase de esa ruta muestra SUS osos: sumarle las 44 unidades del evento
         de la campaña sería inventarle un avance que nadie financió. El
         servidor manda `esCampania` porque la app no lo puede deducir sola.
         Sin la bandera —una respuesta vieja, o el servidor sin desplegar— se
         suma, que es como se comportó siempre y es correcto mientras haya una
         sola ruta. */
      var suyos = v.esCampania === false ? Number(ososActivados) || 0
                                         : avanceTotal(ososActivados);
      pintarAvance(suyos, meta, v.esCampania === false);
    }
  }

  /**
   * Los textos que daban por sentado que todo el mundo está en la Ruta 1.
   *
   * ⚠️ DOS FRASES QUE SON FALSAS PARA LA RUTA DE UNA EMPRESA. «Esta es la Ruta
   * 1. Faltan cinco por financiar» y el «La tuya» pegado a la Ruta 1 son de la
   * campaña: quien financió un corredor con su empresa no está en ninguna de
   * las seis. Y «Cada adopción suma horas de vuelo» describe cómo se financia
   * la campaña, no cómo se financió esa ruta.
   *
   * Se tocan sólo cuando el servidor dice que NO es la campaña: sin la bandera
   * —un servidor viejo, una respuesta guardada— queda lo que dice el HTML, que
   * es correcto mientras haya una sola ruta.
   */
  /* Los seis corredores que publica la campaña, en el mismo orden que el HTML.
     Es lo único que relaciona la hoja `vuelo` —donde el equipo escribe el
     origen y el destino a mano— con la lista de «La red completa». */
  var RUTAS_PUBLICAS = [
    ['maracaibo', 'caracas'], ['santo domingo del tachira', 'caracas'],
    ['barinas', 'caracas'],   ['puerto ayacucho', 'caracas'],
    ['puerto ordaz', 'caracas'], ['guiria', 'caracas']
  ];

  /** Sin tildes, sin espacios de sobra y en minúsculas: lo escribe una persona. */
  function pelado(s) {
    var x = String(s == null ? '' : s).trim().toLowerCase();
    return x.normalize ? x.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : x;
  }

  /** Cuál de las seis es ésta, por origen y destino. 0 si ninguna. */
  function cualDeLasSeis(v) {
    var o = pelado(v && v.origen), d = pelado(v && v.destino);
    if (!o || !d) return 0;
    for (var i = 0; i < RUTAS_PUBLICAS.length; i++) {
      if (RUTAS_PUBLICAS[i][0] === o && RUTAS_PUBLICAS[i][1] === d) return i + 1;
    }
    return 0;
  }

  /**
   * Los textos de «La red completa» y de la primera etapa, según qué ruta sea.
   *
   * ⚠️ LA RUTA DE UNA EMPRESA PUEDE SER UNA DE LAS SEIS, O NO. Lo decidió Krea
   * el 2026-10-07: una empresa puede patrocinar el mismo corredor que está
   * llenando la gente, o uno aparte. Así que no se puede escribir ni «es la
   * Ruta 1» ni «no es ninguna de las seis»: hay que mirar. Lo único que las
   * relaciona es el origen y el destino, que el equipo escribe en la hoja.
   *
   * ⚠️ Y NO SE DICE «faltan seis». Decía eso mientras a todos los demás les
   * decía «faltan cinco» en el mismo momento: son las mismas seis rutas, una de
   * las dos miente. La ruta de una empresa no cambia cuántas faltan.
   */
  function textosDeLaRuta(v) {
    var intro = $('red-intro'), sub = $('etapa-1-sub');
    var cual = cualDeLasSeis(v);

    /* El «La tuya» se pone donde corresponde y se saca de donde no. */
    for (var i = 1; i <= RUTAS_PUBLICAS.length; i++) {
      var li = $('red-ruta-' + i);
      if (!li) continue;
      if (i === cual) li.setAttribute('data-tuya', '');
      else li.removeAttribute('data-tuya');
    }

    if (!v || v.esCampania !== false) {
      /* La campaña: lo que dice el HTML, que es correcto. Se repone por si
         antes se había pintado otra ruta —un teléfono compartido—. */
      if (intro) intro.textContent = cual
        ? 'Esta es la Ruta ' + cual + '. Faltan cinco por financiar.'
        : 'Estas son las seis rutas de la campaña.';
      if (sub) sub.textContent = 'Cada adopción suma horas de vuelo';
      return;
    }

    var quien = v.patrocina ? ' la financia ' + v.patrocina : ' la financia una empresa';
    if (intro) {
      intro.textContent = cual
        ? 'Esta es la Ruta ' + cual + ', y' + quien + '. Faltan cinco por financiar.'
        : 'Tu ruta' + quien + ', fuera de las seis de la campaña. Éstas son las seis.';
    }
    /* ⚠️ NO «ya puso su parte». Decir que la ruta ya está pagada contradecía de
       frente al «Faltan 117 para completar la ruta» que está tres centímetros
       más abajo, y desde que una empresa puede patrocinar la MISMA ruta que la
       gente está llenando, es además falso: las adopciones siguen sumando. Lo
       que sí es cierto en los dos casos es quién la acompaña. */
    if (sub) {
      sub.textContent = v.patrocina ? 'Con el apoyo de ' + v.patrocina
                                    : 'Con el apoyo de una empresa';
    }
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
    /* ⚠️ SUMA UNIDADES, Y ES A PROPÓSITO: es el histórico del evento y no se
       toca. Lo que se cuenta en osos es lo que viene después, que lo suma el
       servidor con la equivalencia de cada código y se agrega encima. */
    var adoptados = null;
    if (Object.prototype.toString.call(d.productos) === '[object Array]') {
      adoptados = d.productos.reduce(function (s, p) { return s + (Number(p.vendidas) || 0); }, 0);
    }
    return (meta !== null && adoptados !== null) ? { adoptados: adoptados, meta: meta } : null;
  }

  /**
   * El avance de la campaña, que son DOS MITADES sumadas.
   *
   * ⚠️ NI EL SERVIDOR NI `datos.js` SABEN EL TOTAL SOLOS. El servidor cuenta los
   * osos de los códigos que la gente ACTIVÓ en la app — es lo único de lo que se
   * entera—; `datos.js` lleva a mano lo que se vendió y nadie va a activar
   * nunca. Mostrar sólo uno de los dos da siempre de menos.
   * El riesgo de sumarlos está escrito en `datos.js`: si el equipo carga ahí
   * algo que esa persona después activa, el mismo oso cuenta dos veces y nada
   * lo avisa. Por eso ese archivo dice, con todas las letras, que ahí va sólo lo
   * que no se va a activar.
   */
  function avanceTotal(delServidor) {
    var c = cifrasDeLaCampana();
    var aMano = c ? c.adoptados : 0;
    var auto = Number(delServidor);
    if (!isFinite(auto) || auto < 0) auto = 0;
    return aMano + auto;
  }

  /**
   * Un número como se escribe en Venezuela: coma decimal.
   *
   * ⚠️ ARRIBA DE LAS DOS FUNCIONES QUE PINTAN CIFRAS, y antes vivía adentro de
   * una sola. `pintarBarraAvance` escribía `String(44.5)` → «44.5» mientras
   * `pintarAvance` escribía «44,5», las dos en la misma pantalla. Acá el punto
   * es separador de miles: la barra fija decía «cuarenta y cuatro mil
   * quinientos». El `.0` de un entero no se muestra.
   */
  function enEspanol(n) {
    var r = Math.round(Number(n) * 10) / 10;
    if (!isFinite(r)) return String(n);
    return (r % 1 === 0 ? String(r) : String(r).replace('.', ','));
  }

  /**
   * Las seis superficies del avance, siempre juntas.
   *
   * ⚠️ ERAN SEIS Y SE CORREGÍAN DOS. `arrancar()` pinta primero la campaña
   * —44 de 609— y después llega la respuesta del servidor. Para una ruta de
   * empresa SIN la celda `meta` —que es como nace toda fila nueva, porque
   * `VUELO_INICIAL` siembra sólo la de la campaña— se corregía `c-osos` y se
   * escondía `c-faltan`, y quedaban con los números de la campaña el
   * `aria-label` de la barra, su `scaleX`, y **la barra fija de abajo, que está
   * siempre a la vista**, diciendo «44 de 609 · RUTA BANCARIBE». Ahora todo
   * pasa por acá, con o sin meta.
   *
   * ⚠️ Y LO QUE SE ESCONDE VUELVE. Esconder `c-faltan` no tenía camino inverso:
   * el equipo escribía la celda `meta`, el resto de la pantalla se corregía, y
   * esa línea se quedaba invisible hasta que la persona recargara.
   */
  function pintarAvance(adoptados, meta, sinMetaPropia) {
    if (typeof adoptados !== 'number') return;
    var hayMeta = typeof meta === 'number' && meta > 0;
    var resto = $('c-faltan') && $('c-faltan').parentNode;

    $('c-osos').textContent = enEspanol(adoptados);
    if (resto) resto.hidden = !hayMeta;

    if (!hayMeta) {
      /* Sin meta no hay proporción que mostrar: la barra se vacía y los
         rótulos dicen lo único que se sabe, cuántos van. No se deja ni un
         número de la campaña en pantalla. */
      if ($('barra')) $('barra').style.transform = 'scaleX(0)';
      if ($('barra-caja')) {
        $('barra-caja').setAttribute('aria-label',
          enEspanol(adoptados) + ' Héroes de Rescate adoptados en esta ruta');
      }
      pintarBarraAvance(adoptados, null, 0);
      return;
    }

    $('c-faltan').textContent = enEspanol(Math.max(meta - adoptados, 0));
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
    /* ⚠️ POR `enEspanol` TAMBIÉN ACÁ. Concatenando el número crudo, el rótulo
       decía «45.5 de 609» con punto y un lector de pantalla venezolano lee
       «cuarenta y cinco mil quinientos». Es el mismo arreglo que ya se hizo en
       el texto visible y en la barra fija; éste quedó porque no se ve. */
    $('barra-caja').setAttribute('aria-label',
      enEspanol(adoptados) + ' de ' + enEspanol(meta) + ' Héroes de Rescate adoptados');
    pintarBarraAvance(adoptados, meta, ancho);
  }

  /**
   * La barra fija de abajo: el avance de la ruta, siempre a la vista.
   *
   * ⚠️ LAS MISMAS CIFRAS QUE EL BLOQUE DE ARRIBA, no otras. Si esta barra
   * calculara por su cuenta, el día que las dos fórmulas se separen la app
   * mostraría dos avances distintos en la misma pantalla y ninguno sería
   * creíble. Recibe lo ya calculado.
   */
  function pintarBarraAvance(adoptados, meta, ancho) {
    var caja = $('ruta-fija');
    if (!caja) return;
    /* ⚠️ CON COMA, IGUAL QUE EL BLOQUE DE ARRIBA. Esta función escribía
       `String(44.5)` → «44.5», con punto, mientras tres centímetros más arriba
       decía «44,5». En Venezuela el punto es separador de miles: la barra fija
       leía «cuarenta y cuatro mil quinientos». Su propia cabecera dice «las
       mismas cifras que el bloque de arriba, no otras». */
    var hayMeta = typeof meta === 'number' && meta > 0;
    $('av-osos').textContent = enEspanol(adoptados);
    /* Sin meta, el «de 609» se va: dejarlo era mostrar la meta de otra ruta en
       la única barra que está siempre a la vista. */
    /* ⚠️ VACIANDO EL TEXTO, NO CON `hidden`. El «de» de la barra fija es un
       `<span>`, y el CSS del proyecto le da `display` propio, que gana sobre el
       `display:none` del atributo: quedaba «3 de Ruta Bancaribe», con un «de»
       colgando de la nada. Vaciar el texto no depende de ninguna regla, y son
       tres copias del CSS sin build. */
    if ($('av-meta')) {
      $('av-meta').textContent = hayMeta ? enEspanol(meta) : '';
      var de = $('av-meta').previousElementSibling;
      if (de && de.tagName === 'SPAN') de.textContent = hayMeta ? 'de' : '';
    }
    $('rf-lleno').style.setProperty('--avance', String(ancho / 100));
    caja.setAttribute('aria-label', hayMeta
      ? enEspanol(adoptados) + ' de ' + enEspanol(meta) + ' Héroes adoptados en esta ruta'
      : enEspanol(adoptados) + ' Héroes adoptados en esta ruta');
    mostrarBarraAvance();
  }

  /* ⚠️ DOS BARRAS FIJAS ABAJO SE PISAN. La de instalar es temporal —se cierra
     y no vuelve—, así que mientras está manda ella; el avance vuelve solo en
     cuanto la otra se va. Sin esta coordinación, en un teléfono nuevo el botón
     «Guardar» quedaba debajo del botón de aportar y no se podía tocar. */
  function mostrarBarraAvance() {
    var caja = $('ruta-fija');
    if (!caja) return;
    var instalarVisible = !!($('instalar') && !$('instalar').hidden);
    caja.hidden = instalarVisible;
    if (instalarVisible) document.body.removeAttribute('data-rutafija');
    else document.body.setAttribute('data-rutafija', '');
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

  /**
   * El enlace que la persona comparte.
   *
   * ⚠️ PREFIERE EL CÓDIGO LEGIBLE AL ID INTERNO. `?de=ARELLANO-7K2` se puede
   * dictar por teléfono y se reconoce en la barra del navegador; `?de=P3236C55BE6`
   * no se puede ni leer en voz alta. El id sigue funcionando —el servidor
   * entiende los dos— porque los enlaces ya compartidos lo llevan.
   */
  function enlacePropio(yo) {
    var quien = (yo && (yo.invitacion || yo.id)) || '';
    return location.origin + '/?de=' + encodeURIComponent(quien);
  }

  /** El `?de=` de la dirección, si vino uno. */
  function invitacionDeLaUrl() {
    try {
      var m = /[?&]de=([^&#]+)/.exec(location.search);
      return m ? decodeURIComponent(m[1]).trim().slice(0, 24) : '';
    } catch (e) { return ''; }
  }

  /**
   * Anota quién invitó a esta persona, en cuanto haya un token con el cual
   * hacerlo. Se llama en cada arranque: si no hay nada pendiente no hace nada,
   * y si el servidor dice que ya tenía padrino, se deja de insistir.
   */
  function anotarQuienInvito(yo) {
    var pendiente = leer(K_INVITO, null);
    if (!pendiente || !yo || !yo.token) return;
    alServidor({ action: 'invitado', token: yo.token, codigo: pendiente })
      .then(function (r) {
        /* Se borra tanto si se anotó como si el servidor lo rechazó por un
           motivo que no va a cambiar. Reintentar un código inexistente en cada
           arranque es gastar un pedido por visita para siempre. */
        if (r && (r.ok || r.motivo === 'codigo_desconocido' ||
                  r.motivo === 'es_de_activacion' || r.motivo === 'es_el_propio')) {
          try { localStorage.removeItem(K_INVITO); } catch (e) {}
          if (r.ok && !r.yaEstaba) arrancar();
        }
      })
      .catch(function () {});   // sin señal: queda pendiente para la próxima
  }

  var TILDE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" ' +
              'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M4 12.5l5.5 5.5L20 7"/></svg>';
  var PERSONA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
                '<path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-4 0-7 2-7 4.5V21h14v-2.5C19 16 16 14 12 14z"/></svg>';

  function pintarMisiones(yo) {
    /* ⚠️ APAGAR CON CSS NO ALCANZA. La tarjeta bloqueada se ve apagada, pero
       sus botones siguen respondiendo al toque: alguien sin el pase activado
       podía abrir WhatsApp desde «Regalar» o mandar un ticket a vincular. Se
       apagan de verdad al final de esta función. */
    var conLlave = !!(yo && yo.activo);
    var n = Number(yo && yo.tripulacion) || 0;
    /* Los que entraron por su enlace y todavía no activaron. Se restan los que
       sí, porque el servidor manda el total de registrados, no la diferencia. */
    var pendientes = Math.max((Number(yo && yo.tripulacionRegistrados) || 0) - n, 0);
    var regalo = leer(K_REGALO, null) === 'si';
    /* ⚠️ LA MISIÓN USA EL MISMO CRITERIO QUE LA LLAVE, Y NO PUEDE SER OTRO.
       Decía «el nombre alcanza» y aceptaba `yo.nombre`, que lo tiene cualquiera
       que completó el formulario: la tarjeta salía bloqueada con la cinta
       «Activa tu pase» y adentro la primera misión aparecía tildada diciendo
       «Listo: ya eres pasajero de honor». La app se contradecía a sí misma a
       tres centímetros de distancia. Registrarse no es activar — lo dice
       `pintarActivacion` dos funciones más abajo— y el único dato que prueba
       una activación es `activo`. La carrera que el criterio laxo quería
       evitar (20 s de Apps Script en frío diciéndole «0 de 4» a quien acaba de
       activar) la resuelve `yoLocal`, que ahora deriva `activo` de
       `perfil.codigo`: eso se escribe sólo cuando el servidor confirmó. */
    var tienePase = conLlave;
    var compro = !!(yo && yo.ticket);

    var lista = [
      /* El texto era uno solo y en pasado —«Listo: ya eres pasajero de honor»—,
         así que también felicitaba a quien no había activado nada. */
      { hecha: tienePase,
        titulo: 'Activa tu Boarding Pass',
        texto: tienePase ? 'Listo: ya eres pasajero de honor de esta ruta.'
                         : 'Escribe el código de tu Héroe en el recuadro de arriba.' },

      /* ⚠️ «2 O MÁS», NO «2». El título decía «Suma 2 personas» y eso pone un
         techo donde no lo hay: quien llevaba cinco veía la misma tilde que
         quien llevaba dos, y el número dejaba de importar justo cuando más
         valía. La misión se cumple en la segunda y el contador sigue subiendo.
         `pendientes` son los que entraron por su enlace pero todavía no
         activaron: no cuentan como tripulación —no financiaron ninguna hora de
         vuelo— pero decirle «cero» a quien trajo tres personas es mentirle al
         revés. */
      { hecha: n >= META_TRIPU,
        titulo: 'Suma personas a tu tripulación',
        texto: n === 0 ? (pendientes > 0
                  ? (pendientes === 1 ? 'Una persona entró por tu enlace. Cuando active su pase, viaja contigo.'
                                      : pendientes + ' personas entraron por tu enlace. Cuando activen su pase, viajan contigo.')
                  : 'Comparte tu enlace. Quien entre por él viaja contigo.')
             : n === 1 ? 'Una ya viaja contigo. Con una más, tu tripulación despega.'
             : 'Ya son ' + n + ' a bordo.'
                  + (pendientes > 0 ? ' Y ' + pendientes + ' más en camino.' : '')
                  + ' Cada una suma.',
        asientos: n,
        // La recompensa no puede ser sólo un tilde: la consecuencia es lo que
        // hace que valga la pena.
        produce: n >= META_TRIPU ? null : 'Cada persona que entra suma su Héroe a esta ruta',
        /* El botón NO desaparece al llegar a dos: si el contador sigue
           subiendo, tiene que haber cómo seguir sumando. Cambia el tono. */
        accion: { texto: n >= META_TRIPU ? 'Invitar a alguien más' : 'Invitar',
                  como: 'invitar', suave: n >= META_TRIPU } },

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

    /* Sin el pase activado, los botones se apagan de verdad. El CSS los pinta
       apagados; esto es lo que impide que respondan al toque. */
    if (!conLlave) {
      var caja = $('lista-mis');
      var tocables = caja.querySelectorAll('button, input');
      for (var t = 0; t < tocables.length; t++) {
        tocables[t].disabled = true;
        tocables[t].setAttribute('tabindex', '-1');
      }
    }
  }

  // ── Tu aporte y la fecha de las cifras ───────────────────────────────────

  function pintarAporte(vuelo) {
    /* ⚠️ LA META DE LA RUTA, NO LA DE `datos.js`. Esta función ya tomaba el
       origen y el destino del vuelo y la meta de otro lado: en la misma
       pantalla decía «Ya somos 3 … Faltan 97 para completar la ruta» arriba y
       «Los 609 Héroes de ESTA RUTA pagan un vuelo completo» abajo. No hacía
       falta una empresa para verlo: alcanzaba con cambiar la celda `meta` de la
       campaña sin volver a publicar `datos.js`. */
    var m = vuelo ? numeroDeHoja(vuelo.meta) : null;
    if (m === null || m <= 0) {
      var c = cifrasDeLaCampana();
      /* Sólo la campaña cae en `datos.js`: a una ruta de empresa sin meta no se
         le inventa la de la campaña. */
      m = (vuelo && vuelo.esCampania === false) ? null : (c ? c.meta : null);
    }
    var caja = $('a-meta');
    if (caja && typeof m === 'number' && m > 0) {
      caja.textContent = enEspanol(m);
      if (caja.parentNode) caja.parentNode.hidden = false;
    } else if (caja && caja.parentNode) {
      /* Sin meta no hay frase que decir: «Los — Héroes de esta ruta» no es
         información, es un hueco. */
      caja.parentNode.hidden = true;
    }
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

    /* ⚠️ LA SECCIÓN NO SE OCULTA ENTERA AL ACTIVAR. Adentro está la pieza del
       pase de papel girando, y no hay motivo para que desaparezca: el objeto
       sigue existiendo después de activarlo. Se va el formulario, se queda la
       pieza, y el título cambia para que no siga diciendo «activa» algo que ya
       está activo. */
    $('activar-pase').hidden = false;
    $('activar-form').hidden = activo;
    $('activar-listo').hidden = !activo;
    $('t-activar').textContent = activo ? 'Tu Boarding Pass de papel'
                                        : 'Activa tu Boarding Pass';

    $('pase-falta').hidden = activo;
    if (activo) $('pase').removeAttribute('data-falta');
    else        $('pase').setAttribute('data-falta', '');

    // Las secciones que hablan de «tu» aporte no aplican a quien no aportó.
    var aporte = document.querySelector('.aporte');
    if (aporte) aporte.hidden = !activo;

    /* ⚠️ EL «TU» DEL VUELO SE GANA ACTIVANDO. La sección era la única del grupo
       que no miraba `activo`: su título estaba escrito fijo en el HTML y le
       decía «Tu oncovuelo» a cualquiera que abriera la app, incluido quien
       apenas dejó sus datos en el formulario. No se oculta —las etapas y el
       avance son de la ruta y son ciertos para todos, y esconderlos le saca a
       quien se registró lo único que le da ganas de activar—: lo que se va es
       el posesivo, y en su lugar aparece cómo conseguirlo. */
    /* ⚠️ CON GUARDA, POR LA MISMA RAZÓN QUE `al()` EXISTE (ver su comentario).
       `#vuelo-llave` es un elemento NUEVO: al publicar, la primera visita de
       cada persona recibe el `index.html` viejo con el `app.js` nuevo —el
       service worker sirve caché primero, y GitHub Pages encima manda
       `max-age=600`—. Sin esta guarda, `$('vuelo-llave')` es `null`,
       `.hidden` revienta, y la excepción sube por `pintarPersona` hasta
       `arrancar()`, que la llama FUERA del `.then()`: se corta antes del
       `fetch`, así que la app no habla nunca con el servidor y tampoco
       reintenta, porque los reintentos los agenda `arrancar`. Le pasaría sólo
       a quien ya completó el formulario, o sea a los que aportaron. */
    var tVuelo = $('t-vuelo'), llaveVuelo = $('vuelo-llave');
    if (tVuelo) tVuelo.textContent = activo ? 'Tu oncovuelo' : 'El oncovuelo';
    if (llaveVuelo) llaveVuelo.hidden = activo;

    /* ⚠️ LAS MISIONES SE VEN SIEMPRE, BLOQUEADAS SI FALTA ACTIVAR. Antes no
       aparecían: quien no había activado no tenía forma de saber qué se estaba
       perdiendo, que es justamente lo que da ganas de activar. */
    $('misiones').hidden = false;
    $('misiones-llave').hidden = activo;
    $('misiones-bajada').hidden = !activo;
    if (activo) $('misiones').removeAttribute('data-bloqueada');
    else        $('misiones').setAttribute('data-bloqueada', '');
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

  /* ── La bienvenida ────────────────────────────────────────────────────────
     Los tres pasos son lo que de verdad está pasando: el alta ya está en la
     cola del teléfono y saliendo hacia el servidor.

     ⚠️ NO ESPERA AL SERVIDOR PARA IRSE. Apps Script en frío tarda más de
     veinte segundos: tener a alguien mirando una pantalla de carga todo ese
     rato, justo después de dejar sus datos, es la forma más rápida de que
     cierre y no vuelva. Se va en cuanto el pase está dibujado con lo que el
     teléfono ya sabe —que es inmediato—, y el resto lo cuenta el latido de
     arriba, que para eso está. */
  var PASOS_BIENVENIDA = [
    { texto: 'Guardando tus datos…',        avance: .18, ms: 900 },
    { texto: 'Preparando tu Boarding Pass…', avance: .62, ms: 1000 },
    { texto: 'Listo. Bienvenido a bordo.',   avance: 1,   ms: 700 }
  ];

  function bienvenida() {
    var caja = $('bienvenida');
    if (!caja) return;
    /* Sólo al llegar desde el formulario. En una visita normal no hay nada que
       esperar y la pantalla sería un peaje. */
    if (location.search.indexOf('nuevo=1') === -1) return;

    caja.hidden = false;
    var paso = $('bienvenida-paso'), riel = $('bienvenida-avance'), i = 0;

    var siguiente = function () {
      if (i >= PASOS_BIENVENIDA.length) { cerrar(); return; }
      var p = PASOS_BIENVENIDA[i++];
      paso.textContent = p.texto;
      if (riel) riel.style.transform = 'scaleX(' + p.avance + ')';
      setTimeout(siguiente, p.ms);
    };

    var cerrada = false;
    var cerrar = function () {
      if (cerrada) return;
      cerrada = true;
      caja.setAttribute('data-yendose', '');
      setTimeout(function () { caja.hidden = true; }, 420);
      /* La dirección queda limpia: si la persona recarga, o comparte el enlace
         de la app, la bienvenida no tiene por qué volver a aparecer. */
      try {
        history.replaceState(null, '', location.pathname + location.hash);
      } catch (e) {}
    };

    /* Tope duro: pase lo que pase con los tiempos, a los cinco segundos la
       pantalla se va. Una bienvenida que se queda pegada es una app rota. */
    setTimeout(cerrar, 5000);
    siguiente();
  }

  /* Cuándo contestó bien el servidor por última vez. Lo usa el refresco al
     volver del segundo plano, para no pedir el estado en cada parpadeo. */
  var ultimoEstadoOk = 0;
  /* ⚠️ UN SOLO PEDIDO DE ESTADO EN VUELO A LA VEZ. `arrancar()` se llama desde
     muchos lados —la carga inicial, `reintentarEstado`, `visibilitychange`,
     `pageshow`, y después de activar o vincular— y ninguno miraba si ya había
     uno andando. Bajo carga, cuando el servidor tarda, eso apila pedidos del
     mismo teléfono para el mismo dato: cada uno ocupa una ejecución en Google y
     empeora la demora que los está causando. Con la bandera, el segundo
     llamado se va sin hacer nada y el primero termina igual. */
  var pidiendoEstado = false;

  function arrancar() {
    /* ⚠️ EL `?de=` SE GUARDA ANTES QUE NADA, y antes de que nada pueda fallar.
       Quien abre el enlace de un amigo y cae directo en la app —porque ya la
       tenía instalada— traía la invitación en la dirección y se perdía: la app
       ni la miraba, eso lo hacía sólo el formulario del sitio. Se guarda acá y
       se anota en cuanto haya un token, que puede ser en esta misma visita o
       en la próxima. */
    var deLaUrl = invitacionDeLaUrl();
    if (deLaUrl && !leer(K_INVITO, null)) escribir(K_INVITO, deLaUrl);

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
      /* ⚠️ `activo` SALE DE `perfil.codigo`, Y ESE DATO SÓLO EXISTE SI EL
         SERVIDOR CONFIRMÓ UNA ACTIVACIÓN. Se escribe en un solo lugar —la
         respuesta `ok` de `action:'activar'`—; el formulario del sitio guarda
         `{nombre, ticket}` y nunca un código, así que no hay forma de que esto
         dé verdadero para quien apenas se registró. Antes no se derivaba nada y
         el teléfono asumía «no activa» siempre: quien ya tenía su pase abría la
         app y veía la cinta «Activa tu pase» y el formulario de activación
         durante los veinte segundos que Apps Script tarda en despertar. */
      var yoLocal = { nombre: primerNombre(perfil.nombre), nombreCompleto: perfil.nombre,
                      ticket: perfil.ticket || '', id: (leer(K_YO, {}) || {}).id || '',
                      codigo: perfil.codigo || '', activo: !!perfil.codigo,
                      tripulacion: 0 };
      pintarPersona(yoLocal);
      /* ⚠️ Y LAS MISIONES TAMBIÉN. `pintarPersona` muestra el bloque, pero
         dibujarlo es otra función: sin esta línea, quien se acababa de
         registrar ve el panel «TUS MISIONES» con su cinta y su explicación, y
         **nada debajo**. Es lo primero que le apareció a Krea.
         ⚠️⚠️ **ESTA LÍNEA YA SE BORRÓ UNA VEZ**, en un cambio que dejó el
         comentario huérfano explicando un arreglo que ya no existía. Un
         comentario no sostiene nada: si vuelve a desaparecer, el síntoma es la
         ventana entre que la persona aterriza desde el formulario y que el alta
         encolada devuelve token —más de 20 segundos en frío, minutos con mala
         señal, indefinido sin ella—. */
      pintarMisiones(yoLocal);
      /* ⚠️ ACÁ HABÍA UN `$('d-pase').textContent = '—'` QUE PISABA A
         `pintarPersona`, y era mío. Tenía sentido mientras `yoLocal` no supiera
         si la persona estaba activa: el número de pase no se podía mostrar
         hasta que contestara el servidor, y forzar el guion era lo correcto.
         Desde que `yoLocal` deriva `activo` de `perfil.codigo`, esa línea le
         borra el número a quien SÍ lo tiene: `pintarPersona` ponía `BP-0042` y
         la línea siguiente lo tapaba con un guion, durante los veinte segundos
         que Apps Script tarda en frío. `pintarPersona` ya pone el guion cuando
         corresponde — no hace falta nadie más. */
    }

    /* El ranking de la última vez, mientras el servidor despierta. Se corrige
       solo cuando contesta; si no contesta, esto es lo último que fue cierto.

       ⚠️ SÓLO SI ES DE QUIEN ESTÁ MIRANDO. El ranking guardado trae marcada la
       fila de «tú» y el bloque «vas N a bordo», y vive 24 h. En un teléfono de
       casa con dos personas registradas —el caso que `entrar()` atiende a
       propósito— Beto recuperaba su pase y durante los veinte segundos que
       tarda Apps Script en frío veía la fila de Ana marcada «· tú» y los
       números de Ana como propios. Se guarda de quién es y se descarta si no
       coincide: veinte segundos sin ranking es mejor que veinte segundos con el
       de otra persona. */
    var rGuardado = leer(K_RANKING, null);
    var idAhora = (leer(K_YO, {}) || {}).id || '';
    if (rGuardado && rGuardado.t && (Date.now() - rGuardado.t) < RANKING_VIVE_MS
        && (rGuardado.de || '') === idAhora) {
      pintarRanking(rGuardado.r, true);
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

    /* Si ya hay uno andando, este llamado no agrega nada: el que está en vuelo
       va a pintar lo mismo cuando conteste. */
    if (pidiendoEstado) return;
    pidiendoEstado = true;

    latido('yendo');
    conTope(function (ms) { return alServidor({ action: 'estado', token: (yo && yo.token) || '', ranking: true }, ms); })
      .then(function (r) {
        pidiendoEstado = false;
        // El servidor no contestó JSON: es un problema de conexión o de
        // despliegue, no que esta persona no exista. Se vuelve a intentar antes
        // de contarle nada a nadie.
        if (!r || (!r.ok && r.motivo === 'respuesta_no_json')) {
          if (reintentarEstado()) return;
          limpiarSinConexion();
          latido('mal');
          pintarSinConexion();
          return;
        }
        limpiarSinConexion();
        intento = 0;
        if (!r.ok) { pintarDesconocido(); return; }
        ultimoEstadoOk = Date.now();
        latido('listo', horaCorta());
        pintarRanking(r.ranking);
        pintarVuelo(r.vuelo, r.ososActivados);
        pintarAporte(r.vuelo);
        pintarCierre(r.vuelo);
        if (r.yo) {
          /* Las misiones se dibujan haya activado o no: bloqueadas se tienen
             que ver igual, o la cinta quedaría sobre una tarjeta vacía. */
          /* El código de invitación se guarda en el teléfono: el botón de
             compartir tiene que armar el enlace sin esperar al servidor. */
          if (yo && r.yo.invitacion && yo.invitacion !== r.yo.invitacion) {
            yo.invitacion = r.yo.invitacion;
            escribir(K_YO, yo);
          }
          pintarPersona(r.yo);
          pintarInvitacion(r.yo);
          pintarAvisos(r.yo);
          pintarMisiones(r.yo);
          if (!r.yo.invitadoPor) anotarQuienInvito(yo);
          else { try { localStorage.removeItem(K_INVITO); } catch (e) {} }
        }
        else {
          // El token guardado ya no vale: se descarta para no volver a
          // mandarlo en cada arranque.
          if (yo) { try { localStorage.removeItem(K_YO); } catch (e) {} }
          pintarDesconocido();
        }
      })
      .catch(function () {
        /* ⚠️ TAMBIÉN ACÁ, Y ES EL CAMINO QUE IMPORTA. Si la bandera se liberara
           sólo al responder bien, un pedido que vence por tiempo la dejaría
           puesta para siempre: ese teléfono no volvería a pedir el estado en
           toda la vida de la página, ni al volver del segundo plano. Un cerrojo
           que no se abre en el camino del error es peor que no tenerlo. */
        pidiendoEstado = false;
        if (reintentarEstado()) return;
        latido('mal');
        pintarSinConexion();
      });
  }

  // ── Enganches ────────────────────────────────────────────────────────────
  //
  /* ⚠️ SE ENGANCHA CON `al()` Y NUNCA CON `$('x').addEventListener` DIRECTO.
     Esto rompió la app en producción una vez y va a volver a romperla si se
     olvida.
     El service worker sirve CACHÉ PRIMERO: al publicar una versión nueva, la
     primera visita de cada persona recibe el `index.html` VIEJO —el que tenía
     guardado— junto con el `app.js` NUEVO, que ya está pidiendo elementos que
     ese HTML todavía no tiene. `$('id')` devuelve `null`, `.addEventListener`
     revienta, y como estos enganches corren al cargar el archivo, la excepción
     se lleva puesto TODO lo que viene después: la app queda en blanco hasta
     que la persona la recarga.
     `al()` no engancha lo que no existe y sigue de largo. La app queda sin ese
     botón durante una carga, que es infinitamente mejor que no quedar. */
  function al(id, evento, fn) {
    var el = $(id);
    if (el) el.addEventListener(evento, fn);
  }


  al('form-entrar', 'submit', function (e) {
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

  /**
   * Manda algo A OTRA PERSONA: el selector del sistema si existe, y si no,
   * WhatsApp abriendo la lista de contactos.
   *
   * ⚠️ EL RESPALDO VA A UN CONTACTO, NUNCA A LA EMPRESA. Era exactamente el
   * bug: sin `navigator.share`, la invitación terminaba en el WhatsApp de
   * Aeroambulancias en vez de en el del amigo.
   */
  function compartir(texto, url) {
    var completo = texto + ' ' + url;
    if (navigator.share) {
      navigator.share({ title: 'Un Check-in por la Vida', text: texto, url: url })
        .catch(function (e) {
          /* Cancelar no es fallar: si la persona cerró el selector, no se le
             abre WhatsApp por atrás como si no hubiera pasado nada. */
          if (e && e.name === 'AbortError') return;
          window.open(waAUnContacto(completo), '_blank', 'noopener');
        });
      return;
    }
    window.open(waAUnContacto(completo), '_blank', 'noopener');
  }

  /** Compartir la campaña, sin código ni invitación: «mirá esto». */
  function compartirCampana() {
    compartir('Este oso puede salvar vidas 🧸✈️ Adopta un Héroe de Rescate y '
      + 'ayuda a que personas con cáncer lleguen a su tratamiento:',
      location.origin + '/');
  }

  // ── El código de tripulación ─────────────────────────────────────────────

  /**
   * Muestra el código propio y, si hace falta, el campo para anotar el ajeno.
   *
   * ⚠️ EL BLOQUE NO APARECE SIN CÓDIGO. Sin esto, quien abre la app antes de
   * que el servidor conteste —o sin conexión— ve un recuadro punteado con un
   * guion adentro y dos botones que no hacen nada. Un bloque que no está se
   * entiende; uno vacío parece roto.
   */
  /**
   * La línea que dice si lo que se está viendo es lo último que hay.
   *
   * ⚠️ NO ES DECORACIÓN. Krea editaba la hoja `vuelo`, abría la app y veía los
   * valores viejos: no había ningún error, pero Apps Script en frío tarda más
   * de veinte segundos y en ese rato la app muestra el respaldo del HTML sin
   * decir nada. Cerraba antes de que llegara la respuesta y concluía que la
   * hoja no servía. Esta línea es la diferencia entre «no anda» y «esperá».
   */
  function latido(estado, cuando) {
    var el = $('latido');
    if (!el) return;
    el.hidden = false;
    el.removeAttribute('data-yendo');
    el.removeAttribute('data-listo');
    el.removeAttribute('data-mal');
    if (estado === 'yendo') {
      el.setAttribute('data-yendo', '');
      el.textContent = 'Buscando el estado más reciente…';
    } else if (estado === 'listo') {
      el.setAttribute('data-listo', '');
      el.textContent = 'Al día' + (cuando ? ' · ' + cuando : '');
    } else {
      el.setAttribute('data-mal', '');
      el.textContent = 'No pudimos conectarnos. Esto es lo último que guardamos.';
    }
  }

  function horaCorta() {
    try {
      return new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  /**
   * Quiénes más gente trajeron.
   *
   * ⚠️ HOY SÍ HAY PODIO, Y ANTES ESTABA PROHIBIDO. Este comentario decía «SIN
   * MEDALLAS NI PUNTOS… y el cliente lo pidió así», y sobrevivió intacto al
   * commit que dibujó los tres aros. Queda la historia porque el motivo original
   * no era un capricho: es una campaña sobre niños con cáncer y un oro-plata-
   * bronce puede leerse fuera de lugar.
   * Lo que cambió: Krea pidió el 2026-09-30, en seis puntos, «TOP 4
   * ONCOALIADOS» con medallas minimalistas y la cuarta deliberadamente pobre.
   * Se hizo así. **La tensión con lo anotado como pedido del cliente sigue
   * abierta**: si Rafael lo ve y lo objeta, lo que se revierte es el CSS de
   * `.rank-lista li[data-podio]` y este título, no la estructura.
   */
  function pintarRanking(r, deLaMemoria) {
    var caja = $('rank');
    if (!caja) return;
    /* ⚠️ UNA LISTA VACÍA DEL SERVIDOR CIERRA EL PANEL, pero no borra lo
       guardado: si el Sheet contesta vacío por un error de lectura, el próximo
       arranque vuelve a mostrar lo último bueno en vez de nada. */
    if (!r || !r.lista || !r.lista.length) { caja.hidden = true; return; }
    caja.hidden = false;
    // `de` es lo que permite descartarlo si lo abre otra persona (ver arriba).
    if (!deLaMemoria) {
      escribir(K_RANKING, { t: Date.now(), r: r, de: (leer(K_YO, {}) || {}).id || '' });
    }

    var ol = $('rank-lista');
    ol.textContent = '';
    /* ⚠️ CUATRO, Y NADA MÁS. Ni botón de «ver todo» ni texto que se expande:
       el título dice «Top 4» y el componente muestra cuatro, así que no falta
       nada. La escala la sugiere la estructura — tres medallas, un cuarto
       lugar sin medalla y, debajo del corte, el lugar vacío de quien mira. */
    var TOPE_VISIBLE = 4;
    r.lista.slice(0, TOPE_VISIBLE).forEach(function (p, i) {
      var li = document.createElement('li');
      li.setAttribute('data-podio', String(i + 1));
      if (p.yo) li.setAttribute('data-yo', '');
      var n = document.createElement('span');
      n.className = 'rank-nombre';
      n.textContent = p.nombre;
      var c = document.createElement('span');
      c.className = 'rank-cuantos';
      /* El número en negrita y la palabra al lado: «3 a bordo» se lee de un
         vistazo, «3» solo no dice de qué. */
      var b = document.createElement('b');
      b.textContent = String(p.cuantos);
      c.appendChild(b);
      // «1 a bordo» y «3 a bordo» se dicen igual: el ternario que había acá
      // tenía las dos ramas idénticas.
      c.appendChild(document.createTextNode(' a bordo'));
      li.appendChild(n); li.appendChild(c);
      ol.appendChild(li);
    });

    /* ⚠️ SE CUENTA CONTRA `TOPE_VISIBLE`, NO CONTRA `r.restantes`. El servidor
       calcula `restantes` como «los que quedaron fuera de los OCHO que mando»,
       y esta lista muestra CUATRO: la línea se comía exactamente a los cuatro
       del medio. Con catorce oncoaliados decía «y 6 más» habiendo diez fuera, y
       con cinco —el estado de hoy— `restantes` da 0 y la línea desaparecía: la
       quinta persona quedaba invisible para todos, incluida ella misma. `total`
       se agregó en el commit anterior justo para esto y no lo usaba nadie.
       El respaldo a `r.lista.length` es para un servidor viejo que no mande
       `total`: se queda corto, pero nunca inventa gente que no existe. */
    var mas = $('rank-mas');
    var fuera = (typeof r.total === 'number' ? r.total : r.lista.length) - TOPE_VISIBLE;
    if (mas && fuera > 0) {
      mas.hidden = false;
      mas.textContent = fuera === 1
        ? 'Y un oncoaliado más que también trajo gente.'
        : 'Y ' + fuera + ' oncoaliados más que también trajeron gente.';
    } else if (mas) mas.hidden = true;

    /* A quien no entró en la lista se le dice dónde está y cuánto le falta.
       Un ranking que sólo muestra a los de arriba no le sirve a nadie más. */
    /* ⚠️ EL COPY COMPITE, NO CONSUELA. Decía «esta lista te espera», que es
       amable y no mueve a nadie. Un ranking funciona cuando dice **cuánto
       falta para entrar**: ahí la lista deja de ser una vitrina y pasa a ser
       algo en lo que se puede escalar. */
    var vos = $('rank-vos'), vosTxt = $('rank-vos-txt');
    if (!vos || !vosTxt) return;
    var estaArriba = r.lista.slice(0, TOPE_VISIBLE).some(function (p) { return p.yo; });
    if (estaArriba) { vos.hidden = true; return; }
    vos.hidden = false;
    if (r.miCuenta > 0) {
      /* ⚠️ EL `|| {}` DE ANTES NO CUBRÍA NADA, LO DISFRAZABA: evitaba el
         TypeError y dejaba pasar `undefined - n + 1`, o sea `NaN`, que
         `Math.max(NaN, 1)` devuelve tal cual. El texto salía «Con NaN más
         entras al Top 4». Hoy no se alcanza sólo porque el `TOPE` del servidor
         (8) es mayor que `TOPE_VISIBLE`; bajarlo a 3 en `codigo.gs` —otro
         archivo, que se despliega aparte— lo dispara sin que la app se entere. */
      var cuarta = r.lista[TOPE_VISIBLE - 1];
      var falta = cuarta ? Math.max(cuarta.cuantos - r.miCuenta + 1, 1) : 1;
      vosTxt.innerHTML = 'Vas <b>' + r.miCuenta + ' a bordo</b>. Con '
        + (falta === 1 ? '<b>una persona m\u00e1s</b> entras' : '<b>' + falta + ' m\u00e1s</b> entras')
        + ' al Top 4.';
    } else {
      /* ⚠️ NO DICE «NO HAS SUMADO A NADIE», Y ES POR UNA CONTRADICCIÓN REAL.
         `miCuenta` es 0 también para quien trajo gente pero no activó su propio
         pase: el servidor no lo lista. A esa persona el contador de arriba le
         decía «3 personas entraron con tu código, y 2 activaron su pase» y este
         párrafo, tres centímetros más abajo, «todavía no has sumado a nadie».
         Lo único cierto en las dos situaciones es que no está en el Top 4, y
         eso es lo que dice ahora. */
      vosTxt.innerHTML = 'Todav\u00eda no entras al Top 4. <b>Comparte tu c\u00f3digo</b> '
        + 'y empieza a escalar posiciones.';
    }
  }

  // ── Notificaciones ───────────────────────────────────────────────────────

  var K_AVISOS = 'cxv.avisos';   // 'si' cuando ya se suscribió en este teléfono

  function hayPush() {
    return 'serviceWorker' in navigator && 'PushManager' in window &&
           typeof Notification !== 'undefined';
  }

  /**
   * Ofrece las notificaciones, y sólo cuando corresponde.
   *
   * ⚠️ NUNCA AL ENTRAR, y nunca sin el pase activado. El navegador recuerda un
   * «no» para siempre: pedir el permiso apenas alguien abre la app es gastar
   * la única oportunidad en el peor momento. Se ofrece a quien ya activó, que
   * es quien tiene algo que esperar.
   *
   * ⚠️ Y EL BOTÓN NO PIDE EL PERMISO: lo pide el toque de la persona. Llamar a
   * `requestPermission()` sin un gesto lo bloquean los navegadores, y encima
   * el cuadro del sistema aparecería sin que nadie lo haya pedido.
   */
  function pintarAvisos(yo) {
    var caja = $('avisos');
    if (!caja) return;
    var activo = !!(yo && yo.activo);
    if (!activo || !hayPush()) { caja.hidden = true; return; }
    /* Ya dijo que sí en este teléfono, o ya lo negó: en los dos casos no hay
       nada que ofrecer. Un «no» del navegador no se puede revertir desde acá
       —hay que ir a los ajustes del sitio— y ofrecerlo igual sería mentir. */
    if (Notification.permission !== 'default') { caja.hidden = true; return; }
    if (leer(K_AVISOS, null) === 'si') { caja.hidden = true; return; }
    caja.hidden = false;
  }

  /** base64url → Uint8Array, que es lo que `subscribe` espera. */
  function claveABytes(b64) {
    var t = String(b64).replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    var crudo = atob(t), salida = new Uint8Array(crudo.length);
    for (var i = 0; i < crudo.length; i++) salida[i] = crudo.charCodeAt(i);
    return salida;
  }

  al('btn-avisos', 'click', function () {
    var aviso = $('avisos-aviso'), yo = leer(K_YO, null);
    if (!hayPush() || !yo || !yo.token) return;
    aviso.textContent = 'Un momento…';

    Notification.requestPermission().then(function (permiso) {
      if (permiso !== 'granted') {
        /* Dijo que no. Se acepta y no se vuelve a ofrecer: insistir con esto
           es de las cosas que hacen desinstalar una app. */
        aviso.textContent = 'Está bien. Puedes activarlas más adelante desde los ajustes del navegador.';
        $('avisos').hidden = true;
        return;
      }
      /* ⚠️ LA CLAVE PÚBLICA SE PIDE AL SERVIDOR, no está escrita acá. Escrita
         en dos lados, el día que no coincida con la privada el servicio de
         push devuelve un 401 que no dice por qué, y se busca en el lugar
         equivocado durante horas. */
      return alServidor({ action: 'vapid' }).then(function (r) {
        if (!r || !r.ok || !r.clave) throw new Error('sin clave');
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: claveABytes(r.clave)
          }).then(function (sus) {
            var j = sus.toJSON ? sus.toJSON() : {};
            return alServidor({
              action: 'suscripcion_guardar', token: yo.token,
              endpoint: j.endpoint || sus.endpoint, dispositivo: dispositivoId()
            }).then(function (g) {
              if (!g || !g.ok) throw new Error(g && g.motivo);
              escribir(K_AVISOS, 'si');
              /* ⚠️ EL WORKER NO TIENE `localStorage`: lo que va a necesitar
                 cuando lo despierten se lo dejamos en IndexedDB, por mensaje. */
              if (reg.active) {
                reg.active.postMessage({ tipo: 'push-datos', api: API, token: yo.token });
              }
              aviso.textContent = 'Listo. Te avisamos cuando la ruta cambie de etapa.';
              setTimeout(function () { $('avisos').hidden = true; }, 2600);
            });
          });
        });
      });
    }).catch(function () {
      aviso.textContent = 'No pudimos activarlas ahora. Puedes intentar más tarde.';
    });
  });

  /* Quien ya se suscribió antes: se le refrescan los datos del worker en cada
     arranque. El token puede haber cambiado —al recuperar el pase desde otro
     teléfono se emite uno nuevo— y un worker con el token viejo despierta,
     pregunta, y el servidor no lo reconoce. */
  function refrescarDatosDelWorker() {
    if (!hayPush() || leer(K_AVISOS, null) !== 'si') return;
    var yo = leer(K_YO, null);
    if (!yo || !yo.token) return;
    navigator.serviceWorker.ready.then(function (reg) {
      if (reg.active) reg.active.postMessage({ tipo: 'push-datos', api: API, token: yo.token });
    }).catch(function () {});
  }

  function pintarInvitacion(yo) {
    var codigo = String((yo && yo.invitacion) || '');
    if (!codigo) { $('tripu').hidden = true; return; }
    $('tripu').hidden = false;
    $('tripu-codigo').textContent = codigo;

    /* ⚠️ CUÁNTA GENTE ENTRÓ CON SU CÓDIGO, acá mismo. El número existía en el
       servidor —`invitados` e `invitadosABordo`, recalculados en cada alta— y
       la app sólo lo usaba para las misiones y el ranking: en el bloque del
       código, que es donde alguien va a mirar después de compartirlo, no había
       nada. Un código sin contador no se comparte dos veces.
       Se muestran los DOS números porque significan cosas distintas: cuántos
       entraron, y cuántos de ésos además activaron — que son los que cuentan
       para el ranking. */
    var conteo = $('tripu-conteo');
    if (conteo) {
      var abordo = Number(yo && yo.tripulacion) || 0;
      var entraron = Number(yo && yo.tripulacionRegistrados) || 0;
      /* ⚠️ LO QUE EL EQUIPO CARGÓ A MANO SE DICE ACÁ, O LOS DOS NÚMEROS SE
         CONTRADICEN. El ranking cuenta `invitadosABordo + ajuste` y esto cuenta
         sólo lo que entró por el código: sin nombrar el ajuste, la pantalla
         decía «2 personas entraron con tu código, y 2 activaron su pase» y, tres
         centímetros abajo, «Vas 6 a bordo». Es la misma contradicción que esta
         fase vino a sacar de la hoja, reaparecida dentro de la app. */
      var ajuste = Math.max(Number(yo && yo.ajuste) || 0, 0);
      conteo.hidden = false;
      var sumado = ajuste > 0
        ? ' <span class="tripu-pend">Y <b>' + ajuste + '</b> '
          + 'm\u00e1s que carg\u00f3 el equipo: '
          + 'en el Top 4 cuentas <b>' + (abordo + ajuste) + '</b>.</span>'
        : '';
      if (entraron === 0) {
        conteo.innerHTML = '<b>0</b> personas han entrado con tu c\u00f3digo todav\u00eda.' + sumado;
      } else {
        var pendientes = Math.max(entraron - abordo, 0);
        conteo.innerHTML = '<b>' + entraron + '</b> '
          + (entraron === 1 ? 'persona entr\u00f3' : 'personas entraron') + ' con tu c\u00f3digo'
          + (abordo > 0 ? ', y <b>' + abordo + '</b> ' + (abordo === 1 ? 'activ\u00f3' : 'activaron')
                          + ' su pase.' : '.')
          + (pendientes > 0
              /* Concordancia: era «1 sin activar: cuando lo hagan», singular y
                 plural en la misma frase. Y no promete «tu posición», que quien
                 no activó su propio pase todavía no tiene. */
              ? ' <span class="tripu-pend">' + pendientes + ' sin activar: cuando '
                + (pendientes === 1 ? 'lo haga, cuenta' : 'lo hagan, cuentan')
                + ' para tu posici\u00f3n.</span>'
              : '')
          + sumado;
      }
    }

    /* ⚠️ YA NO HAY NINGUNA CONDICIÓN QUE EXPLICAR, Y EL PÁRRAFO SIGUE. Acá
       decía «sin el pase activado no se entra al ranking», que era verdad
       mientras `armarRanking` filtraba por `activo`; Krea sacó ese filtro el
       2026-10-01. El recuadro se queda porque sigue haciendo falta —quien se
       registró y no activó no tiene por qué saber que su código sirve— pero
       ahora afirma, no condiciona. */
    var activo = !!(yo && yo.activo);
    $('tripu-falta').hidden = activo;
    /* ⚠️ EL BOTÓN DE INVITAR **NO** SE APAGA, y antes sí. Lo que el pedido dejó
       inactivo es la PARTICIPACIÓN EN EL RANKING, no repartir el código:
       apagarlo contradecía al párrafo pegado arriba —«Tu código de invitación
       ya funciona: quien entre con él queda contigo»— en el mismo recuadro, y
       quien tenía el código en la mano concluía que no le servía. Encima le
       cerraba a la campaña la única puerta que tiene para crecer: alguien que
       todavía no activó igual puede traer gente, y esa gente sí activa.
       Lo que el ranking exige se dice con palabras, arriba, no con un botón en
       gris que no explica nada. */
    var bInv = $('btn-invitar-tripu');
    if (bInv) bInv.textContent = 'Invitar con mi código';
    /* El campo para anotar a quien la invitó sólo tiene sentido mientras no
       haya nadie anotado: después es una puerta que no lleva a ningún lado. */
    var tiene = !!(yo && yo.invitadoPor);
    $('tripu-de').hidden = tiene;
    $('tripu-ya').hidden = !tiene;
  }

  al('btn-copiar-codigo', 'click', function () {
    var c = $('tripu-codigo').textContent.trim();
    var aviso = $('tripu-aviso');
    if (!c || c === '—') return;
    var listo = function () { aviso.textContent = 'Código copiado.'; };
    /* `navigator.clipboard` no existe fuera de HTTPS y falla sin aviso en
       algunos navegadores viejos. El respaldo deja el código seleccionado
       para que se pueda copiar a mano, que es mejor que no hacer nada. */
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(c).then(listo, function () {
        aviso.textContent = 'No pudimos copiarlo. Tu código es ' + c + '.';
      });
    } else {
      aviso.textContent = 'Tu código es ' + c + '. Anótalo o mantén pulsado para copiarlo.';
    }
  });

  al('btn-invitar-tripu', 'click', invitar);
  al('btn-compartir-campana', 'click', compartirCampana);
  /* El de la cabecera hace lo mismo y está SIEMPRE visible: el de arriba vive
     dentro de `#tripu`, que no existe hasta que el servidor contesta. */
  al('btn-compartir-top', 'click', compartirCampana);

  al('form-invito', 'submit', function (e) {
    e.preventDefault();
    var campo = this.elements.codigo;
    var aviso = $('invito-aviso');
    var yo = leer(K_YO, null);
    var c = (campo.value || '').trim();
    campo.setAttribute('aria-invalid', 'false');
    if (!c) {
      aviso.textContent = 'Escribe el código de quien te invitó.';
      campo.setAttribute('aria-invalid', 'true'); campo.focus(); return;
    }
    if (!yo || !yo.token) {
      aviso.textContent = 'Primero busca tu Boarding Pass, más arriba.';
      return;
    }
    aviso.textContent = 'Anotando…';
    /* El mismo tope largo que la activación, y por el mismo motivo: esto
       escribe en la hoja, y un tope corto reporta como fallo algo que pudo
       haber ocurrido. */
    conTope(function (ms) { return alServidor({ action: 'invitado', token: yo.token, codigo: c }, ms); }, TOPE_ESCRIBIR_MS)
      .then(function (r) {
        if (r && r.ok) {
          try { localStorage.removeItem(K_INVITO); } catch (e2) {}
          aviso.textContent = '';
          campo.value = '';
          arrancar();
          return;
        }
        campo.setAttribute('aria-invalid', 'true');
        var m = r && r.motivo;
        /* Cada motivo dice algo distinto porque llevan a acciones distintas.
           Pegar el código del oso acá es el error más común de los tres: los
           dos códigos se parecen y la persona tiene el del oso a mano. */
        aviso.textContent =
          m === 'es_de_activacion' ? 'Ese es el código de tu Héroe, para activar tu pase. '
                                   + 'Aquí va el de la persona que te invitó, que lleva su apellido.'
        : m === 'es_el_propio'     ? 'Ese es tu propio código. Pon el de quien te invitó.'
        : m === 'codigo_desconocido' ? 'No encontramos ese código. Revísalo con quien te invitó.'
        : 'No pudimos anotarlo. Intenta de nuevo en un momento.';
      })
      .catch(function () {
        aviso.textContent = 'Está tardando más de lo normal. Verificando…';
        /* Igual que en la activación: pudo haberse anotado igual. Se mira
           cómo quedó antes de decirle a nadie que falló. */
        conTope(function (ms) { return alServidor({ action: 'estado', token: yo.token }, ms); }, TOPE_ESCRIBIR_MS)
          .then(function (r2) {
            if (r2 && r2.ok && r2.yo && r2.yo.invitadoPor) {
              aviso.textContent = ''; campo.value = ''; arrancar(); return;
            }
            aviso.textContent = 'No pudimos confirmarlo. Vuelve a intentar en un momento.';
          })
          .catch(function () {
            aviso.textContent = 'No pudimos conectarnos. Vuelve a intentar en un momento.';
          });
      });
  });

  al('btn-otra-ruta', 'click', function () {
    window.open(waALaEmpresa('Hola, mi ruta se completó y quiero sumarme a la próxima con otro Héroe de Rescate.'), '_blank', 'noopener');
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

  al('btn-encargar', 'click', function () {
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
    window.open(waALaEmpresa(
      'Hola, vengo de mi Boarding Pass de Un Check-in por la Vida. ' + quien +
      d.frase + ':\n\n' + lineas.join('\n') +
      '\n\nTotal: $' + t.suma + d.cola + pase), '_blank', 'noopener');
  });

  // ── Empresas ─────────────────────────────────────────────────────────────

  var PLANES = {
    padrino:  'Hola, vengo de Un Check-in por la Vida. Represento a una empresa y me interesa ser Padrino de una Ruta Sanitaria. ¿Me puedes dar más información?',
    copiloto: 'Hola, vengo de Un Check-in por la Vida. Represento a una empresa y me interesa el plan Copiloto Solidario, por tramos y asientos médicos. ¿Me puedes dar más información?',
    lotes:    'Hola, vengo de Un Check-in por la Vida. Represento a una empresa y quiero cotizar Kits Pedelton con propósito. ¿Me puedes dar más información?'
  };

  document.querySelectorAll('[data-plan]').forEach(function (b) {
    b.addEventListener('click', function () {
      window.open(waALaEmpresa(PLANES[b.getAttribute('data-plan')] || PLANES.padrino), '_blank', 'noopener');
    });
  });

  // ── Lo que hacen las misiones ────────────────────────────────────────────

  function invitar() {
    var yo = leer(K_YO, null);
    var codigo = (yo && yo.invitacion) || '';
    // Sin código ni id no hay enlace propio, pero la campaña sí: se comparte
    // igual en vez de dejar el botón muerto.
    var url = (yo && (yo.invitacion || yo.id)) ? enlacePropio(yo) : location.origin + '/';
    /* ⚠️ EL CÓDIGO VA ESCRITO EN EL MENSAJE, no sólo dentro del enlace. Quien
       lo recibe por WhatsApp Web, o lo reenvía copiando el texto a mano, se
       queda sin el `?de=` y la invitación no existe para nadie. Escrito
       aparte, se puede teclear en el campo «¿Te invitaron?» de la app. */
    var texto = 'Adopté un Héroe de Rescate para que personas con cáncer lleguen '
      + 'a su tratamiento en Caracas. Súmate a mi tripulación'
      + (codigo ? ' con mi código ' + codigo : '') + ':';
    compartir(texto, url);
  }

  function regalar() {
    // Se anota que se preguntó: al volver, la misión ofrece confirmarlo.
    escribir(K_REGALO, 'preguntando');
    setTimeout(arrancar, 400);
    window.open(waALaEmpresa(
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
    conTope(function (ms) { return alServidor({ action: 'vincular', token: yo.token, ticket: t }, ms); }, TOPE_ESCRIBIR_MS)
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
        var motV = (r && r.motivo) || '';
        if (!NO_ES_EL_CODIGO[motV]) campo.setAttribute('aria-invalid', 'true');
        aviso.textContent = motV === 'ticket_invalido'
          ? 'Ese número no parece un Boarding Pass. Revísalo.'
          : (MOTIVOS[motV] || 'No pudimos vincularlo. Intenta de nuevo en un momento.');
      })
      .catch(function () { aviso.textContent = 'No pudimos conectarnos. Revisa tu conexión.'; });
  }

  // ── Activar el pase ──────────────────────────────────────────────────────

  /* ⚠️ `ocupado` Y `respuesta_no_json` SON LOS DOS QUE FALTABAN, Y SON LOS QUE
     APARECEN JUSTO EN UN EVENTO. El servidor devuelve `ocupado` cuando el
     bloqueo de Apps Script vence —a partir de unas ocho o diez personas
     activando en paralelo— y `respuesta_no_json` cuando Google contesta HTML
     por pasarse de las ejecuciones simultáneas. Ninguno estaba en esta lista,
     así que los dos caían en el texto genérico **«No pudimos activarlo»** con
     el campo marcado en rojo. En un stand eso se lee como «mi código está
     mal», y la salida natural de esa persona es agarrar el código de OTRO oso:
     dos códigos quemados por un problema que no tenía nada que ver con el
     código. Es el mismo final que ONCO-7TXA, entrando por otra puerta.
     Los dos textos dicen lo mismo y es lo único que importa: tu código sirve,
     esperá, y volvé con EL MISMO. */
  var MOTIVOS = {
    codigo_invalido:    'Ese código no tiene la forma correcta. Debe ser como ONCO-4K7M.',
    codigo_desconocido: 'No encontramos ese código. Revisa que esté bien escrito.',
    codigo_usado:       'Ese código ya se usó. Si crees que es un error, escríbenos.',
    ya_activo:          'Tu pase ya está activo.',
    token_invalido:     'Espera unos segundos a que termine tu registro y vuelve a intentarlo.',
    sin_token:          'Espera unos segundos a que termine tu registro y vuelve a intentarlo.',
    ocupado:            'Hay varias personas activando su pase en este momento. '
                        + 'Tu código sigue siendo válido: espera unos segundos y '
                        + 'vuelve a intentar con el mismo.',
    respuesta_no_json:  'El servidor está con mucha gente. Tu código sigue siendo '
                        + 'válido: espera un momento y vuelve a intentar con el mismo.'
  };

  /* Los motivos que NO son culpa de lo que la persona escribió. Marcar el campo
     en rojo ahí es decirle que su código está mal cuando no lo está. */
  var NO_ES_EL_CODIGO = { ocupado: 1, respuesta_no_json: 1, sin_token: 1, token_invalido: 1 };

  al('form-activar', 'submit', function (e) {
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
    conTope(function (ms) { return alServidor({ action: 'activar', token: yo.token, codigo: c }, ms); }, TOPE_ESCRIBIR_MS)
      .then(function (r) {
        if (r && r.ok) {
          aviso.textContent = '';
          var perfil = leer(K_PERFIL, {}) || {};
          perfil.codigo = r.codigo;
          escribir(K_PERFIL, perfil);
          arrancar();          // se vuelve a pedir todo: ahora hay pase
          return;
        }
        /* ⚠️ SÓLO SE MARCA EN ROJO SI EL PROBLEMA ES EL CÓDIGO. Con `ocupado`
           —el servidor saturado— el código está perfecto, y teñir el campo le
           dice a la persona lo contrario justo cuando hay cola en el stand. */
        var mot = (r && r.motivo) || '';
        if (!NO_ES_EL_CODIGO[mot]) campo.setAttribute('aria-invalid', 'true');
        aviso.textContent = MOTIVOS[mot]
          || 'No pudimos activarlo. Intenta de nuevo en un momento.';
      })
      .catch(function () {
        /* ⚠️ NO SE PUEDE DECIR QUE FALLÓ. El pedido pudo haber llegado y haber
           activado el código igual; decir «no se pudo» empuja a la persona a
           intentar con otro código y a gastar dos. Se mira cómo quedó todo
           antes de contarle nada. */
        aviso.textContent = 'Está tardando más de lo normal. Verificando…';
        conTope(function (ms) { return alServidor({ action: 'estado', token: yo.token }, ms); }, TOPE_ESCRIBIR_MS)
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

  al('btn-quiero', 'click', function () {
    var perfil = leer(K_PERFIL, null);
    var quien = (perfil && perfil.nombre) ? (' Soy ' + perfil.nombre + '.') : '';
    window.open(waALaEmpresa('Hola, vengo de Un Check-in por la Vida y quiero adoptar un Héroe de Rescate.'
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
  var K_NO_INSTALAR = 'cxv.sininstalar';

  /** Abre la barra de abajo, salvo que ya la hayan cerrado alguna vez. */
  function ofrecerInstalar() {
    if (yaInstalada) return;
    if (leer(K_NO_INSTALAR, null)) return;
    $('instalar').hidden = false;
    /* El `padding-bottom` del body es lo que impide que la barra tape el final
       de la página: sin esto, el último bloque queda debajo y no se alcanza. */
    document.body.setAttribute('data-barra', '');
    mostrarBarraAvance();
  }

  function cerrarBarraInstalar(paraSiempre) {
    $('instalar').hidden = true;
    document.body.removeAttribute('data-barra');
    mostrarBarraAvance();
    /* ⚠️ SE RECUERDA EL CIERRE. Volver a ofrecer lo mismo en cada visita a
       quien ya dijo que no es la definición de molestar, y encima tapa
       contenido cada vez. */
    if (paraSiempre) escribir(K_NO_INSTALAR, '1');
  }

  al('btn-cerrar-instalar', 'click', function () { cerrarBarraInstalar(true); });

  window.addEventListener('beforeinstallprompt', function (e) {
    // Sin esto Chrome muestra su propia barra, que aparece donde quiere y dice
    // lo que quiere. Con el botón propio, se ofrece en su lugar y con el texto
    // de la campaña.
    e.preventDefault();
    pedidoDeInstalar = e;
    ofrecerInstalar();
  });

  window.addEventListener('appinstalled', function () {
    pedidoDeInstalar = null;
    cerrarBarraInstalar(false);
  });

  al('btn-reintentar', 'click', function () {
    $('entrar-titulo').textContent = 'Buscando tu Boarding Pass…';
    $('entrar-texto').textContent = 'Un momento.';
    $('btn-reintentar').hidden = true;
    intento = 0;          // el toque de la persona reabre el crédito de intentos
    arrancar();
  });

  al('btn-ayuda', 'click', function () {
    var perfil = leer(K_PERFIL, null);
    var quien = (perfil && perfil.nombre) ? (' Soy ' + perfil.nombre + '.') : '';
    window.open(waALaEmpresa('Hola, tengo una consulta sobre mi Boarding Pass de Un Check-in por la Vida.' + quien),
                '_blank', 'noopener');
  });

  al('btn-instalar', 'click', function () {
    if (!pedidoDeInstalar) return;
    pedidoDeInstalar.prompt();
    pedidoDeInstalar.userChoice.then(function (r) {
      pedidoDeInstalar = null;
      /* Aceptó o rechazó, pero contestó: la barra ya cumplió y se va. Si
         aceptó, `appinstalled` la cierra igual. */
      cerrarBarraInstalar(!!(r && r.outcome === 'dismissed'));
    });
  });

  al('btn-recargar', 'click', function () {
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
    ofrecerInstalar();
    $('btn-instalar').hidden = true;
    $('pasos-ios').hidden = false;
    $('instalar-texto').textContent = 'Agrégalo a tu pantalla de inicio:';
  })();

  /**
   * En computadora no hay nada que instalar: se dice, en vez de no mostrar nada.
   *
   * ⚠️ NO SE PREGUNTA POR EL ANCHO DE LA VENTANA. Un teléfono en horizontal
   * pasa los 900 px y una ventana angosta en un escritorio no llega: las dos
   * cosas darían el mensaje equivocado. Lo que separa a los dos aparatos acá es
   * si el puntero es fino y no hay pantalla táctil.
   *
   * Y se espera un momento antes de decidir: `beforeinstallprompt` llega
   * después de que Chrome termina de evaluar la app, no al cargar la página.
   * Sin la espera, un Android que sí puede instalar vería «ábrela desde tu
   * celular» durante un segundo, que es lo contrario de lo que corresponde.
   */
  setTimeout(function () {
    if (yaInstalada || pedidoDeInstalar) return;
    if (!$('instalar').hidden) return;           // iPhone: ya se está ofreciendo
    var deEscritorio = window.matchMedia('(pointer:fine)').matches &&
                       !window.matchMedia('(any-pointer:coarse)').matches;
    if (deEscritorio) $('solo-movil').hidden = false;
  }, 2500);

  // Cuando el alta encolada por el formulario llega al servidor, el pase deja
  // de decir «Activando…» sin que la persona tenga que recargar nada, y se
  // vuelve a preguntar por el estado: al abrir la app el servidor todavía no
  // conocía a esta persona, así que respondió sin su tripulación ni su pase.
  // Sin esto, quien se acaba de registrar no ve nada de eso hasta recargar.
  /* El alta terminó de guardarse: se vuelve a preguntar, que trae el n.º de pase
     de verdad si esta persona ya activó.
     ⚠️ ACÁ HABÍA UN `if` QUE ESCRIBÍA EL ID INTERNO (`P507E6F3712`) EN «N.º DE
     PASE», contra la advertencia de `pintarPersona` y contra el arreglo que la
     puso. No se llegaba a ver —`arrancar()` lo pisaba con «—» en la línea
     siguiente, de forma síncrona—, o sea que era código muerto esperando a que
     alguien reordenara dos líneas. El n.º de pase lo pone el código del Héroe,
     nunca la clave interna. */
  window.addEventListener('cxv:alta', function () { arrancar(); });

  /* ⚠️ AL VOLVER DEL SEGUNDO PLANO SE VUELVE A PREGUNTAR. `arrancar()` corría
     sólo al cargar y después de una acción de la persona. En una PWA instalada,
     Android reanuda el documento sin recargarlo: el equipo movía `estado` a
     `en_curso`, la persona tocaba el ícono, y seguía viendo la etapa vieja **con
     el latido asegurando «Al día · 09:22»** —la hora de la mañana anterior—. El
     latido existe justamente para no mentir sobre la frescura, así que mentir
     ahí es peor que no tenerlo.
     Con tope: sin él, cada vez que alguien cambia de app y vuelve sale un
     pedido a Apps Script, que tiene cuota diaria y es la de todos.
     ⚠️ EL TOPE BAJÓ DE 60 s A 20 s EL 2026-10-01, y es un cambio de uso, no de
     gusto. La hoja es el panel de control del equipo: alguien mueve la etapa
     del vuelo o carga un ajuste, agarra el teléfono para ver si se reflejó, y
     con un minuto de tope lo más probable era que viera el estado viejo y
     concluyera que la hoja no funciona —que es exactamente lo que pasó—.
     Veinte segundos cubren ese ida y vuelta y siguen cortando el goteo de
     pedidos de quien entra y sale de la app sin parar. El servidor caliente
     contesta en unos 3 s, así que el techo real de «lo toco y lo veo» son esos
     20 s más la respuesta. */
  var TOPE_REFRESCO_MS = 20000;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (Date.now() - ultimoEstadoOk < TOPE_REFRESCO_MS) return;
    arrancar();
  });
  /* Safari en iOS restaura desde la caché de retroceso sin disparar
     `visibilitychange`: `pageshow` con `persisted` es el único aviso. */
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    if (Date.now() - ultimoEstadoOk < TOPE_REFRESCO_MS) return;
    arrancar();
  });

  /* Primero la bienvenida: tapa la pantalla mientras todo lo demás se acomoda
     por debajo, que es justamente para lo que sirve. */
  bienvenida();
  registrarServicio();
  refrescarDatosDelWorker();
  pintarTienda();
  window.CXV.arrancarCola();
  arrancar();
})();
