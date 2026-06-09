import { SUPABASE_URL, SUPABASE_ANON_KEY } from './constants.js';

const SESSION_ID = sessionStorage.getItem('uix_sid') || (() => {
    const id = crypto.randomUUID();
    sessionStorage.setItem('uix_sid', id);
    return id;
})();
let currentScreen = 'home';
let screenEnteredAt = Date.now();

const SCREEN_NAMES = {
    '/':             'home',
    '/pruebas':      'practice',
    '/evaluaciones': 'evaluation',
    '/pills':        'pills',
    '/talentos':     'talents',
    '/resultados':   'results',
};

// Inserta SIEMPRE con la anon key directa → rol `anon`.
// No usa el cliente de Supabase a propósito: ese adjunta el JWT del usuario
// logueado (rol `authenticated`) y el INSERT policy solo cubre `anon`.
function insert(payload, keepalive = false) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    fetch(`${SUPABASE_URL}/rest/v1/events`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
        },
        body: JSON.stringify([payload]),
        keepalive,
    }).then(res => {
        if (!res.ok) console.warn('[tracking] insert falló', res.status, payload.event_type, payload.screen);
    }).catch(() => {});
}

function send(eventType, screen, extra = {}) {
    insert({
        session_id: SESSION_ID,
        event_type: eventType,
        screen,
        created_at: new Date().toISOString(),
        ...extra,
    });
}

function sendOnExit(screen, timeOnScreen) {
    insert({
        session_id: SESSION_ID,
        event_type: 'page_exit',
        screen,
        time_on_screen: timeOnScreen,
        created_at: new Date().toISOString(),
    }, true);
}

function enterScreen(name) {
    const timeOnScreen = Math.round((Date.now() - screenEnteredAt) / 1000);
    send('screen_exit', currentScreen, { time_on_screen: timeOnScreen });
    currentScreen = name;
    screenEnteredAt = Date.now();
    send('screen_enter', name);
}

// Pantalla inicial
send('screen_enter', 'home');

// Hookea history.pushState directamente — más bajo nivel que setRoute,
// captura toda navegación SPA sin importar qué función la dispare
const _origPushState = history.pushState.bind(history);
history.pushState = function (state, title, url) {
    _origPushState(state, title, url);
    if (!url) return;
    const path = typeof url === 'string' ? url : (url.pathname || '');
    const name = SCREEN_NAMES[path] || path;
    if (name !== currentScreen) enterScreen(name);
};

// Botón atrás / adelante del browser
window.addEventListener('popstate', function () {
    const name = SCREEN_NAMES[window.location.pathname] || 'home';
    if (name !== currentScreen) enterScreen(name);
});

// Milo: abre modal sin cambiar ruta, necesita hook propio
const _origOpenMilo = window.openMilo;
window.openMilo = function () {
    _origOpenMilo?.();
    enterScreen('milo');
};

const _origCloseMilo = window.closeMilo;
window.closeMilo = function () {
    _origCloseMilo?.();
    const name = SCREEN_NAMES[window.location.pathname] || 'home';
    enterScreen(name);
};

// Clicks
document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-track-section]');
    if (!el) return;
    const section = el.dataset.trackSection;
    const action = el.dataset.trackAction;
    if (section && action) {
        send('click', currentScreen, { element: action, properties: { section } });
    }
}, true);

// Exit page
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden') return;
    sendOnExit(currentScreen, Math.round((Date.now() - screenEnteredAt) / 1000));
});
