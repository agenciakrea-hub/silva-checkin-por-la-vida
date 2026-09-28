// ─── DIRECCIÓN DEL SERVIDOR: EDITA SOLO ESTA LÍNEA ─────────────────────────
// Es la URL que devuelve Apps Script al desplegar, la que termina en /exec.
// Cómo obtenerla: docs/herramientas/apps-script/LEEME.md
//
// Mientras esté vacía, el sitio funciona igual que siempre: todo va por
// WhatsApp y no se guarda nada. La app del pasajero muestra la ruta pero no
// puede reconocer a nadie.
//
// Vive acá, y no dentro de cada página, porque son dos las que la usan: el
// formulario de la campaña y la app. Con una copia en cada una, tarde o
// temprano se cambia una sola y la otra queda apuntando a un servidor viejo.
window.CXV_API = 'https://script.google.com/macros/s/AKfycbwOGC1crbBdEKAtwza2RIWcQ04qXYzNCbHn4hlnGRICZ2TxgU7mpYeoHiLC9DGinTjW/exec';
