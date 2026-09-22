// ─── NÚMEROS DE LA CAMPAÑA: EDITA SOLO ESTE ARCHIVO ────────────────────────
// La página dibuja la cinta de datos, la barra de progreso y el gráfico desde acá.
// Después de editar: guarda, y en unos minutos GitHub Pages publica el cambio.
// Montos en dólares (USD), sin separadores de miles. Fecha en formato AAAA-MM-DD.
window.CAMPANA = {
  actualizado: "2026-09-19",
  moneda: "USD",
  recaudado: 690,
  meta: 15000,
  metaTexto: "un vuelo solidario",
  // Precio de referencia para calcular "faltan ~N pasajeros de honor" (el del llavero).
  precioReferencia: 20,
  productos: [
    { id: "toalla",  nombre: "Toalla tipo oso",    precio: 10, vendidas: 27, disponibles: 40 },
    { id: "llavero", nombre: "Llavero articulado", precio: 20, vendidas: 13, disponibles: 19 },
    { id: "oso",     nombre: "Oso grande",         precio: 40, vendidas: 4,  disponibles: 4  }
  ],
  // ID del video de YouTube del evento (lo que va después de "v=" en la URL). Vacío = sin video.
  youtube: ""
};
