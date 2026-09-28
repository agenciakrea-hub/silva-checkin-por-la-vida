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

  var $ = function (id) { return document.getElementById(id); };

  function leer(clave, porDefecto) {
    try { var v = localStorage.getItem(clave); return v ? JSON.parse(v) : porDefecto; }
    catch (e) { return porDefecto; }
  }
  function escribir(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); return true; }
    catch (e) { return false; }
  }
  function dispositivoId() {
    var id = leer(K_DISPOSITIVO, null);
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
         : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      escribir(K_DISPOSITIVO, id);
    }
    return id;
  }

  // Sin cabecera Content-Type y leyendo como texto: ver el comentario largo en
  // index.html. Apps Script no contesta el OPTIONS de permiso, y devuelve HTML
  // cuando el despliegue quedó mal configurado o se agotó la cuota.
  function alServidor(cuerpo) {
    return fetch(API, { method: 'POST', body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        try { return JSON.parse(t); }
        catch (e) { return { ok: false, motivo: 'respuesta_no_json' }; }
      });
  }

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

  function pintarPersona(yo) {
    $('d-nombre').textContent = yo.nombre || '—';
    $('d-pase').textContent   = yo.ticket || yo.id || '—';
    $('pase-rotulo').textContent = 'Tu Boarding Pass solidario';
    $('pase').hidden   = false;
    $('entrar').hidden = true;
    $('avance-titulo').textContent = 'La ruta que estás financiando';
  }

  // A quien no reconocemos se le muestra la ruta igual, y se le ofrece entrar.
  // Mostrar el pase vacío sería peor que no mostrarlo: parece un error.
  function pintarDesconocido() {
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

    if (!API || typeof fetch !== 'function') { pintarDesconocido(); return; }

    var yo = leer(K_YO, null);
    alServidor({ action: 'estado', token: (yo && yo.token) || '' })
      .then(function (r) {
        if (!r || !r.ok) { pintarDesconocido(); return; }
        pintarVuelo(r.vuelo);
        if (r.yo) pintarPersona(r.yo);
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

  $('btn-compartir').addEventListener('click', function () {
    var url = location.origin + '/';
    var texto = 'Adopté un Héroe de Rescate para que personas con cáncer lleguen a su tratamiento. Súmate:';
    if (navigator.share) {
      navigator.share({ title: 'Un Check-in por la Vida', text: texto, url: url })
        .catch(function () {});
      return;
    }
    window.open(textoWa(texto + ' ' + url), '_blank', 'noopener');
  });

  arrancar();
})();
