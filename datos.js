// ─── NÚMEROS DE LA CAMPAÑA: EDITA SOLO ESTE ARCHIVO ────────────────────────
// La página dibuja desde aquí la cinta de datos, la barra de progreso y el
// gráfico del evento. Después de editar: guarda, y en unos minutos GitHub Pages
// publica el cambio.
//
// ─── ESTE ARCHIVO ES EL HISTÓRICO, NO EL TOTAL ────────────────────────────
// Lo de aquí abajo es lo que se vendió en el evento del congreso, y NO SE TOCA:
// es un número ya publicado. Lo que se vende después se suma encima, solo,
// desde la hoja de cálculo.
//
// La web muestra UNA cifra: pasajeros de honor. Cada producto vendido es un
// pasajero, sea toalla, llavero u oso grande:
//
//        congreso (la suma de `vendidas`, 44)
//      + cada código vendido (activado en la app o anotado en la hoja)
//      + cada venta sin código (una fila en la pestaña «ventas_sin_codigo»)
//
// La pestaña «resumen» de la hoja hace esta misma cuenta, paso por paso.
//
// ⚠️ QUÉ AGREGAR AQUÍ Y QUÉ NO, que es lo más importante de este archivo:
//
//   · Una venta, con o sin código → NO va aquí. Se carga en la hoja y suma
//     sola. Agregarla aquí también la cuenta DOS VECES y nada lo avisa.
//   · El congreso                → ya está, y no se toca.
//
// Aquí va sólo lo que ve el público. El tamaño de cada lote —cuántas unidades
// había— es información de inventario, se lleva aparte y no se publica.
//
// La fecha va en formato AAAA-MM-DD: si se escribe de otra forma, la página
// conserva la fecha anterior en lugar de publicar una mal armada. La web
// muestra la más nueva entre ésta y la de la última activación.
window.CAMPANA = {
  actualizado: "2026-10-06",

  // Pasajeros de honor que se quieren reunir para la ruta ONCO 001: es la
  // meta de la barra.
  metaOsos: 609,

  // ⚠️ `vendidas` son las unidades del congreso: 27 toallas son 27 pasajeros
  // de honor. Se suman tal cual.
  productos: [
    { id: "toalla",  nombre: "Toalla tipo oso", precio: 10, vendidas: 27 },
    { id: "llavero", nombre: "Llavero",         precio: 20, vendidas: 13 },
    { id: "oso",     nombre: "Oso grande",      precio: 40, vendidas: 4  }
  ]
};
