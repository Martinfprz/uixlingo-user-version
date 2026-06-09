import { supabase } from './supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './constants.js';

const SESSION_ID = crypto.randomUUID();
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

function send(eventType, screen, extra = {}) {
    if (!supabase) return;
    supabase.from('events').insert({
        session_id: SESSION_ID,
        event_type: eventType,
        screen,
        created_at: new Date().toISOString(),
        ...extra,
    });
}

// keepalive: garantiza que el evento se envía aunque el navegador esté cerrando la página
function sendOnExit(screen, timeOnScreen) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    fetch(`${SUPABASE_URL}/rest/v1/events`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
        },
        body: JSON.stringify([{
            session_id: SESSION_ID,
            event_type: 'page_exit',
            screen,
            time_on_screen: timeOnScreen,
            created_at: new Date().toISOString(),
        }]),
        keepalive: true,
    }).catch(() => {});
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

// Hookea setRoute para capturar toda la navegación
const _origSetRoute = window.setRoute;
window.setRoute = function (path) {
    _origSetRoute?.(path);
    const name = SCREEN_NAMES[path] || path;
    if (name !== currentScreen) enterScreen(name);
};

// Clicks: lee los mismos atributos que Umami usa en analytics.js
document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-track-section]');
    if (!el) return;
    const section = el.dataset.trackSection;
    const action = el.dataset.trackAction;
    if (section && action) {
        send('click', currentScreen, { element: action, properties: { section } });
    }
}, true);

// Exit page: visibilitychange es el evento más confiable en móvil y desktop
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden') return;
    sendOnExit(currentScreen, Math.round((Date.now() - screenEnteredAt) / 1000));
});
