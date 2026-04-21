/**
 * Punto único para exponer funciones al HTML (onclick inline) con type="module".
 * Opción A: centralizar asignaciones a window aquí cuando se pasen desde app-main.
 *
 * Nota: `window.logout` (con confirmación vía showAppConfirm) se define en app-main.js,
 * no aquí, porque necesita el estado y los imports del módulo principal.
 */
export function exposeToWindow(handlers) {
    Object.assign(window, handlers);
}
