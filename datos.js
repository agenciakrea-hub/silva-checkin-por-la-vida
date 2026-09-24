// ─── NÚMEROS DE LA CAMPAÑA: EDITA SOLO ESTE ARCHIVO ────────────────────────
// La página dibuja desde aquí la cinta de datos, la barra de progreso y el
// gráfico del evento. Después de editar: guarda, y en unos minutos GitHub Pages
// publica el cambio.
//
// La campaña se mide en OSOS, no en dinero: las cifras de la portada, la barra
// de progreso y la barra fija cuentan unidades adoptadas.
//
// Acá va sólo lo que ve el público. El tamaño de cada lote —cuántas unidades
// había— es información de inventario, se lleva aparte y no se publica.
//
// La fecha va en formato AAAA-MM-DD: si se escribe de otra forma, la página
// conserva la fecha anterior en lugar de publicar una mal armada.
window.CAMPANA = {
  actualizado: "2026-09-19",

  // Osos que se planifica vender para cubrir la ruta ONCO 001.
  // La página calcula sola las otras dos cifras: las unidades adoptadas son la
  // suma de "vendidas" de abajo, y la diferencia es esta meta menos esa suma.
  metaOsos: 609,

  productos: [
    { id: "toalla",  nombre: "Toalla tipo oso",    precio: 10, vendidas: 27 },
    { id: "llavero", nombre: "Llavero articulado", precio: 20, vendidas: 13 },
    { id: "oso",     nombre: "Oso grande",         precio: 40, vendidas: 4  }
  ]
};
