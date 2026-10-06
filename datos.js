// ─── NÚMEROS DE LA CAMPAÑA: EDITA SOLO ESTE ARCHIVO ────────────────────────
// La página dibuja desde aquí la cinta de datos, la barra de progreso y el
// gráfico del evento. Después de editar: guarda, y en unos minutos GitHub Pages
// publica el cambio.
//
// ─── ESTE ARCHIVO ES EL HISTÓRICO, NO EL TOTAL ────────────────────────────
// Lo de acá abajo es lo que se vendió en el evento del congreso, y NO SE TOCA:
// es un número ya publicado. Lo que pasa de ahora en adelante se suma encima,
// solo, sin que nadie edite nada:
//
//        total que ve la web  =  lo de este archivo  +  los códigos activados
//
// Cada código impreso lleva anotado en la hoja `codigos` qué producto se
// entregó con él, y al activarse suma su equivalente en OSOS:
//
//        $10  →  medio oso  (0,5)
//        $20  →  un oso     (1)
//        $40  →  dos osos   (2)
//
// ⚠️ QUÉ AGREGAR ACÁ Y QUÉ NO, que es lo más importante de este archivo:
//
//   · Alguien compró y activó su código      → NO toques nada. Ya se sumó solo.
//     Agregarlo acá lo cuenta DOS VECES y nada lo va a avisar.
//   · Alguien compró y no va a activar nunca → se agrega acá, después del
//     evento, cuando ya se sabe quién activó y quién no.
//   · No se sabe                             → no se agrega todavía. Esperar.
//
// Acá va sólo lo que ve el público. El tamaño de cada lote —cuántas unidades
// había— es información de inventario, se lleva aparte y no se publica.
//
// La fecha va en formato AAAA-MM-DD: si se escribe de otra forma, la página
// conserva la fecha anterior en lugar de publicar una mal armada.
window.CAMPANA = {
  actualizado: "2026-10-06",

  // Osos que se planifica vender para cubrir la ruta ONCO 001.
  metaOsos: 609,

  // ⚠️ `vendidas` son UNIDADES y se suman tal cual: 27 toallas cuentan 27.
  // Es el criterio con el que se publicó el número del evento y se mantiene
  // para no reescribir hacia atrás una cifra que la gente ya vio. La
  // equivalencia en osos aplica a lo NUEVO, que lo cuenta el servidor.
  productos: [
    { id: "toalla",  nombre: "Toalla tipo oso", precio: 10, vendidas: 27 },
    { id: "llavero", nombre: "Llavero",         precio: 20, vendidas: 13 },
    { id: "oso",     nombre: "Oso grande",      precio: 40, vendidas: 4  }
  ]
};
