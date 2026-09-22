// ─── NÚMEROS DE LA CAMPAÑA: EDITA SOLO ESTE ARCHIVO ────────────────────────
// La página dibuja desde aquí la cinta de datos, la barra de progreso y el
// gráfico del evento. Después de editar: guarda, y en unos minutos GitHub Pages
// publica el cambio.
//
// Montos en dólares (USD), sin separadores de miles.
// La fecha va en formato AAAA-MM-DD: si se escribe de otra forma, la página
// conserva la fecha anterior en lugar de publicar una mal armada.
window.CAMPANA = {
  actualizado: "2026-09-19",
  recaudado: 690,
  meta: 15000,
  productos: [
    // "vendidas" de "total": total es el tamaño del lote, no lo que queda.
    { id: "toalla",  nombre: "Toalla tipo oso",    precio: 10, vendidas: 27, total: 40 },
    { id: "llavero", nombre: "Llavero articulado", precio: 20, vendidas: 13, total: 19 },
    { id: "oso",     nombre: "Oso grande",         precio: 40, vendidas: 4,  total: 4  }
  ]
};
