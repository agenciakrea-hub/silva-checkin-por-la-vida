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
// La web muestra DOS cifras, cada una en su unidad:
//
//   · Pasajeros de honor = personas: una por producto vendido.
//       congreso (la suma de `vendidas`)  +  1 por cada código vendido
//   · Héroes = lo que llena la barra contra la meta:
//       toalla ($10) medio · llavero ($20) uno · oso grande ($40) dos
//       congreso (cada `vendidas` × su equivalencia)  +  los de cada código vendido
//
// Un código está VENDIDO si alguien lo activó en la app o si en la hoja
// `codigos` tiene escrito a quién se entregó (`entregado_a`). Cuenta una sola
// vez, aunque después se active, y suma cuando tiene su producto anotado.
//
// ⚠️ QUÉ AGREGAR AQUÍ Y QUÉ NO, que es lo más importante de este archivo:
//
//   · Una venta con código      → NO toques nada. Se marca el código en la hoja
//     y suma solo. Agregarla aquí también la cuenta DOS VECES y nada lo avisa.
//   · Una venta SIN ningún código → lo mejor es igual marcar en la hoja un
//     código libre de ese precio: suma en las dos cifras. Si no se puede, va en
//     `ososSinActivar`, EN OSOS, y sólo suma a los Héroes.
//   · No se sabe                 → no se agrega todavía. Esperar.
//
// Aquí va sólo lo que ve el público. El tamaño de cada lote —cuántas unidades
// había— es información de inventario, se lleva aparte y no se publica.
//
// La fecha va en formato AAAA-MM-DD: si se escribe de otra forma, la página
// conserva la fecha anterior en lugar de publicar una mal armada. La web
// muestra la más nueva entre ésta y la de la última activación.
window.CAMPANA = {
  actualizado: "2026-10-06",

  // Héroes que hacen falta para cubrir la ruta ONCO 001: es la meta de la
  // barra. Un Héroe es un producto de $20.
  metaOsos: 609,

  // ⚠️ EN OSOS, NO EN UNIDADES, y sólo para ventas que no tienen ningún
  // código: una venta con código se marca en la hoja y suma sola. Suma a los
  // Héroes de la barra, no a los pasajeros de honor.
  //   toalla ($10) medio · llavero ($20) uno · oso grande ($40) dos
  // Ejemplo con números inventados: 6 toallas sin código → 3.
  // ⚠️ EL DECIMAL VA CON PUNTO: 30.5, no 30,5. Con coma este archivo deja de
  // funcionar entero y la página pierde todas sus cifras.
  ososSinActivar: 0,

  // ⚠️ `vendidas` son UNIDADES del congreso: 27 toallas son 27 pasajeros de
  // honor y, en la barra, 13,5 Héroes. La web hace la cuenta sola con el precio
  // de cada producto; aquí no se convierte nada a mano.
  productos: [
    { id: "toalla",  nombre: "Toalla tipo oso", precio: 10, vendidas: 27 },
    { id: "llavero", nombre: "Llavero",         precio: 20, vendidas: 13 },
    { id: "oso",     nombre: "Oso grande",      precio: 40, vendidas: 4  }
  ]
};
