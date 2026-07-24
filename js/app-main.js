import {
    MATERIAL,
    SESSION_LENGTH,
    EVALUATION_SESSION_LENGTH,
    EVALUATION_SESSION_LENGTH_UX_UI,
    EVALUATION_SESSION_LENGTH_UX_ONLY,
    DEBUG,
    EVALUATION_QUESTION_TIME,
    ENABLE_EVAL_HARD_BLOCK,
    EVAL_VIOLATION_STORAGE_PREFIX,
    EVAL_FOCUS_EVENT_DEBOUNCE_MS,
    _loginGuard,
    LOGIN_MAX_ATTEMPTS,
    LOGIN_COOLDOWN_MS,
    PILLS_SWIPE_THRESHOLD,
    PILLS_SWIPE_THRESHOLD_DESKTOP_Y,
    PILLS_HINT_DEAD_PX,
    PILLS_SEAL_WINDOW_HOURS,
    RESET_PASSWORD_PATH,
    PUBLIC_APP_ORIGIN,
    TEST_MODE_ALLOWED_EMAILS,
} from './constants.js?v=3';
import { esc, safeIconClass, safeTalentImageUrl, safeHttpUrl, shuffleFisherYates } from './utils.js';
import { supabase } from './supabase.js';
import { showAppAlert, showAppConfirm } from './ui.js';
import { exposeToWindow } from './global-handlers.js';
import { UI_TEXT as T } from './copy.js';

const debugWarn = DEBUG ? console.warn.bind(console) : () => {};
const debugError = DEBUG ? console.error.bind(console) : () => {};

let supabaseSession = null;
/** True cuando el usuario llegó desde un link de recuperación y aún no guarda la nueva contraseña. */
let isPasswordRecoveryFlow = false;
/** Flag síncrono para capturar el evento SIGNED_IN en caso de que Supabase no emita PASSWORD_RECOVERY. */
let _recoveryFlowPending = false;
/** Verificación de token pendiente: se ejecuta solo con el clic del usuario (anti-escáner). */
let _pendingRecoveryVerify = null;

// --- SPLASH SCREEN LOGIC ---
window.addEventListener('load', () => {
    const splashScreen = document.getElementById('splash-screen');
    const splashLogo = document.getElementById('splash-logo');
    const homeLogo = document.getElementById('home-logo');

    // 1. Entrada suave del logo (Fade In + Scale Up)
    setTimeout(() => {
        if (splashLogo) splashLogo.classList.remove('opacity-0', 'scale-90');
    }, 100);

    setTimeout(() => {
        if (!splashScreen || !splashLogo) return;

        const finishSplash = () => {
            const hl = document.getElementById('home-logo');
            if (hl) hl.classList.remove('opacity-0');
            splashScreen.classList.add('hidden');
            window.scrollTo(0, 0);
        };

        if (!homeLogo) {
            finishSplash();
            return;
        }

        // 2. Calcular posiciones para la animación de movimiento
        const splashRect = splashLogo.getBoundingClientRect();
        const homeRect = homeLogo.getBoundingClientRect();

        const x = homeRect.left + (homeRect.width / 2) - (splashRect.left + (splashRect.width / 2));
        const y = homeRect.top + (homeRect.height / 2) - (splashRect.top + (splashRect.height / 2));
        const scale = homeRect.width / splashRect.width;

        // 3. Animar logo y desvanecer fondo
        splashLogo.style.transition = 'all 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
        splashLogo.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;

        splashScreen.style.transition = 'background-color 0.8s ease';
        splashScreen.style.backgroundColor = 'transparent';
        splashScreen.classList.add('pointer-events-none');

        // 4. Finalizar
        setTimeout(finishSplash, 800);
    }, 2000);
});

let globalLoaderCount = 0;
function setGlobalLoaderVisible(visible, text = T.common.loading) {
    const loader = document.getElementById('global-loader');
    const textEl = document.getElementById('global-loader-text');
    if (!loader) return;
    if (textEl) textEl.textContent = text;
    loader.classList.toggle('hidden', !visible);
}

function beginGlobalLoading(text = T.common.loading) {
    globalLoaderCount += 1;
    setGlobalLoaderVisible(true, text);
}

function endGlobalLoading() {
    globalLoaderCount = Math.max(0, globalLoaderCount - 1);
    if (globalLoaderCount === 0) setGlobalLoaderVisible(false);
}

let rawData = []; // Esta variable ahora inicia vacía y se llenará SOLO desde Supabase
let practiceData = [];
let evaluationData = [];
/** Preguntas “planas” legacy (no usado si las pills vienen solo de subcolecciones) */
let pillsData = [];
/** Documentos raíz de la colección `pills` (name, category, description, link, …) */
let pillsCatalog = [];
let currentQuizMode = 'practice';

function getModeQuestionPool(mode) {
    if (mode === 'evaluation') return evaluationData;
    if (mode === 'pills') return pillsData;
    return practiceData;
}

function getNullablePillScoreValue(row) {
    if (!row || row.score === undefined || row.score === null || row.score === '') return null;
    const val = Number(row.score);
    return Number.isFinite(val) ? val : null;
}

function isValidPillFirstAttemptRow(row) {
    const scoreVal = getNullablePillScoreValue(row);
    // Regla negocio solicitada: score null o 0 no bloquea primer intento.
    return scoreVal !== null && scoreVal > 0;
}

// --- CARGA BAJO DEMANDA DESDE SUPABASE ---
async function loadPracticeQuestions() {
    if (!supabase) return;
    try {
        const { data, error } = await supabase.from('banco_preguntas').select('*');
        if (error) throw error;
        practiceData = data || [];
        if (currentQuizMode === 'practice') {
            rawData = practiceData;
            updatePoolCount();
        }
    } catch (e) {
        debugError("Error al cargar preguntas de práctica:", e);
    }
}

async function loadEvaluationQuestions() {
    if (!supabase) return;
    try {
        const { data, error } = await supabase.from('preguntas_evaluacion').select('*');
        if (error) throw error;
        evaluationData = data || [];
        if (currentQuizMode === 'evaluation') {
            rawData = evaluationData;
            updatePoolCount();
        }
    } catch (e) {
        debugError("Error al cargar preguntas de evaluación:", e);
    }
}

async function loadPillsCatalog() {
    if (!supabase) return;
    try {
        const { data, error } = await supabase.from('pills').select('*').order('sort_order');
        if (error) throw error;
        pillsCatalog = (data || []).map((p) => ({
            ...p,
            published_at: p.published_at,
            publishedAt: p.published_at,
            order: p.sort_order,
            seal_url: safeHttpUrl(String(p.seal_url || '').trim()),
            seal_name: String(p.seal_name || '').trim(),
            seal_path: String(p.seal_path || '').trim()
        }));
        pillsData = [];
        if (currentQuizMode === 'pills') {
            rawData = pillsData;
            renderPillsList();
        }
        const evalBrief = document.getElementById('evaluation-brief-view');
        if (evalBrief && !evalBrief.classList.contains('hidden')) {
            updateEvaluationBriefAutoUI();
        }
        const profileView = document.getElementById('profile-view');
        if (profileView && !profileView.classList.contains('hidden')) {
            renderProfilePillsCard();
        }
    } catch (e) {
        debugError("Error al cargar píldoras:", e);
    }
}

/** Evita restaurar el dashboard dos veces (INITIAL_SESSION + fallback getSession). */
let sessionRestoreHandled = false;

function isResetPasswordRoute() {
    return window.location.pathname === RESET_PASSWORD_PATH
        || window.location.pathname === `${RESET_PASSWORD_PATH}/`;
}

function isProfileDashboardVisible() {
    const profileView = document.getElementById('profile-view');
    return profileView && !profileView.classList.contains('hidden');
}

/**
 * Si hay sesión guardada en el navegador, entra al perfil sin pedir login de nuevo.
 * El refresh token de Supabase renueva el access token en segundo plano.
 */
async function restoreAuthenticatedSession(user) {
    if (!supabase || !user || sessionRestoreHandled) return;
    if (isPasswordRecoveryFlow || _recoveryFlowPending || isResetPasswordRoute()) return;
    if (isProfileDashboardVisible()) {
        sessionRestoreHandled = true;
        return;
    }

    sessionRestoreHandled = true;
    supabaseSession = (await supabase.auth.getSession()).data?.session ?? supabaseSession;

    try {
        userEmail = (user.email || '').trim().toLowerCase();
        if (!userEmail) {
            await supabase.auth.signOut();
            sessionRestoreHandled = false;
            return;
        }

        const role = user.app_metadata?.role || 'user';
        const { data: rankingRow } = await supabase
            .from('ranking_user')
            .select('nombre')
            .eq('email', userEmail)
            .maybeSingle();

        if (!rankingRow) {
            await supabase.auth.signOut();
            supabaseSession = null;
            sessionRestoreHandled = false;
            return;
        }

        userName = rankingRow.nombre || user.user_metadata?.nombre || (role === 'admin' ? 'Administrador' : 'Usuario');
        emailVerified = true;

        if (user.app_metadata?.force_password_change === true) {
            promptChangePassword(user.id, '', 'ranking_user');
            return;
        }

        await showDashboard(userName);
    } catch (e) {
        debugWarn('restoreAuthenticatedSession:', e);
        sessionRestoreHandled = false;
    }
}

// Listener de autenticación: recovery + restaurar sesión al recargar
if (supabase) {
    supabase.auth.onAuthStateChange((event, session) => {
        supabaseSession = session;

        if (event === 'PASSWORD_RECOVERY') {
            _recoveryFlowPending = false;
            openRecoveryModal();
            return;
        }

        // Supabase a veces emite SIGNED_IN en lugar de PASSWORD_RECOVERY.
        // También cubre el caso donde el SDK intercambia el código antes de que
        // _recoveryFlowPending se active (race condition con detectSessionInUrl).
        if (event === 'SIGNED_IN' && (_recoveryFlowPending || isResetPasswordRoute())) {
            _recoveryFlowPending = false;
            if (!isPasswordRecoveryFlow) openRecoveryModal();
            return;
        }

        if (event === 'INITIAL_SESSION') {
            if (session && (isResetPasswordRoute() || _recoveryFlowPending)) {
                _recoveryFlowPending = false;
                openRecoveryModal();
                sessionRestoreHandled = true;
                return;
            }
            if (session?.user) {
                restoreAuthenticatedSession(session.user);
            } else {
                sessionRestoreHandled = true;
            }
        }
    });
}

/**
 * Detecta los formatos de callback que Supabase puede emitir en el link de recuperación:
 *   1. token_hash → ?token_hash=...&type=recovery  (recomendado, resistente a escáneres de correo)
 *   2. PKCE flow  → ?code=...
 *   3. Implicit   → #access_token=...&type=recovery
 *
 * CLAVE: NO verificamos el token al cargar. Mostramos un botón de confirmación y el
 * verifyOtp/setSession solo se dispara con un clic humano (ver confirmRecovery). Así,
 * cuando un escáner de correo (Proofpoint URL Defense, Microsoft Safe Links, etc.)
 * pre-visita el link, solo descarga el HTML estático y NO consume el token de un solo uso.
 */
async function initPasswordRecoveryFlow() {
    if (!supabase) return;

    const onResetRoute = isResetPasswordRoute();
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    const code = params.get('code');
    const tokenHash = params.get('token_hash');
    const type = params.get('type');
    const hasRecoveryHash = hash.includes('type=recovery');
    const hasErrorParam = params.has('error') || hash.includes('error=');

    // El link ya viene con error (token expirado/consumido): avisar de una vez.
    if (onResetRoute && hasErrorParam && !code && !tokenHash && !hasRecoveryHash) {
        _showRecoveryError();
        return;
    }

    // --- Formato 1: token_hash (?token_hash=...&type=recovery) ---
    if (tokenHash && type === 'recovery') {
        history.replaceState({}, document.title, RESET_PASSWORD_PATH);
        _showRecoveryConfirm(() => supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash }));
        return;
    }

    // --- Formato 2: PKCE (?code=...) ---
    if (code) {
        history.replaceState({}, document.title, RESET_PASSWORD_PATH);
        _showRecoveryConfirm(() => supabase.auth.exchangeCodeForSession(code));
        return;
    }

    // --- Formato 3: Implicit (#access_token=...&type=recovery) ---
    if (hasRecoveryHash) {
        const hashParams = new URLSearchParams(hash.substring(1));
        const access_token = hashParams.get('access_token');
        const refresh_token = hashParams.get('refresh_token');
        history.replaceState({}, document.title, RESET_PASSWORD_PATH);
        if (access_token) {
            _showRecoveryConfirm(() => supabase.auth.setSession({ access_token, refresh_token: refresh_token ?? '' }));
            return;
        }
        _showRecoveryError();
        return;
    }

    // Fallback: ya en /reset-password sin parámetros (ej. recarga de página con sesión activa).
    if (onResetRoute) {
        const opened = await _openRecoveryModalIfSessionAvailable();
        if (!opened) _showRecoveryError();
    }
}

/**
 * Muestra el modal con el botón de confirmación. Guarda la verificación pendiente
 * (verifyFn) para ejecutarla solo cuando el usuario haga clic en confirmRecovery.
 */
function _showRecoveryConfirm(verifyFn) {
    _pendingRecoveryVerify = verifyFn;
    isPasswordRecoveryFlow = false;
    document.getElementById('auth-card')?.classList.add('hidden');

    const errEl = document.getElementById('recovery-confirm-error');
    if (errEl) { errEl.innerText = ''; errEl.classList.add('hidden'); }
    const btn = document.getElementById('btn-recovery-confirm');
    if (btn) { btn.disabled = false; btn.innerHTML = T.auth.recoveryConfirmBtn; }
    const titleEl = document.getElementById('recovery-confirm-title');
    const descEl = document.getElementById('recovery-confirm-desc');
    if (titleEl) titleEl.textContent = T.auth.recoveryConfirmTitle;
    if (descEl) descEl.textContent = T.auth.recoveryConfirmDesc;

    document.getElementById('recovery-confirm-modal')?.classList.remove('hidden');
}

/** Dispara la verificación del token SOLO con el clic del usuario. */
window.confirmRecovery = async function () {
    if (!_pendingRecoveryVerify || !supabase) return;

    const btn = document.getElementById('btn-recovery-confirm');
    const errEl = document.getElementById('recovery-confirm-error');
    if (btn) { btn.disabled = true; btn.innerHTML = T.auth.recoveryConfirmLoading; }
    if (errEl) { errEl.innerText = ''; errEl.classList.add('hidden'); }

    const verifyFn = _pendingRecoveryVerify;
    _pendingRecoveryVerify = null;
    const { error } = await verifyFn();

    // En éxito, el listener de onAuthStateChange ya pudo abrir el modal de nueva contraseña.
    const opened = isPasswordRecoveryFlow || await _openRecoveryModalIfSessionAvailable();
    document.getElementById('recovery-confirm-modal')?.classList.add('hidden');

    if (opened) return;
    if (error) { _showRecoveryError(); return; }
    openRecoveryModal();
};

async function _openRecoveryModalIfSessionAvailable() {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) {
        openRecoveryModal();
        return true;
    }
    return false;
}

function _showRecoveryError() {
    history.replaceState({}, document.title, '/');
    showAppAlert({
        title: T.alerts.recoveryInvalidTitle,
        message: T.alerts.recoveryInvalidMessage,
        variant: 'error',
        confirmText: T.common.understood,
    });
}

/**
 * Recovery de contraseña + fallback si INITIAL_SESSION ya se emitió antes del listener.
 */
async function initAppAuth() {
    const ssoAt = sessionStorage.getItem('_sso_at');
    const ssoRt = sessionStorage.getItem('_sso_rt');
    if (ssoAt) sessionStorage.removeItem('_sso_at');
    if (ssoRt) sessionStorage.removeItem('_sso_rt');
    if (supabase && ssoAt && ssoRt) {
        const { data, error } = await supabase.auth.setSession({ access_token: ssoAt, refresh_token: ssoRt });
        if (!error && data.session?.user) {
            sessionRestoreHandled = false;
            supabaseSession = data.session;
            await restoreAuthenticatedSession(data.session.user);
            const ssoNext = sessionStorage.getItem('_sso_next');
            if (ssoNext) {
                sessionStorage.removeItem('_sso_next');
                const modeMap = { pruebas: 'practice', evaluaciones: 'evaluation', pills: 'pills' };
                const mode = modeMap[ssoNext];
                // openModeFromProfile maneja la transición desde profile-view → selectMode
                if (mode) setTimeout(() => window.openModeFromProfile?.(mode), 400);
            }
            return;
        }
    }

    await initPasswordRecoveryFlow();
    if (!supabase || sessionRestoreHandled) return;
    if (isPasswordRecoveryFlow || _recoveryFlowPending || isResetPasswordRoute()) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
        supabaseSession = session;
        await restoreAuthenticatedSession(session.user);
    } else {
        sessionRestoreHandled = true;
    }
}

initAppAuth();

let questions = [];
let currentSession = [];
let currentIndex = 0;
let score = 0;
let streak = 0;
let errors = [];
let userName = "";
let userEmail = "";
let startTime = 0;
let breakImages = [];
let evaluationTimerId = null;
let evaluationTimeLeft = EVALUATION_QUESTION_TIME;
let isEvaluationSessionActive = false;
let isHandlingEvalViolation = false;
let lastEvalViolationAt = 0;

let activeCategories = new Set();
/** Pill activa en el quiz (doc id en `pills`) + metadatos para el badge */
let selectedPillId = '';
let selectedPillMeta = { name: '', category: '', sealUrl: '', sealName: '' };
/** True si ya había un intento previo guardado para esta pill al iniciar la sesión actual (2.º intento o más). */
let pillsSessionHadPriorAttempt = false;
let lastPillSessionOrderByPillId = {};
let pillRatingsSummaryByPillId = {};
let myPillRatingByPillId = {};
let pillsAnswerLocked = false;
let pillsTouchStartX = 0;
let pillsTouchStartY = 0;
let pillsTouchDeltaX = 0;
let pillsTouchDeltaY = 0;
/** Última posición del puntero/dedo (para soltar en desktop). */
let pillsLastPointerClientX = 0;
let pillsLastPointerClientY = 0;
let pillsTouchDragging = false;
let pillsSwipePointerId = null;
function isPillsSwipeViewportMobile() {
    return window.matchMedia('(max-width: 767px)').matches;
}

function getPillSessionRandomizedPool(pool, pillId) {
    if (!Array.isArray(pool) || pool.length <= 1) return [...pool];
    const previousOrderKey = lastPillSessionOrderByPillId[pillId] || '';
    let best = shuffleFisherYates(pool);
    const currentKey = () => best.map((q) => String(q?.id || q?.question || '')).join('|');
    if (currentKey() !== previousOrderKey) return best;

    // Reintenta algunas veces para reducir repetición consecutiva del orden completo.
    for (let attempt = 0; attempt < 5; attempt++) {
        best = shuffleFisherYates(pool);
        if (currentKey() !== previousOrderKey) return best;
    }
    return best;
}

function pillsClearCardDirectionHints(card) {
    if (!card) return;
    card.classList.remove(
        'pills-question-card--towards-false',
        'pills-question-card--towards-true'
    );
}

/** Escritorio: tinte según posición del cursor respecto al centro del layout V/F */
function pillsApplyDragHintFromClientX(clientX) {
    const card = document.getElementById('pills-question-card');
    const layout = document.querySelector('.pills-tf-layout');
    if (!card || !layout || typeof clientX !== 'number') return;
    const lr = layout.getBoundingClientRect();
    const mid = lr.left + lr.width / 2;
    const band = Math.min(40, lr.width * 0.07);
    card.classList.toggle('pills-question-card--towards-false', clientX < mid - band);
    card.classList.toggle('pills-question-card--towards-true', clientX > mid + band);
    if (clientX >= mid - band && clientX <= mid + band) {
        pillsClearCardDirectionHints(card);
    }
}

function pillsApplySwipeVisual(clientX, clientY) {
    const card = document.getElementById('pills-question-card');
    if (!card) return;
    pillsLastPointerClientX = clientX;
    pillsLastPointerClientY = typeof clientY === 'number' ? clientY : pillsTouchStartY;
    pillsTouchDeltaX = clientX - pillsTouchStartX;
    pillsTouchDeltaY = pillsLastPointerClientY - pillsTouchStartY;

    if (isPillsSwipeViewportMobile()) {
        const dx = pillsTouchDeltaX;
        const rot = Math.max(Math.min(dx * 0.06, 8), -8);
        const opacity = Math.min(Math.abs(dx) / 90, 1);
        card.style.transform = `translateX(${dx}px) rotate(${rot}deg)`;
        card.style.setProperty('--swipe-opacity', String(opacity));
        card.classList.toggle('pills-question-card--swiping-left', dx < -8);
        card.classList.toggle('pills-question-card--swiping-right', dx > 8);
        card.classList.toggle('pills-question-card--towards-false', dx < -PILLS_HINT_DEAD_PX);
        card.classList.toggle('pills-question-card--towards-true', dx > PILLS_HINT_DEAD_PX);
        if (Math.abs(dx) <= PILLS_HINT_DEAD_PX) {
            pillsClearCardDirectionHints(card);
        }
        return;
    }

    /* Desktop / tablet ancho: arrastre hacia abajo hacia los botones; X elige Falso / Verdadero */
    const dyDown = Math.max(0, pillsTouchDeltaY);
    const dx = pillsTouchDeltaX;
    const rot = Math.max(Math.min(dx * 0.045, 7), -7);
    const pullY = Math.min(dyDown, 200);
    const opacity = Math.min(dyDown / 100, 1);
    card.style.transform = `translate(${dx * 0.22}px, ${pullY}px) rotate(${rot}deg)`;
    card.style.setProperty('--swipe-opacity', String(opacity));
    card.classList.remove('pills-question-card--swiping-left', 'pills-question-card--swiping-right');
    if (dyDown > 12) {
        pillsApplyDragHintFromClientX(clientX);
    } else {
        pillsClearCardDirectionHints(card);
    }
}

function pillsUpdateCardDraggable() {
    const card = document.getElementById('pills-question-card');
    if (!card) return;
    // Usamos interaccion por pointer/touch; desactivamos drag nativo del navegador.
    card.draggable = false;
}

// --- USER PROFILE DATA (loaded from Supabase on login) ---
let userProfile = {
    avatarUrl: MATERIAL.favicon,
    nickname: '',
    seniority: '',
    especialidad: '',
    formador: '',
    empId: '',
    proyectos: [],
    questPoints: 0,
    testsPoints: 0,
    pillsPoints: 0,
    latestPillRankId: '',
    /** true si el usuario ya completó la evaluación (tests_points no era null en ranking_user). */
    evalCompleted: false,
    /** { [pillDocId]: { score: number, total: number } } — calificación por pill (última sesión). */
    pillScores: {},
    seals: [],
    talents: []
};

/** Filtro activo del switcher de sellos. `q` es 'Q1'…'Q4' según `pills.quarter` en Supabase. */
let sealsFilter = { year: null, q: null };

function getSealYear(dateStr) {
    return new Date(dateStr).getFullYear();
}

/** Trimestre calendario 1–4 (solo respaldo si el sello no trae `pills.quarter`). */
function getCalendarQuarterFromDate(dateStr) {
    return Math.floor(new Date(dateStr).getMonth() / 3) + 1;
}

/** Normaliza texto de columna `pills.quarter` ('Q1'…'Q4') o null. */
function normalizePillQuarter(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim().toUpperCase();
    return /^Q[1-4]$/.test(s) ? s : null;
}

/**
 * Q efectivo para filtros/UI: prioriza `seal.quarter` (viene de `pills.quarter`);
 * si no hay (sellos legacy), usa trimestre calendario de `date`.
 */
function effectiveSealQuarter(seal) {
    const fromPill = normalizePillQuarter(seal?.quarter);
    if (fromPill) return fromPill;
    const cq = getCalendarQuarterFromDate(seal?.date);
    return `Q${cq}`;
}

// --- SUPABASE PROFILE LOADING ---
async function loadUserProfile(uid) {
    if (!supabase || !uid) return;
    try {
        const { data, error } = await supabase.from('user_profiles').select('*').eq('id', uid).maybeSingle();
        // PGRST116 = sin filas: no es error fatal, el usuario simplemente no tiene perfil aún
        if (error && error.code !== 'PGRST116') throw error;
        if (data) {
            userProfile.questPoints  = data.quest_points    || 0;
            userProfile.testsPoints  = data.tests_points    || 0;
            userProfile.pillsPoints  = data.pills_points    || 0;
            userProfile.nickname     = data.nickname         || '';
            userProfile.avatarUrl    = data.avatar_url       || MATERIAL.favicon;
        }
        // Cargar pillScores (soporta esquema nuevo y legado)
        let scores = [];
        const { data: scoresNew, error: scoresNewErr } = await supabase
            .from('user_pill_scores')
            .select('pill_id, score, total, errors, sticker_granted')
            .eq('user_id', uid);
        if (scoresNewErr) {
            // Fallback: si aún no existen columnas nuevas, usar esquema legado.
            const { data: scoresLegacy, error: scoresLegacyErr } = await supabase
                .from('user_pill_scores')
                .select('pill_id, score, total')
                .eq('user_id', uid);
            if (scoresLegacyErr) throw scoresLegacyErr;
            scores = scoresLegacy || [];
        } else {
            scores = scoresNew || [];
        }
        userProfile.pillScores = {};
        scores.forEach(s => {
            if (!isValidPillFirstAttemptRow(s)) return;
            const total = Number(s.total || 0);
            const score = Number(getNullablePillScoreValue(s) || 0);
            const fallbackErrors = Math.max(total - score, 0);
            const errorsVal =
                s.errors === undefined || s.errors === null
                    ? fallbackErrors
                    : Number(s.errors || 0);
            const stickerGrantedVal =
                s.sticker_granted === undefined || s.sticker_granted === null
                    ? (total > 0 && errorsVal <= 1)
                    : Boolean(s.sticker_granted);
            userProfile.pillScores[s.pill_id] = {
                score,
                total,
                errors: errorsVal,
                stickerGranted: stickerGrantedVal
            };
        });
    } catch (e) {
        debugWarn('loadUserProfile error:', e);
    }
}

/** Extrae el texto de seniority guardado en el registro de participante. */
function pickSeniorityFromRankingData(data) {
    if (!data || typeof data !== 'object') return '';
    const v = data.seniority ?? data.Seniority;
    if (v === undefined || v === null) return '';
    const s = String(v).trim();
    return s || '';
}

/**
 * Datos principales del perfil/ranking en `ranking_user`.
 * Fuente de verdad para puntos del perfil:
 * - quest_points  -> #profile-quest-pts
 * - tests_points  -> #eval-completed-score (brief, estado completado)
 * - pills_points  -> #profile-pills-pts
 * Seniority y especialidad del perfil (#profile-seniority, #profile-especialidad) vienen de aquí.
 */
async function loadRankingUserStats() {
    if (!supabase || !userEmail || !userEmail.includes('@')) return;
    try {
        const userId = supabaseSession?.user?.id;
        const { data, error } = await supabase
            .from('ranking_user')
            .select('nombre, nickname, foto_url, seniority, especialidad, formador, emp_id, proyecto, proyecto_2, proyecto_3, proyecto_4')
            .eq('email', userEmail.toLowerCase())
            .single();
        if (error) throw error;
        if (data) {
            if (data.nombre && String(data.nombre).trim()) {
                userProfile.nombre = String(data.nombre).trim();
            }
            if (data.nickname && String(data.nickname).trim()) {
                userProfile.nickname = String(data.nickname).trim();
            }
            if (data.foto_url && String(data.foto_url).trim()) {
                userProfile.avatarUrl = String(data.foto_url).trim();
            }
            const rawSeniority = data.seniority;
            if (rawSeniority && String(rawSeniority).trim()) {
                userProfile.seniority = String(rawSeniority).trim();
            }
            if (data.especialidad && String(data.especialidad).trim()) {
                userProfile.especialidad = String(data.especialidad).trim();
            }
            if (data.formador && String(data.formador).trim()) {
                userProfile.formador = String(data.formador).trim();
            }
            if (data.emp_id && String(data.emp_id).trim()) {
                userProfile.empId = String(data.emp_id).trim();
            }
            userProfile.proyectos = [
                data.proyecto, data.proyecto_2, data.proyecto_3, data.proyecto_4
            ].filter(p => p && String(p).trim());
        }
        if (userId) {
            const { data: scores } = await supabase
                .from('user_scores')
                .select('quest_points, tests_points_q2, pills_points, pills_rank_pill_id')
                .eq('user_id', userId)
                .maybeSingle();
            if (scores) {
                userProfile.questPoints = Number(scores.quest_points || 0);
                userProfile.testsPoints = Number(scores.tests_points_q2 || 0);
                userProfile.pillsPoints = Number(scores.pills_points || 0);
                userProfile.latestPillRankId = String(scores.pills_rank_pill_id || '').trim();
                userProfile.evalCompleted = scores.tests_points_q2 != null;
            }
        }
    } catch (e) {
        debugWarn('loadRankingUserStats error:', e);
    }
}

/** Imagen (GIF) del sello de Orador, común a todos los ponentes. */
const SPEAKER_SEAL_IMAGE_URL = 'https://pmezmoobuwwbirwzensj.supabase.co/storage/v1/object/public/sellos-pill/ponentes.gif';

/**
 * Sella el perfil: `user_sellos` (legacy), `user_pill_scores` (V/F), `user_pill_badges` (asignación admin).
 * Mismo `pill_id` se deduplica a un solo ítem: id canónico `pill-{uuid}`; si hay fila en ambas tablas, gana la de badges (última en el merge).
 * Supabase: en `user_pill_badges` hace falta RLS con `USING (auth.uid() = user_id)` (o equivalente) para que el SELECT no devuelva 0 filas.
 */
async function loadUserSeals(uid) {
    if (!supabase || !uid) return;
    try {
        const { data, error } = await supabase
            .from('user_sellos')
            .select('fecha_asignacion, sellos(id, nombre, icono)')
            .eq('user_id', uid);
        if (error) throw error;
        const legacySeals = (data || []).map(d => ({
            id: d.sellos.id,
            name: d.sellos.nombre || T.common.sealFallback,
            icon: d.sellos.icono  || 'fa-star',
            date: d.fecha_asignacion || new Date().toISOString().split('T')[0]
        }));

        let pillScoreRows = [];
        let pillScoresErr = null;
        ({ data: pillScoreRows, error: pillScoresErr } = await supabase
            .from('user_pill_scores')
            .select('pill_id, score, total, errors, sticker_granted, created_at, updated_at')
            .eq('user_id', uid));

        if (pillScoresErr) {
            // Fallback legacy para esquemas sin columnas nuevas.
            ({ data: pillScoreRows, error: pillScoresErr } = await supabase
                .from('user_pill_scores')
                .select('pill_id, score, total')
                .eq('user_id', uid));
        }

        let pillSeals = [];
        if (pillScoresErr) {
            debugWarn('loadUserSeals user_pill_scores:', pillScoresErr);
        } else {
            const qualifyingPillRows = (pillScoreRows || []).filter((row) => {
                if (!isValidPillFirstAttemptRow(row)) return false;
                const total = Number(row?.total || 0);
                const score = Number(getNullablePillScoreValue(row) || 0);
                const fallbackErrors = Math.max(total - score, 0);
                const errorsVal =
                    row?.errors === undefined || row?.errors === null
                        ? fallbackErrors
                        : Number(row.errors || 0);
                const explicitGranted =
                    row?.sticker_granted === undefined || row?.sticker_granted === null
                        ? null
                        : Boolean(row.sticker_granted);
                return explicitGranted === true || (explicitGranted === null && total > 0 && errorsVal <= 1);
            });

            const pillIds = [...new Set(qualifyingPillRows.map((r) => String(r.pill_id || '').trim()).filter(Boolean))];
            let pillsById = new Map();
            if (pillIds.length > 0) {
                const { data: pillRows, error: pillsErr } = await supabase
                    .from('pills')
                    .select('id, name, seal_url, seal_name, quarter')
                    .in('id', pillIds);
                if (!pillsErr) {
                    pillsById = new Map((pillRows || []).map((p) => [String(p.id), p]));
                }
            }

            pillSeals = qualifyingPillRows.map((row) => {
                const pid = String(row.pill_id || '').trim();
                const pill = pillsById.get(pid);
                const safeSealUrl = safeHttpUrl(String(pill?.seal_url || '').trim());
                const sealName = String(
                    pill?.name ||
                    pill?.seal_name ||
                    T.common.sealFallback
                ).trim();
                return {
                    id: `pill-${pid}`,
                    name: sealName || T.common.sealFallback,
                    icon: 'fa-stamp',
                    imageUrl: safeSealUrl,
                    quarter: normalizePillQuarter(pill?.quarter),
                    date:
                        row.created_at ||
                        row.updated_at ||
                        new Date().toISOString().split('T')[0]
                };
            });
        }

        // Asignación explícita (admin) — mismo `pill_id` que scores: un solo sello visible (id `pill-{uuid}`).
        const { data: badgeRows, error: pillBadgesErr } = await supabase
            .from('user_pill_badges')
            .select('pill_id, awarded_at, pills(id, name, seal_url, seal_name, quarter)')
            .eq('user_id', uid);

        if (pillBadgesErr) {
            debugWarn('loadUserSeals user_pill_badges:', pillBadgesErr);
        }

        const pillBadgeSeals = (pillBadgesErr ? [] : (badgeRows || [])).map((row) => {
            const pill = Array.isArray(row.pills) ? row.pills[0] : row.pills;
            const pid = String(row.pill_id || '').trim();
            const safeSealUrl = safeHttpUrl(String(pill?.seal_url || '').trim());
            const sealName = String(
                pill?.name ||
                pill?.seal_name ||
                T.common.sealFallback
            ).trim();
            return {
                id: `pill-${pid}`,
                name: sealName || T.common.sealFallback,
                icon: 'fa-medal',
                imageUrl: safeSealUrl,
                quarter: normalizePillQuarter(pill?.quarter),
                date: row.awarded_at || new Date().toISOString()
            };
        });

        // Sello de "Orador" (speaker_awards): un solo sello por (año, quarter) con contador ×N.
        let speakerSeals = [];
        const { data: speakerRows, error: speakerErr } = await supabase
            .from('speaker_awards')
            .select('quarter, year, awarded_at')
            .eq('user_id', uid);

        if (speakerErr) {
            debugWarn('loadUserSeals speaker_awards:', speakerErr);
        } else {
            const qStartMonth = { Q1: '01', Q2: '04', Q3: '07', Q4: '10' };
            const groups = new Map(); // `${year}-${quarter}` -> { year, quarter, count }
            (speakerRows || []).forEach((r) => {
                const q = normalizePillQuarter(r.quarter);
                const year = Number(r.year);
                if (!q || !year) return;
                const key = `${year}-${q}`;
                const g = groups.get(key) || { year, quarter: q, count: 0 };
                g.count += 1;
                groups.set(key, g);
            });
            speakerSeals = [...groups.values()].map((g) => ({
                id: `speaker-${g.year}-${g.quarter}`,
                name: g.count > 1 ? `Orador ×${g.count}` : 'Orador',
                icon: 'fa-microphone-lines',
                imageUrl: SPEAKER_SEAL_IMAGE_URL,
                quarter: g.quarter,
                count: g.count,
                date: `${g.year}-${qStartMonth[g.quarter] || '01'}-01T12:00:00`
            }));
        }

        const merged = [...legacySeals, ...pillSeals, ...pillBadgeSeals, ...speakerSeals];
        const byId = new Map();
        merged.forEach((seal) => {
            if (!seal?.id) return;
            byId.set(String(seal.id), seal);
        });
        userProfile.seals = [...byId.values()];
    } catch (e) {
        debugWarn('loadUserSeals error:', e);
    }
}

/**
 * Talentos: una fila en `user_habilidades` por usuario con habilidad_id_1 … habilidad_id_5
 * (FK a habilidades). Imágenes en catálogo `habilidades.imagen_url`; si vacío, icono en `icono`.
 */
async function loadUserSkills(uid) {
    if (!supabase || !uid) return;
    try {
        const { data: row, error } = await supabase
            .from('user_habilidades')
            .select('habilidad_id_1, habilidad_id_2, habilidad_id_3, habilidad_id_4, habilidad_id_5')
            .eq('user_id', uid)
            .maybeSingle();
        if (error) throw error;
        if (!row) {
            userProfile.talents = [];
            return;
        }

        const orderedIds = [
            row.habilidad_id_1,
            row.habilidad_id_2,
            row.habilidad_id_3,
            row.habilidad_id_4,
            row.habilidad_id_5
        ].filter((id) => id != null && id !== '');

        if (orderedIds.length === 0) {
            userProfile.talents = [];
            return;
        }

        const habilidadesSelects = [
            'id, nombre, icono, imagen_url, descripcion, como_lo_vives, recomendaciones, habilidades_clave, ojo_con, sort_order',
            'id, nombre, icono, imagen_url, descripcion',
            'id, nombre, icono, imagen_url'
        ];
        let habRows;
        let hErr;
        for (const cols of habilidadesSelects) {
            ({ data: habRows, error: hErr } = await supabase
                .from('habilidades')
                .select(cols)
                .in('id', orderedIds));
            if (!hErr) break;
        }
        if (hErr) throw hErr;

        const byId = new Map();
        (habRows || []).forEach((h) => {
            byId.set(String(h.id), h);
        });

        userProfile.talents = orderedIds.map((id) => {
            const h = byId.get(String(id));
            return {
                habilidadId: String(id),
                name: (h && h.nombre) || T.common.skillFallback,
                icon: (h && h.icono) || 'fa-brain',
                imageUrl: (h && h.imagen_url) || '',
                description: String((h && h.descripcion) || '').trim(),
                comoLoVives: String((h && h.como_lo_vives) || '').trim(),
                recomendaciones: String((h && h.recomendaciones) || '').trim(),
                habilidadesClave: String((h && h.habilidades_clave) || '').trim(),
                ojoCon: String((h && h.ojo_con) || '').trim(),
                sortOrder: Number(h && h.sort_order) || 0
            };
        });
    } catch (e) {
        debugWarn('loadUserSkills error:', e);
    }
}

async function loadAllUserData(uid) {
    await Promise.all([
        loadUserProfile(uid),
        loadUserSeals(uid),
        loadUserSkills(uid)
    ]);
    await loadRankingUserStats();
    // Estado de la evaluación al formador (solo aplica a puestos con equipo a su cargo).
    if (canEvaluateFormador(userProfile.especialidad)) await loadFormadorCompletion();
}

/** ¿El usuario ya completó la evaluación al formador? Guarda la fecha más reciente en userProfile.formadorDoneAt. */
async function loadFormadorCompletion() {
    userProfile.formadorDoneAt = null;
    const userId = supabaseSession?.user?.id;
    if (!supabase || !userId) return;
    try {
        const { data, error } = await supabase
            .from('respuestas_evaluar_formador')
            .select('fecha')
            .eq('user_id', userId)
            .order('fecha', { ascending: false })
            .limit(1);
        if (error) throw error;
        if (data && data.length) userProfile.formadorDoneAt = data[0].fecha;
    } catch (e) {
        debugWarn('loadFormadorCompletion error:', e);
    }
}

// --- PROFILE LOGIC ---

/** Especialidades que pueden ver el bloque «Mi equipo» (formador por nombre completo en `formador`). */
const TEAM_MANAGER_ESPECIALIDAD_KEYS = new Set([
    'product designers',
    'product designer',
    'customer success',
    'administrativo',
]);

function isTeamManagerEspecialidad(especialidadRaw) {
    const key = normalizeLabelKey(especialidadRaw);
    return TEAM_MANAGER_ESPECIALIDAD_KEYS.has(key);
}

/**
 * ¿Este perfil puede hacer la evaluación 360 al formador?
 * Team managers (PD/CS/Administrativo) + cualquier perfil con bucket de rol
 * (UX, UI, UX/UI, UX Writer). Sus preguntas se filtran por bucket en buildFormadorBlocks.
 * OJO: la card «Mi equipo» sigue gobernada por isTeamManagerEspecialidad (solo managers reales),
 * para no mostrar una card de equipo vacía a un IC.
 */
function canEvaluateFormador(especialidadRaw) {
    return isTeamManagerEspecialidad(especialidadRaw) || formadorRoleBucket(especialidadRaw) !== '';
}

function formadorNameKey(name) {
    return String(name || '').trim().toLowerCase();
}

function hideProfileTeamCard() {
    const card = document.getElementById('profile-team-card');
    if (!card) return;
    card.classList.add('hidden');
    card.hidden = true;
}

/**
 * Reportes cuyo `ranking_user.formador` coincide con el nombre completo del usuario (case-insensitive).
 */
async function loadTeamReports() {
    if (!supabase) return [];
    const bossName = String(userName || '').trim();
    if (!bossName) return [];

    const bossKey = formadorNameKey(bossName);
    const myUid = supabaseSession?.user?.id;
    const myEmail = String(userEmail || '').trim().toLowerCase();

    try {
        const { data, error } = await supabase
            .from('ranking_user')
            .select('user_id, nombre, email, seniority, especialidad, formador')
            .not('formador', 'is', null);
        if (error) throw error;

        const rows = (data || []).filter((row) => {
            const formador = String(row.formador || '').trim();
            if (!formador || formadorNameKey(formador) !== bossKey) return false;
            if (myUid && row.user_id && String(row.user_id) === String(myUid)) return false;
            if (myEmail && row.email && String(row.email).trim().toLowerCase() === myEmail) return false;
            return true;
        });

        if (rows.length === 0) return [];

        const peerIds = [...new Set(
            rows.map((r) => String(r.user_id || '')).filter(Boolean)
        )];

        let profileMap = new Map();
        let scoresMap = new Map();
        if (peerIds.length > 0) {
            const { data: profiles, error: profilesErr } = await supabase
                .from('user_profiles')
                .select('id, nickname, avatar_url')
                .in('id', peerIds);
            if (profilesErr) debugWarn('loadTeamReports user_profiles:', profilesErr);
            (profiles || []).forEach((p) => {
                profileMap.set(String(p.id), {
                    nickname: String(p.nickname || '').trim(),
                    avatarUrl: p.avatar_url || '',
                });
            });

            const { data: peerScores } = await supabase
                .from('user_scores')
                .select('user_id, tests_points_q2')
                .in('user_id', peerIds);
            (peerScores || []).forEach(s => scoresMap.set(String(s.user_id), s));
        }

        return rows
            .map((row) => {
                const uid = String(row.user_id || '');
                const profile = profileMap.get(uid) || {};
                const nombre = String(row.nombre || '').trim();
                return {
                    uid,
                    name: nombre || profile.nickname || T.common.anonymous,
                    especialidad: String(row.especialidad || '').trim(),
                    seniority: String(row.seniority || '').trim(),
                    testsPoints: scoresMap.get(uid)?.tests_points_q2,
                    avatarUrl: profile.avatarUrl || '',
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    } catch (e) {
        debugWarn('loadTeamReports error:', e);
        throw e;
    }
}

function renderProfileTeamMember(member) {
    const item = document.createElement('article');
    item.className = 'bento-team-member';
    item.setAttribute('role', 'listitem');

    const top = document.createElement('div');
    top.className = 'bento-team-member__top';

    const left = document.createElement('div');
    left.className = 'bento-team-member__left';

    const avatar = buildPeerAvatarEl(
        { name: member.name, avatarUrl: member.avatarUrl },
        'lg'
    );
    left.appendChild(avatar);

    const meta = document.createElement('div');
    meta.className = 'bento-team-member__meta';

    const nameEl = document.createElement('span');
    nameEl.className = 'bento-team-member__name';
    nameEl.textContent = member.name;
    meta.appendChild(nameEl);

    left.appendChild(meta);
    item.appendChild(left);

    const tags = document.createElement('div');
    tags.className = 'bento-team-member__tags';

    const especialidadEl = document.createElement('span');
    const especialidad = String(member.especialidad || '').trim();
    if (especialidad) {
        especialidadEl.className = 'bento-team-member__especialidad';
        especialidadEl.textContent = especialidad;
    } else {
        especialidadEl.className = 'bento-team-member__especialidad bento-team-member__especialidad--empty';
        especialidadEl.textContent = T.profile.sinRegistrar;
    }
    tags.appendChild(especialidadEl);

    const seniorityEl = document.createElement('span');
    const seniority = String(member.seniority || '').trim();
    if (seniority) {
        seniorityEl.className = 'bento-team-member__seniority';
        seniorityEl.textContent = seniority;
    } else {
        seniorityEl.className = 'bento-team-member__seniority bento-team-member__seniority--empty';
        seniorityEl.textContent = T.profile.teamNoSeniority;
    }
    tags.appendChild(seniorityEl);

    top.appendChild(left);
    top.appendChild(tags);
    item.appendChild(top);

    const accordion = document.createElement('details');
    accordion.className = 'bento-team-member__accordion';

    const summary = document.createElement('summary');
    summary.className = 'bento-team-member__accordion-summary';
    summary.textContent = T.profile.teamEvalTitle;
    accordion.appendChild(summary);

    const content = document.createElement('div');
    content.className = 'bento-team-member__accordion-content';
    const pointsRaw = member.testsPoints;
    const pointsNum = Number(pointsRaw);
    const hasPoints = pointsRaw !== null && pointsRaw !== undefined && Number.isFinite(pointsNum);
    content.textContent = hasPoints
        ? T.profile.teamEvalPoints(pointsNum)
        : T.profile.teamEvalPending;
    accordion.appendChild(content);

    item.appendChild(accordion);
    return item;
}

function teamFirstName(fullName) {
    return String(fullName || '').trim().split(/\s+/)[0] || T.common.anonymous;
}

function renderProfileTeamPreviewMember(member) {
    const item = document.createElement('div');
    item.className = 'bento-team-preview-item';

    const avatar = buildPeerAvatarEl(
        { name: member.name, avatarUrl: member.avatarUrl },
        'lg'
    );
    avatar.classList.add('bento-team-preview-item__avatar');
    item.appendChild(avatar);

    const name = document.createElement('span');
    name.className = 'bento-team-preview-item__name';
    name.textContent = teamFirstName(member.name);
    item.appendChild(name);

    return item;
}

async function renderProfileTeam() {
    const accordion = document.getElementById('profile-team-accordion');
    const preview = document.getElementById('profile-team-preview');
    const card = document.getElementById('profile-team-card');
    const list = document.getElementById('profile-team-list');
    const empty = document.getElementById('profile-team-empty');
    const titleText = document.getElementById('profile-team-title-text');
    const count = document.getElementById('profile-team-count');
    if (!card || !accordion || !preview || !list || !empty || !titleText || !count) return;

    if (!isTeamManagerEspecialidad(userProfile.especialidad)) {
        hideProfileTeamCard();
        return;
    }

    card.classList.remove('hidden');
    card.hidden = false;
    accordion.open = false; // Siempre iniciar cerrado
    titleText.textContent = T.profile.teamTitle;
    count.classList.add('hidden');
    count.textContent = '';

    preview.innerHTML = '';
    list.innerHTML = '';
    list.classList.remove('hidden');
    list.classList.add('bento-team-list--loading');
    list.textContent = T.profile.teamLoading;
    empty.classList.add('hidden');
    empty.textContent = T.profile.teamEmpty;

    try {
        const reports = await loadTeamReports();
        list.classList.remove('bento-team-list--loading');
        list.innerHTML = '';

        if (reports.length === 0) {
            empty.classList.remove('hidden');
            count.classList.add('hidden');
            return;
        }

        count.textContent = T.profile.teamCountLabel(reports.length);
        count.classList.remove('hidden');
        reports.slice(0, 8).forEach((member) => {
            preview.appendChild(renderProfileTeamPreviewMember(member));
        });
        reports.forEach((member) => {
            list.appendChild(renderProfileTeamMember(member));
        });
    } catch (e) {
        list.classList.remove('bento-team-list--loading');
        list.innerHTML = '';
        empty.classList.remove('hidden');
        empty.textContent = T.profile.teamLoadError;
        count.classList.add('hidden');
    }
}

function getMillisFromFirestoreField(v) {
    if (v == null) return 0;
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    if (typeof v === 'number') {
        if (v > 1e12) return v;
        if (v > 1e9) return v * 1000;
        return v;
    }
    if (typeof v === 'string') {
        const t = Date.parse(v);
        return Number.isNaN(t) ? 0 : t;
    }
    return 0;
}

/** Última pill “publicada”: mayor fecha (publishedAt / createdAt / updatedAt) o mayor order. */
function getLatestPublishedPill() {
    if (!pillsCatalog.length) return null;
    const scored = pillsCatalog.map((pill) => {
        const t = Math.max(
            getMillisFromFirestoreField(pill.publishedAt),
            getMillisFromFirestoreField(pill.published_at),
            getMillisFromFirestoreField(pill.createdAt),
            getMillisFromFirestoreField(pill.created_at),
            getMillisFromFirestoreField(pill.updatedAt),
            getMillisFromFirestoreField(pill.updated_at)
        );
        const ord = Number(pill.order ?? pill.orden ?? 0);
        return { pill, t, ord };
    });
    scored.sort((a, b) => {
        if (a.t !== b.t) return b.t - a.t;
        if (a.ord !== b.ord) return b.ord - a.ord;
        return String(b.pill.name || b.pill.id).localeCompare(String(a.pill.name || a.pill.id), 'es');
    });
    return scored[0].pill;
}

function getPillPublishedAtMs(pill) {
    if (!pill || typeof pill !== 'object') return 0;
    return Math.max(
        getMillisFromFirestoreField(pill.publishedAt),
        getMillisFromFirestoreField(pill.published_at),
        getMillisFromFirestoreField(pill.createdAt),
        getMillisFromFirestoreField(pill.created_at)
    );
}

function getPillSealWindowState(pill) {
    const publishedAtMs = getPillPublishedAtMs(pill);
    if (publishedAtMs <= 0) {
        return {
            isLimited: false,
            isExpired: false,
            remainingMs: Number.POSITIVE_INFINITY
        };
    }
    const windowMs = PILLS_SEAL_WINDOW_HOURS * 60 * 60 * 1000;
    const expiresAtMs = publishedAtMs + windowMs;
    const remainingMs = expiresAtMs - Date.now();
    return {
        isLimited: true,
        isExpired: remainingMs <= 0,
        remainingMs
    };
}

function formatPillSealRemaining(remainingMs) {
    const totalMinutes = Math.max(0, Math.floor(Number(remainingMs || 0) / (60 * 1000)));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return days === 1 ? '1 día' : `${days} días`;
    if (hours > 0) return hours === 1 ? '1 hora' : `${hours} horas`;
    const m = Math.max(minutes, 1);
    return m === 1 ? '1 minuto' : `${m} minutos`;
}

function normalizePillScoreEntry(entry) {
    if (entry == null) return { score: 0, total: 0 };
    if (typeof entry === 'number') return { score: entry, total: 0 };
    if (typeof entry === 'object') {
        const s = Number(entry.score ?? entry.pts ?? 0);
        const t = Number(entry.total ?? entry.max ?? 0);
        return {
            score: Number.isNaN(s) ? 0 : s,
            total: Number.isNaN(t) ? 0 : t
        };
    }
    return { score: 0, total: 0 };
}

function renderProfilePillsCard() {
    const labelEl = document.getElementById('profile-pills-label');
    const valueEl = document.getElementById('profile-pills-pts');
    const inviteEl = document.getElementById('profile-pills-invite');
    const inviteTextEl = document.getElementById('profile-pills-invite-text');
    const singleActions = document.getElementById('profile-pills-actions-single');
    const dualActions = document.getElementById('profile-pills-actions-dual');
    const btnVer = document.getElementById('profile-pills-btn-ver');
    const btnIrSingle = document.getElementById('profile-pills-btn-ir-single');
    const btnIrDual = document.getElementById('profile-pills-btn-ir-dual');
    const newTagEl = document.getElementById('profile-pills-new-tag');

    if (!labelEl || !valueEl || !inviteEl || !singleActions || !dualActions) return;

    const setPillsNewTagVisible = (visible) => {
        if (newTagEl) {
            newTagEl.classList.toggle('hidden', !visible);
            newTagEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }
    };

    if (btnIrSingle) {
        btnIrSingle.onclick = () => window.openModeFromProfile('pills');
    }
    if (btnIrDual) {
        btnIrDual.onclick = () => window.openModeFromProfile('pills');
    }

    const latest = getLatestPublishedPill();
    const pillsPointsFromRanking = Number(userProfile.pillsPoints || 0);
    if (!latest) {
        setPillsNewTagVisible(false);
        labelEl.classList.remove('hidden');
        labelEl.textContent = T.profile.pointsPills;
        valueEl.classList.remove('hidden');
        valueEl.textContent = String(pillsPointsFromRanking);
        inviteEl.classList.add('hidden');
        singleActions.classList.remove('hidden');
        dualActions.classList.add('hidden');
        return;
    }

    const pillId = latest.id;
    const pillName = String(latest.name || latest.id || T.common.pillFallback).trim();
    const sealWindow = getPillSealWindowState(latest);
    const entry = userProfile.pillScores && userProfile.pillScores[pillId];
    const hasAttemptFromRanking =
        String(userProfile.latestPillRankId || '') === String(pillId) &&
        Number(userProfile.pillsPoints || 0) > 0;
    const hasAttempt = (entry !== undefined && entry !== null) || hasAttemptFromRanking;

    if (hasAttempt || sealWindow.isExpired) {
        setPillsNewTagVisible(false);
        labelEl.classList.remove('hidden');
        labelEl.textContent = T.profile.pointsPills;
        valueEl.classList.remove('hidden');
        valueEl.textContent = String(pillsPointsFromRanking);
        inviteEl.classList.add('hidden');
        singleActions.classList.remove('hidden');
        dualActions.classList.add('hidden');
        return;
    }

    setPillsNewTagVisible(true);
    labelEl.classList.add('hidden');
    valueEl.classList.add('hidden');
    inviteEl.classList.remove('hidden');
    singleActions.classList.add('hidden');
    dualActions.classList.remove('hidden');

    if (inviteTextEl) {
        inviteTextEl.textContent = '';
        const strong = document.createElement('strong');
        strong.textContent = pillName;
        inviteTextEl.appendChild(strong);
    }

    if (btnVer) {
        btnVer.onclick = () => window.openLatestPublishedPillFromProfile();
    }
}

let pillExperienceBound = false;
let pillExperienceEscapeHandler = null;

function getPillMediaLink(pill) {
    if (!pill || typeof pill !== 'object') return '';
    const raw = String(
        pill.link ||
            pill.videoUrl ||
            pill.videoLink ||
            pill.video_link ||
            pill.url ||
            ''
    ).trim();
    return safeHttpUrl(raw);
}

function getPillSealUrl(pill) {
    if (!pill || typeof pill !== 'object') return '';
    return safeHttpUrl(String(pill.seal_url || '').trim());
}

function getPillSealName(pill) {
    if (!pill || typeof pill !== 'object') return '';
    return String(pill.seal_name || '').trim();
}

function closePillExperienceDialog() {
    const overlay = document.getElementById('pill-experience-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.setAttribute('aria-hidden', 'true');
    }
    if (pillExperienceEscapeHandler) {
        document.removeEventListener('keydown', pillExperienceEscapeHandler);
        pillExperienceEscapeHandler = null;
    }
}

function bindPillExperienceOverlayOnce() {
    if (pillExperienceBound) return;
    const backdrop = document.getElementById('pill-experience-backdrop');
    const closeX = document.getElementById('pill-experience-btn-close-x');
    const dismiss = document.getElementById('pill-experience-btn-dismiss');
    if (!backdrop) return;
    pillExperienceBound = true;
    backdrop.addEventListener('click', closePillExperienceDialog);
    closeX?.addEventListener('click', closePillExperienceDialog);
    dismiss?.addEventListener('click', closePillExperienceDialog);
}

function openPillExperienceDialog(pill) {
    if (!pill) return;
    bindPillExperienceOverlayOnce();

    const overlay = document.getElementById('pill-experience-overlay');
    const titleEl = document.getElementById('pill-experience-title');
    const descEl = document.getElementById('pill-experience-desc');
    const btnVideo = document.getElementById('pill-experience-btn-video');
    const btnQuiz = document.getElementById('pill-experience-btn-quiz');

    if (!overlay || !titleEl || !descEl || !btnVideo || !btnQuiz) return;

    const name = String(pill.name || pill.id || T.common.pillFallback).trim();
    const mediaLink = getPillMediaLink(pill);
    const description = String(pill.description || '').trim();

    titleEl.textContent = name;
    descEl.textContent =
        description ||
        T.alerts.pillExperienceDefaultDesc;

    btnVideo.onclick = () => {
        if (mediaLink) {
            window.open(mediaLink, '_blank', 'noopener,noreferrer');
            return;
        }
        showAppAlert({
            title: T.alerts.pillVideoMissingTitle,
            message: T.alerts.pillVideoMissingMessage,
            variant: 'info',
            confirmText: T.common.understood
        });
    };

    btnQuiz.onclick = () => {
        closePillExperienceDialog();
        window.startPillsQuiz(pill.id);
    };

    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');

    pillExperienceEscapeHandler = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closePillExperienceDialog();
        }
    };
    document.addEventListener('keydown', pillExperienceEscapeHandler);

    setTimeout(() => btnVideo.focus(), 10);
}

window.openLatestPublishedPillFromProfile = function () {
    const p = getLatestPublishedPill();
    if (!p) {
        openModeFromProfile('pills');
        return;
    }
    openPillExperienceDialog(p);
};

function renderProfile() {
    // Basic Info
    document.getElementById('profile-avatar-img').src = userProfile.avatarUrl;
    document.getElementById('profile-nickname').innerText = userProfile.nickname || userName;
    const navImg = document.getElementById('nav-avatar-img');
    if (navImg && userProfile.avatarUrl) {
        navImg.src = userProfile.avatarUrl;
        navImg.onload = () => navImg.classList.add('is-loaded');
        navImg.onerror = () => navImg.classList.remove('is-loaded');
    }
    const seniorityBadge = document.getElementById('profile-seniority-badge');
    if (seniorityBadge) seniorityBadge.textContent = userProfile.seniority || '';
    const especialidadBadge = document.getElementById('profile-especialidad-badge');
    if (especialidadBadge) especialidadBadge.textContent = userProfile.especialidad || '';

    // Precargar el banco del formador para puestos con equipo a su cargo (Product Designer, Customer Success, Administrativo).
    if (canEvaluateFormador(userProfile.especialidad)) ensureFormadorLoaded();
    // Stats
    document.getElementById('profile-quest-pts').innerText = userProfile.questPoints;
    renderProfilePillsCard();
    const rankEl = document.getElementById('profile-practice-rank');
    if (rankEl) rankEl.innerText = T.profile.rankCalculating;
    renderSeals();
    renderProfileTalentsPreview();
    renderProfileTeam().catch((e) => debugWarn('renderProfileTeam:', e));
    setTimeout(initBannerCanvas, 0);
}

// ==========================================================================
// TEST MODE — previsualizar la app como otro perfil (solo allow-list).
// Sobre-escribe userProfile.especialidad + seniority y re-renderiza; no toca
// datos reales en Supabase. La selección persiste en sessionStorage para que
// el quiz/evaluación y una recarga usen el perfil simulado.
// ==========================================================================

const TEST_MODE_STORAGE_KEY = 'uix_test_mode_v1';

let testModeState = {
    active: false,
    especialidad: '',
    seniority: '',
    backup: null, // { especialidad, seniority } del perfil real
};

/** Opciones (especialidad + seniority) traídas en vivo de ranking_user; cacheadas por sesión. */
let testModeOptionsCache = null;

/** ¿Hay un perfil simulado activo? Usado para bloquear escrituras a Supabase (solo preview). */
function isTestModeActive() {
    return testModeState.active === true;
}

/** ¿El usuario actual puede ver/usar el Test Mode? */
function isTestModeAllowed() {
    const email = String(userEmail || '').trim().toLowerCase();
    if (!email) return false;
    return TEST_MODE_ALLOWED_EMAILS
        .map((e) => String(e).trim().toLowerCase())
        .includes(email);
}

/** Muestra/oculta el botón del header según la allow-list. */
function refreshTestModeButton() {
    const btn = document.getElementById('btn-test-mode');
    if (!btn) return;
    btn.classList.toggle('hidden', !isTestModeAllowed());
}

/**
 * Colapsa variantes de la misma especialidad de DISEÑO a una etiqueta canónica,
 * usando la misma clasificación que el matcher de evaluación (así 'UI DESIGN' y
 * 'Diseñador UI' se muestran como una sola entrada aunque en la base difieran).
 * Los puestos que NO son de diseño (CEO, HRBP, OPS, etc.) se mantienen tal cual,
 * cada uno como entrada distinta.
 */
function canonicalEspecialidad(raw) {
    const value = String(raw || '').trim();
    if (isUxUiDualSpecialty(value)) return { key: 'ux-ui', label: 'Diseñador UX UI' };
    if (isUxWritingSpecialty(value)) return { key: 'ux-writer', label: 'UX Writer' };
    if (isUxOnlySpecialty(value) || isUxResearchFamilyLabel(value)) return { key: 'ux', label: 'Diseñador UX' };
    if (isUiOnlySpecialty(value)) return { key: 'ui', label: 'Diseñador UI' };
    return { key: 'other:' + normalizeLabelKey(value), label: value };
}

/** Valores distintos de `especialidad` y `seniority` presentes hoy en ranking_user. */
async function loadTestModeOptions() {
    if (testModeOptionsCache) return testModeOptionsCache;
    const fallback = {
        especialidades: [
            'Diseñador UX UI', 'Diseñador UX', 'Diseñador UI',
            'Product Designer', 'Customer Success', 'UX Writer', 'OPS'
        ],
        seniorities: ['junior', 'medium', 'senior'],
        noSeniorityKeys: new Set(),
    };
    if (!supabase) return fallback;
    try {
        const { data, error } = await supabase
            .from('ranking_user')
            .select('especialidad, seniority');
        if (error) throw error;
        const espMap = new Map(); // key canónica -> etiqueta a mostrar (dedupe de variantes)
        const senSet = new Set();
        const hasSeniorityByKey = new Map(); // key canónica -> ¿algún registro con seniority?
        (data || []).forEach((r) => {
            const e = String(r.especialidad || '').trim();
            const s = String(r.seniority || '').trim();
            if (e) {
                const { key, label } = canonicalEspecialidad(e);
                if (!espMap.has(key)) espMap.set(key, label);
                if (s) hasSeniorityByKey.set(key, true);
                else if (!hasSeniorityByKey.has(key)) hasSeniorityByKey.set(key, false);
            }
            if (s) senSet.add(s);
        });
        // Puestos sin ningún seniority asignado: se bloqueará el selector en Test Mode.
        const noSeniorityKeys = new Set();
        for (const key of espMap.keys()) {
            if (!hasSeniorityByKey.get(key)) noSeniorityKeys.add(key);
        }
        const especialidades = [...espMap.values()].sort((a, b) => a.localeCompare(b, 'es'));
        const seniorities = [...senSet].sort((a, b) => a.localeCompare(b, 'es'));
        testModeOptionsCache = {
            especialidades: especialidades.length ? especialidades : fallback.especialidades,
            seniorities: seniorities.length ? seniorities : fallback.seniorities,
            noSeniorityKeys,
        };
        return testModeOptionsCache;
    } catch (e) {
        debugWarn('loadTestModeOptions error:', e);
        return fallback;
    }
}

/** Crea (una vez) el modal de selección de perfil simulado. */
function ensureTestModeModal() {
    if (document.getElementById('test-mode-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'test-mode-overlay';
    overlay.className = 'test-mode-overlay hidden';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
        <div class="test-mode-modal" role="dialog" aria-modal="true" aria-labelledby="test-mode-title">
            <div class="test-mode-modal__head">
                <span class="test-mode-modal__icon"><i class="fa-solid fa-flask" aria-hidden="true"></i></span>
                <h3 id="test-mode-title">Modo prueba</h3>
            </div>
            <p class="test-mode-modal__desc">Previsualiza la app como si tuvieras otro perfil: verás sus preguntas, secciones y evaluaciones. No cambia tu perfil real.</p>
            <label class="test-mode-field">
                <span>Especialidad</span>
                <select id="test-mode-especialidad"></select>
            </label>
            <label class="test-mode-field">
                <span>Seniority</span>
                <select id="test-mode-seniority"></select>
            </label>
            <div class="test-mode-modal__actions">
                <button type="button" class="btn-outline-blue" id="test-mode-cancel">Cancelar</button>
                <button type="button" class="btn-primary" id="test-mode-apply">Aplicar</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeTestModePanel();
    });
    document.getElementById('test-mode-cancel').onclick = closeTestModePanel;
    document.getElementById('test-mode-apply').onclick = () => {
        const esp = document.getElementById('test-mode-especialidad').value;
        const sen = document.getElementById('test-mode-seniority').value;
        closeTestModePanel();
        applyTestMode(esp, sen);
    };
}

/** Abre el panel con las opciones actuales seleccionadas. */
async function openTestModePanel() {
    if (!isTestModeAllowed()) return;
    ensureTestModeModal();
    const opts = await loadTestModeOptions();
    const espSel = document.getElementById('test-mode-especialidad');
    const senSel = document.getElementById('test-mode-seniority');
    const currentEsp = testModeState.active ? testModeState.especialidad : userProfile.especialidad;
    const currentSen = testModeState.active ? testModeState.seniority : userProfile.seniority;
    const buildOptions = (values, current) => values.map((v) => {
        const sel = normalizeLabelKey(v) === normalizeLabelKey(current) ? ' selected' : '';
        return `<option value="${esc(v)}"${sel}>${esc(v)}</option>`;
    }).join('');
    espSel.innerHTML = buildOptions(opts.especialidades, currentEsp);

    // Bloqueo del seniority para perfiles que no tienen seniority asignado en la base.
    const noSeniorityKeys = opts.noSeniorityKeys || new Set();
    let lastSeniority = String(currentSen || '').trim();
    const renderSenioritySelect = () => {
        const locked = noSeniorityKeys.has(canonicalEspecialidad(espSel.value).key);
        if (!locked) {
            senSel.innerHTML = buildOptions(opts.seniorities, lastSeniority || opts.seniorities[0]);
        } else {
            senSel.innerHTML = `<option value="" selected>— Sin seniority —</option>`;
        }
        senSel.disabled = locked;
        senSel.classList.toggle('is-locked', locked);
        senSel.title = locked ? 'Este perfil no maneja seniority' : '';
    };
    espSel.onchange = () => {
        if (!senSel.disabled && senSel.value) lastSeniority = senSel.value; // recordar antes de bloquear
        renderSenioritySelect();
    };
    renderSenioritySelect();

    const overlay = document.getElementById('test-mode-overlay');
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
}

function closeTestModePanel() {
    const overlay = document.getElementById('test-mode-overlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
}

/** Re-render del home + recarga del estado de formador tras cambiar el perfil (real o simulado). */
async function refreshAfterProfileChange() {
    userProfile.formadorDoneAt = null;
    if (canEvaluateFormador(userProfile.especialidad)) {
        try { await loadFormadorCompletion(); } catch (e) { debugWarn('loadFormadorCompletion:', e); }
    }
    try { renderProfile(); } catch (e) { debugWarn('renderProfile:', e); }
    try { updatePracticeRankUI(); } catch (e) { debugWarn('updatePracticeRankUI:', e); }
}

/** Aplica un perfil simulado (guarda backup del real la primera vez). */
async function applyTestMode(especialidad, seniority) {
    if (!isTestModeAllowed()) return;
    const esp = String(especialidad || '').trim();
    const sen = String(seniority || '').trim();
    if (!esp && !sen) return;
    if (!testModeState.active) {
        testModeState.backup = {
            especialidad: userProfile.especialidad,
            seniority: userProfile.seniority,
        };
    }
    testModeState.active = true;
    testModeState.especialidad = esp;
    testModeState.seniority = sen;
    userProfile.especialidad = esp;
    userProfile.seniority = sen;
    persistTestMode();
    renderTestModeIndicator();
    await refreshAfterProfileChange();
}

/** Restaura el perfil real y desactiva el modo prueba. */
async function exitTestMode() {
    if (!testModeState.active) return;
    if (testModeState.backup) {
        userProfile.especialidad = testModeState.backup.especialidad;
        userProfile.seniority = testModeState.backup.seniority;
    }
    testModeState.active = false;
    testModeState.especialidad = '';
    testModeState.seniority = '';
    testModeState.backup = null;
    clearPersistTestMode();
    renderTestModeIndicator();
    await refreshAfterProfileChange();
}

function persistTestMode() {
    try {
        sessionStorage.setItem(TEST_MODE_STORAGE_KEY, JSON.stringify({
            especialidad: testModeState.especialidad,
            seniority: testModeState.seniority,
            backup: testModeState.backup,
        }));
    } catch (_) { /* sessionStorage no disponible */ }
}

function clearPersistTestMode() {
    try { sessionStorage.removeItem(TEST_MODE_STORAGE_KEY); } catch (_) { /* ignore */ }
}

/** Banner fijo que indica el perfil simulado, con botones Cambiar / Salir. */
function renderTestModeIndicator() {
    let bar = document.getElementById('test-mode-indicator');
    if (!testModeState.active) {
        if (bar) bar.remove();
        document.body.classList.remove('test-mode-on');
        return;
    }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'test-mode-indicator';
        bar.className = 'test-mode-indicator';
        document.body.appendChild(bar);
    }
    document.body.classList.add('test-mode-on');
    const espLabel = testModeState.especialidad || '—';
    const senLabel = testModeState.seniority || '—';
    bar.innerHTML = `
        <span class="test-mode-indicator__dot" aria-hidden="true"></span>
        <span class="test-mode-indicator__label">Modo prueba · <strong>${esc(espLabel)}</strong> · ${esc(senLabel)}</span>
        <button type="button" class="test-mode-indicator__btn" id="test-mode-change">Cambiar</button>
        <button type="button" class="test-mode-indicator__btn test-mode-indicator__btn--exit" id="test-mode-exit">Salir</button>
    `;
    bar.querySelector('#test-mode-change').onclick = openTestModePanel;
    bar.querySelector('#test-mode-exit').onclick = exitTestMode;
}

/**
 * Inicializa el Test Mode tras cargar el perfil real. Si había un perfil simulado
 * guardado (recarga o navegación), lo re-aplica sobre userProfile ANTES del render.
 * Debe llamarse justo antes de renderProfile() en el flujo post-login.
 */
async function initTestMode() {
    refreshTestModeButton();
    if (!isTestModeAllowed()) {
        clearPersistTestMode();
        testModeState = { active: false, especialidad: '', seniority: '', backup: null };
        renderTestModeIndicator();
        return;
    }
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(TEST_MODE_STORAGE_KEY) || 'null'); } catch (_) { saved = null; }
    if (!saved || (!saved.especialidad && !saved.seniority)) return;

    testModeState.backup = saved.backup || {
        especialidad: userProfile.especialidad,
        seniority: userProfile.seniority,
    };
    testModeState.active = true;
    testModeState.especialidad = saved.especialidad || userProfile.especialidad;
    testModeState.seniority = saved.seniority || userProfile.seniority;
    userProfile.especialidad = testModeState.especialidad;
    userProfile.seniority = testModeState.seniority;
    renderTestModeIndicator();
    // Recarga estado de formador para el perfil simulado (el render lo hace quien llama).
    userProfile.formadorDoneAt = null;
    if (canEvaluateFormador(userProfile.especialidad)) {
        try { await loadFormadorCompletion(); } catch (e) { debugWarn('loadFormadorCompletion:', e); }
    }
}

/** Limpia el estado de Test Mode al cerrar sesión. */
function resetTestModeOnLogout() {
    testModeState = { active: false, especialidad: '', seniority: '', backup: null };
    testModeOptionsCache = null;
    clearPersistTestMode();
    renderTestModeIndicator();
    refreshTestModeButton();
}

function getTalentDescription(talent) {
    const stored = String(talent.description || '').trim();
    if (stored) return stored;

    const label = String(talent.name || T.common.skillFallback);
    return T.profile.talentDescriptionGeneric(label);
}

function toTitleSentenceCase(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function toTitleWordsCase(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    return normalized
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function createTalentDetailSection(parent, label, extraClass, collapsible = false) {
    const baseClass = `talent-detail-card__section${extraClass ? ` ${extraClass}` : ''}`;
    if (!collapsible) {
        const block = document.createElement('section');
        block.className = baseClass;

        const kicker = document.createElement('p');
        kicker.className = 'talent-detail-card__kicker';
        kicker.textContent = label;
        block.appendChild(kicker);

        parent.appendChild(block);
        return block;
    }

    const block = document.createElement('details');
    block.className = `${baseClass} talent-detail-card__section--collapsible`;

    const summary = document.createElement('summary');
    summary.className = 'talent-detail-card__kicker talent-detail-card__summary';
    summary.textContent = label;

    const content = document.createElement('div');
    content.className = 'talent-detail-card__section-content';

    block.appendChild(summary);
    block.appendChild(content);
    parent.appendChild(block);
    return content;
}

function appendTalentDetailTextSection(parent, label, text, extraClass, options = {}) {
    const { collapsible = false } = options;
    const trimmed = String(text || '').trim();
    if (!trimmed) return;

    const target = createTalentDetailSection(parent, label, extraClass, collapsible);

    const desc = document.createElement('p');
    desc.className = 'talent-detail-card__desc';
    desc.textContent = trimmed;

    target.appendChild(desc);
}

function appendTalentDetailListSection(parent, label, rawText, options = {}) {
    const { collapsible = false } = options;
    const lines = String(rawText || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length === 0) return;

    const target = createTalentDetailSection(parent, label, '', collapsible);

    const list = document.createElement('ul');
    list.className = 'talent-detail-card__list';
    lines.forEach((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        list.appendChild(li);
    });

    target.appendChild(list);
}

function appendTalentDetailSkillsSection(parent, label, rawText, options = {}) {
    const { collapsible = false } = options;
    const items = String(rawText || '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
    if (items.length === 0) return;

    const target = createTalentDetailSection(parent, label, 'talent-detail-card__section--skills', collapsible);

    const chips = document.createElement('div');
    chips.className = 'talent-detail-card__chips';
    chips.setAttribute('role', 'list');
    items.forEach((item) => {
        const chip = document.createElement('span');
        chip.className = 'talent-detail-card__chip';
        chip.setAttribute('role', 'listitem');
        chip.textContent = item;
        chips.appendChild(chip);
    });

    target.appendChild(chips);
}

function appendTalentVisual(parent, talent, label) {
    const imgSrc = safeTalentImageUrl(talent.imageUrl);
    if (imgSrc) {
        const img = document.createElement('img');
        img.className = 'talent-item__img';
        img.src = imgSrc;
        img.alt = label;
        img.loading = 'lazy';
        img.decoding = 'async';
        parent.appendChild(img);
        return;
    }

    const iconEl = document.createElement('i');
    iconEl.className = `fas ${safeIconClass(talent.icon)}`;
    iconEl.setAttribute('aria-hidden', 'true');
    parent.appendChild(iconEl);
}

function createTalentItemElement(talent) {
    const div = document.createElement('div');
    div.className = 'talent-item talent-item--badge';

    const label = String(talent.name || T.common.skillFallback);
    div.setAttribute('title', label);
    div.setAttribute('aria-label', label);

    appendTalentVisual(div, talent, label);

    const span = document.createElement('span');
    span.className = 'talent-item__name';
    span.textContent = label;
    div.appendChild(span);
    return div;
}

const TALENT_PEER_LIMIT = 9;
const TALENT_PEER_LIMIT_MOBILE = 5;

function getTalentPeerVisibleLimit() {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 767px)').matches) {
        return TALENT_PEER_LIMIT_MOBILE;
    }
    return TALENT_PEER_LIMIT;
}

/**
 * Devuelve compañeros que comparten el talento `habilidadId`.
 * Nombre: `ranking_user.nombre` por `user_id` (fuente principal).
 * Avatar: `user_profiles.avatar_url`.
 */
async function loadTalentPeers(habilidadId) {
    if (!supabase || !habilidadId) return [];
    const myUid = supabaseSession?.user?.id;

    try {
        const { data: rows, error } = await supabase
            .from('user_habilidades')
            .select('user_id, habilidad_id_1, habilidad_id_2, habilidad_id_3, habilidad_id_4, habilidad_id_5')
            .or(
                `habilidad_id_1.eq.${habilidadId},habilidad_id_2.eq.${habilidadId},habilidad_id_3.eq.${habilidadId},habilidad_id_4.eq.${habilidadId},habilidad_id_5.eq.${habilidadId}`
            );
        if (error) throw error;
        if (!rows || rows.length === 0) return [];

        const peerIds = [...new Set(
            rows
                .map((r) => String(r.user_id))
                .filter((id) => id && id !== String(myUid))
        )];

        if (peerIds.length === 0) return [];

        const [{ data: profiles, error: profilesErr }, { data: rankingRows, error: rankingErr }] = await Promise.all([
            supabase
                .from('user_profiles')
                .select('id, nickname, avatar_url')
                .in('id', peerIds),
            supabase
                .from('ranking_user')
                .select('user_id, nombre, nickname, foto_url')
                .in('user_id', peerIds),
        ]);

        if (profilesErr) debugWarn('loadTalentPeers user_profiles:', profilesErr);
        if (rankingErr) debugWarn('loadTalentPeers ranking_user:', rankingErr);

        const profileMap = new Map();
        (profiles || []).forEach((p) => {
            profileMap.set(String(p.id), {
                nickname: String(p.nickname || '').trim(),
                avatarUrl: p.avatar_url || '',
            });
        });

        const rankingMap = new Map();
        (rankingRows || []).forEach((r) => {
            const uid = String(r.user_id || '');
            if (!uid) return;
            rankingMap.set(uid, {
                nombre: String(r.nombre || '').trim(),
                nickname: String(r.nickname || '').trim(),
                fotoUrl: String(r.foto_url || '').trim(),
            });
        });

        return peerIds.map((uid) => {
            const profile = profileMap.get(uid) || {};
            const ranking = rankingMap.get(uid) || {};
            const name = ranking.nickname || profile.nickname || ranking.nombre || T.common.anonymous;
            return {
                uid,
                name,
                avatarUrl: profile.avatarUrl || ranking.fotoUrl || '',
            };
        });
    } catch (e) {
        debugWarn('loadTalentPeers error:', e);
        return [];
    }
}

/** Abre el modal con la lista completa de peers de un talento. */
window.openTalentPeersModal = function (talentName, peersJson) {
    const peers = JSON.parse(peersJson);
    const modal = document.getElementById('talent-peers-modal');
    if (!modal) return;

    document.getElementById('talent-peers-modal-title').textContent = talentName;
    const list = document.getElementById('talent-peers-modal-list');
    list.innerHTML = '';

    if (peers.length === 0) {
        list.innerHTML = `<p class="talent-peers-empty">Ningún otro UIXer comparte este talento todavía.</p>`;
    } else {
        peers.forEach((peer) => {
            const item = document.createElement('div');
            item.className = 'talent-peer-list-item';

            const avatar = buildPeerAvatarEl(peer, 'lg');
            const name = document.createElement('span');
            name.className = 'talent-peer-list-item__name';
            name.textContent = peer.name;

            item.appendChild(avatar);
            item.appendChild(name);
            list.appendChild(item);
        });
    }

    modal.classList.remove('hidden');
};

window.closeTalentPeersModal = function () {
    document.getElementById('talent-peers-modal')?.classList.add('hidden');
};

function _peerFirstName(fullName) {
    return String(fullName || '').trim().split(/\s+/)[0] || fullName || '?';
}

/** Avatar circular (sin tooltip; el wrap lo añade en el stack). */
function buildPeerAvatarInner(peer, size = 'sm') {
    if (peer.avatarUrl) {
        const img = document.createElement('img');
        img.className = `talent-peer-avatar talent-peer-avatar--${size}`;
        img.src = peer.avatarUrl;
        img.alt = peer.name;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.onerror = function () {
            const placeholder = buildPeerAvatarPlaceholderInner(peer, size);
            img.replaceWith(placeholder);
        };
        return img;
    }
    return buildPeerAvatarPlaceholderInner(peer, size);
}

function buildPeerAvatarPlaceholderInner(peer, size = 'sm') {
    const el = document.createElement('span');
    el.className = `talent-peer-avatar talent-peer-avatar--${size} talent-peer-avatar--placeholder`;
    el.textContent = String(peer.name || '?').charAt(0).toUpperCase();
    el.setAttribute('aria-label', peer.name);
    return el;
}

/**
 * En el stack: wrap con tooltip de primer nombre (los <img> no admiten ::after).
 * En el modal (lg): solo el avatar interior.
 */
function buildPeerAvatarEl(peer, size = 'sm') {
    const inner = buildPeerAvatarInner(peer, size);
    if (size !== 'sm') return inner;

    const firstName = _peerFirstName(peer.name);
    const wrap = document.createElement('span');
    wrap.className = 'talent-peer-avatar-wrap';
    wrap.setAttribute('data-firstname', firstName);
    wrap.setAttribute('aria-label', peer.name);
    wrap.appendChild(inner);
    return wrap;
}

/** Inyecta la sección de peers en una card ya construida (se llama después del await). */
function injectTalentPeersSection(card, talentName, peers) {
    const existing = card.querySelector('.talent-detail-card__peers');
    if (existing) existing.remove();

    const footer = document.createElement('footer');
    footer.className = 'talent-detail-card__peers';

    if (peers.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'talent-peers-empty talent-peers-empty--inline';
        empty.textContent = 'Aún ningún UIXer comparte este talento.';
        footer.appendChild(empty);
        card.appendChild(footer);
        return;
    }

    const kicker = document.createElement('p');
    kicker.className = 'talent-detail-card__kicker';
    kicker.textContent = 'Comparten este talento';
    footer.appendChild(kicker);

    const stack = document.createElement('div');
    stack.className = 'talent-peer-stack';

    const limit = getTalentPeerVisibleLimit();
    const visible = peers.slice(0, limit);
    const overflow = peers.slice(limit);

    visible.forEach((peer, index) => {
        const avatarWrap = buildPeerAvatarEl(peer, 'sm');
        avatarWrap.style.zIndex = String(index + 1);
        stack.appendChild(avatarWrap);
    });

    if (overflow.length > 0) {
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'talent-peer-avatar talent-peer-avatar--sm talent-peer-avatar--more';
        moreBtn.textContent = `+${overflow.length}`;
        moreBtn.style.zIndex = String(visible.length + 10);
        moreBtn.setAttribute('aria-label', `Ver todos: ${peers.length} compañeros`);
        moreBtn.addEventListener('click', () => window.openTalentPeersModal(talentName, JSON.stringify(peers)));
        stack.appendChild(moreBtn);
    }

    footer.appendChild(stack);
    card.appendChild(footer);
}

function createTalentDetailCardElement(talent) {
    const card = document.createElement('article');
    card.className = 'talent-detail-card';
    card.setAttribute('role', 'listitem');

    const label = String(talent.name || T.common.skillFallback);
    const displayLabel = toTitleSentenceCase(label);
    card.setAttribute('aria-label', displayLabel);

    const header = document.createElement('header');
    header.className = 'talent-detail-card__header';

    const visual = document.createElement('div');
    visual.className = 'talent-detail-card__visual';
    appendTalentVisual(visual, talent, label);

    const title = document.createElement('h3');
    title.className = 'talent-detail-card__title';
    title.textContent = displayLabel;

    header.appendChild(visual);
    header.appendChild(title);

    const body = document.createElement('div');
    body.className = 'talent-detail-card__body';

    appendTalentDetailSkillsSection(
        body,
        T.profile.talentSectionHabilidades,
        talent.habilidadesClave
    );
    appendTalentDetailTextSection(body, T.profile.talentDescriptionLabel, getTalentDescription(talent));
    appendTalentDetailTextSection(
        body,
        T.profile.talentSectionComoVives,
        talent.comoLoVives,
        '',
        { collapsible: true }
    );
    appendTalentDetailListSection(
        body,
        T.profile.talentSectionRecomendaciones,
        talent.recomendaciones,
        { collapsible: true }
    );
    appendTalentDetailTextSection(
        body,
        T.profile.talentSectionOjoCon,
        talent.ojoCon,
        'talent-detail-card__section--warning',
        { collapsible: true }
    );

    card.appendChild(header);
    card.appendChild(body);

    // Sección de peers con spinner mientras carga
    const peersPlaceholder = document.createElement('footer');
    peersPlaceholder.className = 'talent-detail-card__peers talent-detail-card__peers--loading';
    const spinner = document.createElement('i');
    spinner.className = 'fas fa-circle-notch animate-spin';
    spinner.setAttribute('aria-hidden', 'true');
    peersPlaceholder.appendChild(spinner);
    card.appendChild(peersPlaceholder);

    return card;
}

function renderProfileTalentsPreview() {
    const container = document.getElementById('profile-talents');
    const moreBtn = document.querySelector('.bento-talents-more-btn');
    if (!container) return;

    container.innerHTML = '';
    if (userProfile.talents.length === 0) {
        container.innerHTML = T.profile.talentsEmpty;
        if (moreBtn) moreBtn.classList.add('hidden');
        return;
    }

    if (moreBtn) moreBtn.classList.remove('hidden');
    userProfile.talents.forEach((talent) => {
        container.appendChild(createTalentItemElement(talent));
    });
}

function renderTalentsDetail() {
    const container = document.getElementById('talents-detail-grid');
    if (!container) return;

    container.innerHTML = '';
    if (userProfile.talents.length === 0) {
        container.innerHTML = T.profile.talentsEmpty;
        return;
    }

    userProfile.talents.forEach((talent) => {
        const card = createTalentDetailCardElement(talent);
        container.appendChild(card);

        // Carga de peers en background — no bloquea la apertura de la vista
        if (talent.habilidadId) {
            loadTalentPeers(talent.habilidadId).then((peers) => {
                injectTalentPeersSection(card, talent.name, peers);
            }).catch(() => {
                const placeholder = card.querySelector('.talent-detail-card__peers--loading');
                if (placeholder) placeholder.remove();
            });
        } else {
            const placeholder = card.querySelector('.talent-detail-card__peers--loading');
            if (placeholder) placeholder.remove();
        }
    });
}

window.openTalentsView = function () {
    const profileView = document.getElementById('profile-view');
    const talentsView = document.getElementById('talents-view');
    if (!profileView || !talentsView) return;

    const subtitle = talentsView.querySelector('.talents-view__subtitle');
    if (subtitle) subtitle.textContent = T.profile.talentsSubtitle;

    renderTalentsDetail();

    profileView.classList.add('animate-fade-out');
    setTimeout(() => {
        window.scrollTo(0, 0);
        profileView.classList.add('hidden');
        profileView.classList.remove('animate-fade-out');
        talentsView.classList.remove('hidden');
        talentsView.classList.add('animate-fade-in');
        window.setRoute('/talentos');
        updateHeaderBackButton();
    }, 280);
};

window.backFromTalentsView = function () {
    const profileView = document.getElementById('profile-view');
    const talentsView = document.getElementById('talents-view');
    if (!profileView || !talentsView) return;

    talentsView.classList.remove('animate-fade-in');
    talentsView.classList.add('animate-fade-out');
    setTimeout(() => {
        window.scrollTo(0, 0);
        talentsView.classList.add('hidden');
        talentsView.classList.remove('animate-fade-out');
        profileView.classList.remove('hidden');
        profileView.classList.add('animate-fade-in');
        window.setRoute('/');
        updateHeaderBackButton();
    }, 280);
};

async function updatePracticeRankUI() {
    const rankEl = document.getElementById('profile-practice-rank');
    if (!rankEl) return;
    if (!supabase || !userEmail) {
        rankEl.innerText = T.profile.rankUnavailable;
        return;
    }

    try {
        const myUid = supabaseSession?.user?.id;
        const { data: users, error } = await supabase
            .from('user_scores')
            .select('user_id, quest_points')
            .order('quest_points', { ascending: false });
        if (error) throw error;
        if (!users || users.length === 0) {
            rankEl.innerText = T.profile.rankEmpty;
            return;
        }

        const index = users.findIndex(u => myUid && String(u.user_id) === String(myUid));

        if (index === -1) {
            rankEl.innerText = T.profile.rankNoPosition;
            return;
        }

        rankEl.innerText = T.profile.rankPosition(index + 1);
    } catch (e) {
        rankEl.innerText = T.profile.rankLoadError;
    }
}


function renderSealsStepper(count) {
    const stepper = document.getElementById('seals-prize-stepper');
    if (!stepper) return;

    const GOAL   = 5;
    const total  = count ?? 0;
    const filled = Math.min(total, GOAL);

    stepper.querySelectorAll('.seals-prize-step').forEach((step, i) => {
        step.classList.toggle('filled', i < filled);
    });
    stepper.querySelectorAll('.seals-prize-connector').forEach((conn, i) => {
        conn.classList.toggle('filled', i + 1 < filled);
    });

    const countLabel = document.getElementById('seals-prize-count-label');
    if (countLabel) countLabel.textContent = `${total} / ${GOAL}`;

    const hint  = document.getElementById('seals-prize-hint');
    const ready = document.getElementById('seals-prize-ready');

    if (total >= GOAL) {
        if (hint)  hint.classList.add('hidden');
        if (ready) {
            ready.classList.remove('hidden');
            const readyCount = document.getElementById('seals-prize-ready-count');
            if (readyCount) readyCount.textContent = total;
        }
    } else {
        const missing = GOAL - total;
        if (hint) {
            hint.classList.remove('hidden');
            hint.textContent = missing === 1
                ? 'Te falta 1 sello para canjear tu premio'
                : `Te faltan ${missing} sellos para canjear tu premio`;
        }
        if (ready) ready.classList.add('hidden');
    }
}

function renderSeals() {
    const recentContainer = document.getElementById('profile-seals-recent');
    const yearSelector    = document.getElementById('seals-year-selector');
    const qSwitcher       = document.getElementById('seals-q-switcher');
    if (!recentContainer) return;

    const sortedSeals = [...userProfile.seals].sort((a, b) => new Date(b.date) - new Date(a.date));

    recentContainer.innerHTML = '';
    if (sortedSeals.length === 0) {
        if (yearSelector) yearSelector.innerHTML = '';
        if (qSwitcher) qSwitcher.querySelectorAll('.seals-q-btn').forEach(b => b.classList.remove('active'));
        recentContainer.innerHTML = `<p class="bento-seals-empty-q">${T.profile.sealsEmpty}</p>`;
        renderSealsStepper(0);
        return;
    }

    const availableYears = [...new Set(sortedSeals.map(s => getSealYear(s.date)))].sort((a, b) => b - a);
    const todayYear = new Date().getFullYear();

    if (sealsFilter.year === null || !availableYears.includes(sealsFilter.year)) {
        sealsFilter.year = availableYears.includes(todayYear) ? todayYear : availableYears[0];
    }

    const sealsInYear = sortedSeals.filter((s) => getSealYear(s.date) === sealsFilter.year);

    // Solo fijar trimestre por defecto si el usuario no eligió uno (p. ej. 1.ª carga o al cambiar de año).
    // No forzar de vuelta a un Q "con sellos" al pulsar Q2–Q4 vacíos: si no, nunca se ve el vacío.
    if (sealsFilter.q === null) {
        if (sealsFilter.year === todayYear) {
            // Año actual → mostrar el Q del calendario vigente (Q1=ene-mar, Q2=abr-jun, etc.)
            sealsFilter.q = `Q${Math.ceil((new Date().getMonth() + 1) / 3)}`;
        } else {
            const quartersInYear = [...new Set(sealsInYear.map((s) => effectiveSealQuarter(s)))].sort();
            sealsFilter.q = quartersInYear[0] || 'Q1';
        }
    }

    // --- year selector (solo si hay más de un año) ---
    if (yearSelector) {
        yearSelector.innerHTML = '';
        if (availableYears.length > 1) {
            availableYears.forEach(y => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `seals-year-btn${y === sealsFilter.year ? ' active' : ''}`;
                btn.textContent = y;
                btn.addEventListener('click', () => { sealsFilter.year = y; sealsFilter.q = null; renderSeals(); });
                yearSelector.appendChild(btn);
            });
        }
    }

    // --- Q switcher: marcar activo (data-q = 'Q1'…'Q4', alineado con pills.quarter) ---
    if (qSwitcher) {
        qSwitcher.querySelectorAll('.seals-q-btn').forEach(btn => {
            const q = btn.dataset.q;
            const isActive = q === sealsFilter.q;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            btn.onclick = () => { sealsFilter.q = q; renderSeals(); };
        });
    }

    const filtered = sortedSeals.filter((s) => {
        if (getSealYear(s.date) !== sealsFilter.year) return false;
        return effectiveSealQuarter(s) === sealsFilter.q;
    });

    // Cada sello acumulable (ej. Orador xN) cuenta como N sellos hacia el premio, no como 1.
    const sealTotal = filtered.reduce((sum, s) => sum + (Number(s.count) > 0 ? Number(s.count) : 1), 0);
    renderSealsStepper(sealTotal);

    if (filtered.length === 0) {
        const safeQ = esc(String(sealsFilter.q || ''));
        const safeYear = esc(String(sealsFilter.year || ''));
        recentContainer.innerHTML = typeof T.profile.sealsQuarterEmpty === 'function'
            ? T.profile.sealsQuarterEmpty(safeQ, safeYear)
            : `<p class="bento-seals-empty-q">Sin sellos en ${safeQ} ${safeYear}</p>`;
        return;
    }

    const appendSealVisual = (circleEl, seal) => {
        const imageUrl = safeHttpUrl(String(seal?.imageUrl || '').trim());
        if (imageUrl) {
            const img = document.createElement('img');
            img.className = 'bento-seal-image';
            img.src = imageUrl;
            img.alt = seal?.name || T.common.sealFallback;
            img.loading = 'lazy';
            img.decoding = 'async';
            circleEl.appendChild(img);
            return;
        }
        const icon = document.createElement('i');
        icon.className = `fas ${safeIconClass(seal?.icon)}`;
        circleEl.appendChild(icon);
    };

    filtered.forEach((seal) => {
        const div    = document.createElement('div');
        div.className = 'bento-seal-item';
        const circle = document.createElement('div');
        circle.className = 'bento-seal-circle';
        circle.title = seal.name;
        appendSealVisual(circle, seal);
        if (Number(seal?.count) > 1) {
            const countBadge = document.createElement('span');
            countBadge.className = 'bento-seal-count';
            countBadge.textContent = `×${seal.count}`;
            circle.appendChild(countBadge);
        }
        const nameSpan = document.createElement('span');
        nameSpan.className = 'bento-seal-name';
        nameSpan.textContent = seal.name;
        div.appendChild(circle);
        div.appendChild(nameSpan);
        recentContainer.appendChild(div);
    });
}

// ── Banner canvas: dot grid ───────────────────────────────────────────────
let _bannerCanvasStarted = false;
function initBannerCanvas() {
    if (_bannerCanvasStarted) return;
    const canvas = document.getElementById('banner-canvas');
    if (!canvas) return;
    _bannerCanvasStarted = true;

    const ctx = canvas.getContext('2d');
    let W, H, t = 0;

    function resize() {
        W = canvas.width  = canvas.offsetWidth  || 800;
        H = canvas.height = canvas.offsetHeight || 200;
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);
        const gap = 28;
        const cols = Math.ceil(W / gap) + 1;
        const rows = Math.ceil(H / gap) + 1;
        for (let col = 0; col < cols; col++) {
            for (let row = 0; row < rows; row++) {
                const x = col * gap;
                const y = row * gap;
                const dist = Math.sqrt((x - W / 2) ** 2 + (y - H / 2) ** 2);
                const wave  = Math.sin(dist * 0.04 - t * 0.04);
                const alpha = 0.08 + wave * 0.25;
                const r     = 1 + wave * 1.2;
                if (alpha > 0 && r > 0) {
                    ctx.beginPath();
                    ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(180,140,255,${Math.max(0, alpha)})`;
                    ctx.fill();
                }
            }
        }
        t++;
        requestAnimationFrame(draw);
    }

    resize();
    draw();

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas.parentElement || canvas);
}

window.toggleSealsAccordion = function() {
    const content = document.getElementById('seals-accordion-content');
    const icon = document.getElementById('seals-accordion-icon');
    const isOpen = content.classList.contains('open');

    if (isOpen) {
        content.classList.remove('open');
        icon.classList.remove('fa-chevron-up');
        icon.classList.add('fa-chevron-down');
    } else {
        content.classList.add('open');
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-up');
    }
}

window.handleAvatarUpload = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Security: Validate file type
    if (!file.type.startsWith('image/')) {
        event.target.value = '';
        return;
    }
    // Security: Limit file size to 2MB
    if (file.size > 2 * 1024 * 1024) {
        showAppAlert({ title: T.alerts.imageTooBigTitle, message: T.alerts.imageTooBigMessage, variant: "error", confirmText: T.common.understood });
        event.target.value = '';
        return;
    }

    // Local Preview
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('profile-avatar-img').src = e.target.result;
        userProfile.avatarUrl = e.target.result; // Update mock state

        // TODO: Upload to Supabase Storage
        // 1. await supabase.storage.from('avatars').upload(`${supabaseSession?.user?.id}`, file);
        // 2. const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(`${supabaseSession?.user?.id}`);
        // 3. Update user_profiles with new avatar_url
    }
    reader.readAsDataURL(file);
}

window.continueFromProfile = function() {
    // Flujo simplificado: acceso directo a Práctica sin pantalla intermedia de modos.
    window.openModeFromProfile('practice');
}

window.openModeFromProfile = function(mode) {
    const allowed = ['practice', 'evaluation', 'pills'];
    if (!allowed.includes(mode)) return;

    const profileView = document.getElementById('profile-view');
    const authCard = document.getElementById('auth-card');

    profileView.classList.add('animate-fade-out');
    setTimeout(() => {
        window.scrollTo(0, 0);
        profileView.classList.add('hidden');
        profileView.classList.remove('animate-fade-out');
        authCard.classList.add('hidden');
        window.selectMode(mode);
    }, 280);
}


function toggleCategory(card) {
    const cat = card.getAttribute('data-cat');
    if (activeCategories.has(cat)) {
        activeCategories.delete(cat);
        card.classList.remove('active');
    } else {
        activeCategories.add(cat);
        card.classList.add('active');
    }
    updatePoolCount();
}

function updatePoolCount() {
    const btnStart = document.getElementById('btn-start');

    if (activeCategories.size === 0) {
        btnStart.disabled = true;
        btnStart.classList.add('is-disabled');
    } else {
        btnStart.disabled = false;
        btnStart.classList.remove('is-disabled');
    }
}

/** Texto del campo Seniority/seniority en Supabase antes de normalizar (para match exacto de etiquetas). */
function getQuestionSeniorityRaw(question) {
    const directValue =
        question.seniority ||
        question.Seniority ||
        question.nivel ||
        question.Nivel ||
        question.level ||
        question.Level;

    if (directValue !== undefined && directValue !== null && String(directValue).trim() !== '') {
        return String(directValue).trim();
    }

    const keyAlias = new Set(['seniority', 'nivel', 'level']);
    for (const [key, value] of Object.entries(question || {})) {
        const normalizedKey = String(key || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z]/g, '');
        if (keyAlias.has(normalizedKey)) {
            const s = value === undefined || value === null ? '' : String(value).trim();
            if (s) return s;
        }
    }
    return '';
}

function normalize() {
    return rawData.map(q => {
        const correctKey = String(getQuestionField(q, ['Correcta', 'correcta']) || '').trim().toUpperCase();
        const optionA = getQuestionField(q, ['A', 'a']);
        const optionB = getQuestionField(q, ['B', 'b']);
        const optionC = getQuestionField(q, ['C', 'c']);

        // Mezclar opciones aleatoriamente
        const opts = [
            { text: optionA, correct: correctKey === "A" },
            { text: optionB, correct: correctKey === "B" },
            { text: optionC, correct: correctKey === "C" },
        ].filter(o => o.text).sort(() => Math.random() - 0.5);

        // Validación de seguridad: Verificar que existe una respuesta correcta
        if (opts.length > 0 && !opts.some(o => o.correct)) {
            if (DEBUG) {
                debugWarn("Pregunta sin respuesta correcta detectada:", getQuestionField(q, ['Q', 'q']));
            }
        }

        return {
            category: normalizeCategoryLabel(getQuestionField(q, ['Cat', 'cat'])),
            seniority: getQuestionSeniority(q),
            seniorityRaw: getQuestionSeniorityRaw(q),
            question: getQuestionField(q, ['Q', 'q']),
            options: opts,
            explanation: getQuestionField(q, ['Expl', 'expl']),
            studyTag: getQuestionField(q, ['Tag', 'tag'])
        };
    });
}

let emailVerified = false;

function validateEmailFormat() {
    // Si el usuario modifica el correo después de haber sido verificado, resetear estado
    if (emailVerified) {
        emailVerified = false;
        userEmail = '';
        const passInput = document.getElementById('user-password');
        if (passInput) { passInput.disabled = true; passInput.value = ''; }
        const btnLogin = document.getElementById('btn-do-login');
        if (btnLogin) btnLogin.disabled = true;
        const btnForgot = document.getElementById('btn-forgot-password');
        if (btnForgot) btnForgot.disabled = true;
        const btnEye = document.getElementById('btn-eye');
        if (btnEye) btnEye.disabled = true;
        const loginTitle = document.getElementById('login-title');
        if (loginTitle) loginTitle.textContent = T.auth.loginTitle;
        const emailStatus = document.getElementById('email-status');
        if (emailStatus) emailStatus.classList.remove('is-visible', 'is-success');
    }
}

function resetLoginEmailButtonState() {
    emailVerified = false;
    userEmail = '';
    const emailInput = document.getElementById('user-email');
    if (emailInput) emailInput.value = '';
    const passInput = document.getElementById('user-password');
    if (passInput) { passInput.disabled = true; passInput.value = ''; }
    const btnLogin = document.getElementById('btn-do-login');
    if (btnLogin) {
        btnLogin.innerHTML = T.auth.loginButton;
        btnLogin.disabled = true;
    }
    const btnForgot = document.getElementById('btn-forgot-password');
    if (btnForgot) btnForgot.disabled = true;
    const btnEye = document.getElementById('btn-eye');
    if (btnEye) btnEye.disabled = true;
    const loginTitle = document.getElementById('login-title');
    if (loginTitle) loginTitle.textContent = T.auth.loginTitle;
    const emailStatus = document.getElementById('email-status');
    if (emailStatus) emailStatus.classList.remove('is-visible', 'is-success');
}

function validatePasswordFormat() {
    const passInput = document.getElementById('user-password');
    const btnLogin = document.getElementById('btn-do-login');
    if (btnLogin) btnLogin.disabled = (passInput.value.length < 6);
}

// Verificación de correo al salir del campo (onblur)
async function verifyEmail() {
    const emailInput = document.getElementById('user-email');
    const emailStatus = document.getElementById('email-status');
    const email = emailInput.value.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email) || !supabase) return;
    if (emailVerified && userEmail === email) return; // ya verificado, sin cambios

    // Estado: validando
    emailInput.disabled = true;
    emailStatus.innerHTML = T.auth.emailValidating;
    emailStatus.classList.remove('is-success');
    emailStatus.classList.add('is-visible');

    try {
        const { data: rankingRow } = await supabase
            .from('ranking_user')
            .select('nombre, email')
            .eq('email', email)
            .maybeSingle();

        emailInput.disabled = false;

        if (!rankingRow) {
            userEmail = '';
            emailVerified = false;
            emailStatus.classList.remove('is-visible');
            showAppAlert({
                title: T.alerts.emailNotRegisteredTitle,
                message: T.alerts.emailNotRegisteredMessage(email),
                variant: 'error',
                confirmText: T.common.understood
            });
            return;
        }

        // Estado: verificado
        userEmail = email;
        emailVerified = true;
        emailStatus.innerHTML = T.auth.emailValidated;
        emailStatus.classList.add('is-success');

        const firstName = (rankingRow.nombre || '').split(' ')[0];
        document.getElementById('login-title').textContent = T.fmt.loginWelcome(firstName);

        document.getElementById('user-password').disabled = false;
        document.getElementById('btn-eye').disabled = false;
        document.getElementById('btn-forgot-password').disabled = false;
        document.getElementById('user-password').focus();

    } catch (e) {
        emailInput.disabled = false;
        emailStatus.classList.remove('is-visible');
        debugWarn('verifyEmail error:', e);
        showAppAlert({
            title: T.alerts.verifyConnectionTitle,
            message: T.alerts.verifyConnectionMessage,
            variant: 'error',
            confirmText: T.common.understood
        });
    }
}

function getResetPasswordAlert(error) {
    const rawMessage = String(error?.message || '').toLowerCase();
    const status = Number(error?.status || 0);

    if (status === 429 || rawMessage.includes('too many requests') || rawMessage.includes('rate limit')) {
        return {
            title: T.alerts.resetRateLimitTitle,
            message: T.alerts.resetRateLimitMessage,
            variant: 'warning',
        };
    }

    if (rawMessage.includes('redirect') || rawMessage.includes('redirect_to')) {
        return {
            title: T.alerts.resetRedirectTitle,
            message: T.alerts.resetRedirectMessage,
            variant: 'error',
        };
    }

    if (rawMessage.includes('user not found') || rawMessage.includes('email not found') || rawMessage.includes('invalid user')) {
        return {
            title: T.alerts.resetUserNotFoundTitle,
            message: T.alerts.resetUserNotFoundMessage,
            variant: 'error',
        };
    }

    if (status >= 500 || rawMessage.includes('smtp') || rawMessage.includes('provider') || rawMessage.includes('service unavailable')) {
        return {
            title: T.alerts.resetProviderErrorTitle,
            message: T.alerts.resetProviderErrorMessage,
            variant: 'error',
        };
    }

    if (error?.message) {
        return {
            title: T.alerts.resetErrorTitle,
            message: T.alerts.resetUnexpectedWithDetail(error.message),
            variant: 'error',
        };
    }

    return {
        title: T.alerts.resetErrorTitle,
        message: T.alerts.resetErrorMessage,
        variant: 'error',
    };
}

function getPasswordResetRedirectTo() {
    const host = window.location.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    const origin = isLocalHost ? PUBLIC_APP_ORIGIN : window.location.origin;
    return `${origin}${RESET_PASSWORD_PATH}`;
}

window.sendPasswordReset = async function () {
    if (!emailVerified || !userEmail || !supabase) return;

    const btn = document.getElementById('btn-forgot-password');
    const originalText = btn.textContent;
    btn.textContent = T.auth.forgotSending;
    btn.disabled = true;

    try {
        const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
            redirectTo: getPasswordResetRedirectTo()
        });

        if (error) {
            debugWarn('sendPasswordReset error:', error);
            const alert = getResetPasswordAlert(error);
            btn.textContent = originalText;
            btn.disabled = false;
            showAppAlert({
                title: alert.title,
                message: alert.message,
                variant: alert.variant,
                confirmText: T.common.close
            });
            return;
        }

        btn.textContent = T.auth.forgotSent;
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 5000);
        showAppAlert({
            title: T.alerts.resetCheckEmailTitle,
            message: T.alerts.resetCheckEmailMessage(userEmail),
            variant: 'success',
            confirmText: T.common.understood
        });
    } catch (e) {
        debugWarn('sendPasswordReset unexpected error:', e);
        btn.textContent = originalText;
        btn.disabled = false;
        showAppAlert({
            title: T.alerts.resetErrorTitle,
            message: T.alerts.resetErrorMessage,
            variant: 'error',
            confirmText: T.common.close
        });
    }
};

// PASO 2: Login con contraseña
async function doLogin() {
    const passInput = document.getElementById('user-password');
    const btnLogin = document.getElementById('btn-do-login');
    const password = passInput.value.trim();

    if (!userEmail || !supabase) return;

    if (Date.now() < _loginGuard.blockedUntil) {
        const waitSec = Math.ceil((_loginGuard.blockedUntil - Date.now()) / 1000);
        showAppAlert({
            title: T.alerts.tooManyAttemptsTitle,
            message: T.alerts.tooManyAttemptsMessage(waitSec),
            variant: "warning",
            confirmText: T.common.understood
        });
        return;
    }

    btnLogin.innerHTML = T.auth.loginButtonSpinner;
    btnLogin.disabled = true;

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: userEmail,
            password: password
        });

        if (error) {
            _loginGuard.count++;
            if (_loginGuard.count >= LOGIN_MAX_ATTEMPTS) {
                _loginGuard.blockedUntil = Date.now() + LOGIN_COOLDOWN_MS;
                _loginGuard.count = 0;
            }
            btnLogin.innerHTML = T.auth.loginButton;
            btnLogin.disabled = false;
            showAppAlert({
                title: T.alerts.loginInvalidTitle,
                message: T.alerts.loginInvalidMessage,
                variant: "error",
                confirmText: T.common.understood
            });
            return;
        }

        _loginGuard.count = 0;

        supabaseSession = data.session;
        const user = data.user;
        const role = user.app_metadata?.role || 'user';

        // Obtener nombre e initial_password desde ranking_user en una sola consulta
        const { data: rankingRow } = await supabase
            .from('ranking_user')
            .select('nombre, initial_password')
            .eq('email', userEmail)
            .maybeSingle();

        userName = rankingRow?.nombre || user.user_metadata?.nombre || (role === 'admin' ? 'Administrador' : 'Usuario');

        // Detectar primer login:
        //   1) Bandera en app_metadata (usuarios creados desde admin con flag explícito)
        //   2) O la contraseña usada coincide con initial_password en ranking_user (usuarios legacy)
        const forceByMetadata = user.app_metadata?.force_password_change === true;
        const initialPass = String(rankingRow?.initial_password || '').trim();
        const forceByInitialPass = initialPass.length > 0 && password === initialPass;

        if (forceByMetadata || forceByInitialPass) {
            promptChangePassword(user.id, password, role);
            return;
        }

        try {
            await showDashboard(userName);
        } catch (dashErr) {
            debugWarn('showDashboard error:', dashErr);
            btnLogin.innerHTML = T.auth.loginButton;
            btnLogin.disabled = false;
            showAppAlert({
                title: T.alerts.profileLoadErrorTitle,
                message: T.alerts.profileLoadErrorMessage,
                variant: "error",
                confirmText: T.common.understood
            });
        }

    } catch (e) {
        debugWarn('doLogin error:', e);
        btnLogin.innerHTML = T.auth.loginButton;
        btnLogin.disabled = false;
        showAppAlert({
            title: T.common.error,
            message: T.alerts.loginFailedMessage,
            variant: "error",
            confirmText: T.common.understood
        });
    }
}

window.togglePasswordVisibility = function () {
    const passInput = document.getElementById('user-password');
    const icon = document.getElementById('eye-icon');
    if (passInput.type === 'password') {
        passInput.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        passInput.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}


// --- LÓGICA DE CAMBIO DE CONTRASEÑA ---
let pendingUserDocId = null;
let currentOldPassword = null;
let pendingUserCollection = "ranking_user";

function getChangePasswordPrimaryButtonLabel() {
    return isPasswordRecoveryFlow ? T.auth.recoverySavePasswordBtn : T.auth.savePasswordBtn;
}

function setChangePasswordModalCopy(isRecovery) {
    const modal = document.getElementById('change-password-modal');
    if (!modal) return;
    const titleEl = document.getElementById('change-pass-title') || modal.querySelector('.modal-title--center');
    const descEl = document.getElementById('change-pass-desc') || modal.querySelector('.modal-desc');
    const saveBtn = document.getElementById('btn-save-pass');
    if (titleEl) titleEl.textContent = isRecovery ? T.auth.recoveryModalTitle : T.auth.firstLoginModalTitle;
    if (descEl) descEl.textContent = isRecovery ? T.auth.recoveryModalDesc : T.auth.firstLoginModalDesc;
    if (saveBtn) saveBtn.innerHTML = getChangePasswordPrimaryButtonLabel();
}

/**
 * Abre el modal de nueva contraseña en contexto de recuperación (desde link de correo).
 * A diferencia de promptChangePassword, no valida contra contraseña anterior ni exige userId.
 */
function openRecoveryModal() {
    isPasswordRecoveryFlow = true;
    currentOldPassword = null;
    history.replaceState({}, document.title, RESET_PASSWORD_PATH);
    setChangePasswordModalCopy(true);
    const p1 = document.getElementById('new-pass-1');
    const p2 = document.getElementById('new-pass-2');
    const err = document.getElementById('pass-error-msg');
    if (p1) p1.value = '';
    if (p2) p2.value = '';
    if (err) { err.innerText = ''; err.classList.add('hidden'); }
    document.getElementById('auth-card')?.classList.add('hidden');
    document.getElementById('recovery-confirm-modal')?.classList.add('hidden');
    document.getElementById('change-password-modal')?.classList.remove('hidden');
}

function promptChangePassword(docId, oldPass, collectionName = "ranking_user") {
    pendingUserDocId = docId;
    currentOldPassword = oldPass;
    pendingUserCollection = collectionName;
    isPasswordRecoveryFlow = false;
    setChangePasswordModalCopy(false);
    const p1 = document.getElementById('new-pass-1');
    const p2 = document.getElementById('new-pass-2');
    const err = document.getElementById('pass-error-msg');
    if (p1) p1.value = '';
    if (p2) p2.value = '';
    if (err) {
        err.innerText = '';
        err.classList.add('hidden');
    }
    document.getElementById('auth-card').classList.add('hidden');
    document.getElementById('change-password-modal').classList.remove('hidden');
}

window.toggleModalPassword = function (inputId, btn) {
    const input = document.getElementById(inputId);
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

window.saveNewPassword = async function () {
    const p1 = document.getElementById('new-pass-1').value;
    const p2 = document.getElementById('new-pass-2').value;
    const err = document.getElementById('pass-error-msg');
    const btn = document.getElementById('btn-save-pass');

    if (p1.length < 8) {
        err.innerText = T.auth.passwordMinError;
        err.classList.remove('hidden');
        return;
    }
    if (p1 !== p2) {
        err.innerText = T.auth.passwordMismatch;
        err.classList.remove('hidden');
        return;
    }
    // Solo validar contra contraseña anterior en flujo de primer-login (no recovery)
    if (!isPasswordRecoveryFlow && p1 === currentOldPassword) {
        err.innerText = T.auth.passwordSameAsOld;
        err.classList.remove('hidden');
        return;
    }

    err.classList.add('hidden');
    btn.innerHTML = T.auth.savePasswordSpinner;
    btn.disabled = true;

    try {
        // Verificar que existe sesión activa antes de llamar a updateUser
        const { data: authData } = await supabase.auth.getUser();
        if (!authData?.user) throw new Error('no_active_session');

        const { error } = await supabase.auth.updateUser({ password: p1 });
        if (error) throw error;

        if (isPasswordRecoveryFlow) {
            // --- Flujo recovery: cerrar sesión y regresar al login ---
            isPasswordRecoveryFlow = false;
            await showAppAlert({
                title: T.auth.recoverySuccessTitle,
                message: T.auth.recoverySuccessMessage,
                variant: 'success',
                confirmText: T.common.understood,
            });
            document.getElementById('change-password-modal').classList.add('hidden');
            // Cerrar sesión para que el usuario haga login limpio con la nueva contraseña
            await supabase.auth.signOut();
            // Restaurar pantalla de login
            const emailInput = document.getElementById('user-email');
            if (emailInput) emailInput.value = '';
            document.getElementById('email-status')?.classList.remove('is-visible');
            document.getElementById('user-password')?.setAttribute('disabled', '');
            document.getElementById('btn-eye')?.setAttribute('disabled', '');
            document.getElementById('btn-forgot-password')?.setAttribute('disabled', '');
            document.getElementById('auth-card')?.classList.remove('hidden');
            history.replaceState({}, document.title, '/');
        } else {
            // --- Flujo primer-login: limpiar initial_password y entrar al dashboard ---
            if (userEmail) {
                await supabase
                    .from('ranking_user')
                    .update({ initial_password: null })
                    .eq('email', userEmail.toLowerCase());
            }
            await showAppAlert({
                title: T.auth.passwordCreatedTitle,
                message: T.auth.passwordCreatedMessage,
                variant: 'success',
                confirmText: T.common.continue,
            });
            document.getElementById('change-password-modal').classList.add('hidden');
            currentOldPassword = null;
            pendingUserDocId = null;
            pendingUserCollection = "ranking_user";
            showDashboard(userName);
        }

    } catch (e) {
        err.innerText = T.auth.savePasswordError;
        err.classList.remove('hidden');
        btn.innerHTML = getChangePasswordPrimaryButtonLabel();
        btn.disabled = false;
    }
}

async function showDashboard(name) {
    const loginView = document.getElementById('login-view');
    const profileView = document.getElementById('profile-view');

    const firstName = (name || 'Usuario').split(' ')[0];
    document.getElementById('nav-greeting').innerText = T.fmt.navGreeting(firstName);

    const avatarInitial = document.querySelector('.nav-avatar-initial');
    if (avatarInitial) avatarInitial.textContent = firstName.charAt(0).toUpperCase();

    const userId = supabaseSession?.user?.id;
    userProfile.nickname = firstName;

    beginGlobalLoading(T.common.loadingProfile);
    try {
        // Carga de datos: errores aislados para no romper la transición
        if (userId) {
            try { await loadAllUserData(userId); } catch (e) { debugWarn('loadAllUserData:', e); }
        }
        if (pillsCatalog.length === 0) {
            try { await loadPillsCatalog(); } catch (e) { debugWarn('loadPillsCatalog:', e); }
        }
        if (!userProfile.nickname) userProfile.nickname = firstName;

        // Actualizar greeting y avatar con el display name final (nickname o primer nombre)
        document.getElementById('nav-greeting').innerText = T.fmt.navGreeting(userProfile.nickname);
        if (avatarInitial) avatarInitial.textContent = userProfile.nickname.charAt(0).toUpperCase();

        try { await initTestMode(); } catch (e) { debugWarn('initTestMode:', e); }
        try { renderProfile(); } catch (e) { debugWarn('renderProfile:', e); }
        try { updatePracticeRankUI(); } catch (e) { debugWarn('updatePracticeRankUI:', e); }

        document.getElementById('main-header').classList.remove('hidden');

        loginView.classList.add('animate-fade-out');
        setTimeout(() => {
            loginView.classList.add('hidden');
            loginView.classList.remove('animate-fade-out');
            document.getElementById('auth-card').classList.add('hidden');
            profileView.classList.remove('hidden');
            profileView.classList.add('animate-fade-in');
            updateHeaderBackButton();
            endGlobalLoading();
        }, 280);
    } catch (_) {
        endGlobalLoading();
        throw _;
    }
}

window.logout = async function () {
    const confirmed = await showAppConfirm({
        title: '¿Cerrar sesión?',
        message: 'Si estás en medio de una sesión, perderás el progreso actual.',
    });
    if (!confirmed) {
        return;
    }
    isEvaluationSessionActive = false;
    if (supabase) supabase.auth.signOut();
    supabaseSession = null;
    sessionRestoreHandled = false;

    // Clear sensitive session data from memory
    userName = "";
    userEmail = "";
    currentOldPassword = null;
    pendingUserDocId = null;
    errors = [];
    currentSession = [];
    questions = [];
    userProfile = {
        avatarUrl: MATERIAL.favicon,
        nickname: '',
        seniority: '',
        especialidad: '',
        formador: '',
        questPoints: 0,
        testsPoints: 0,
        pillsPoints: 0,
        latestPillRankId: '',
        pillScores: {},
        seals: [],
        talents: []
    };
    hideProfileTeamCard();
    resetTestModeOnLogout();

    const loginView = document.getElementById('login-view');
    const modeView = document.getElementById('mode-selection-view');
    const profileView = document.getElementById('profile-view');

    modeView.classList.remove('animate-fade-in');
    modeView.classList.add('animate-fade-out');
    
    profileView.classList.remove('animate-fade-in');
    profileView.classList.add('animate-fade-out');

    setTimeout(() => {
        modeView.classList.add('hidden');
        modeView.classList.remove('animate-fade-out');
        
        profileView.classList.add('hidden');
        profileView.classList.remove('animate-fade-out');
        document.getElementById('talents-view')?.classList.add('hidden');

        resetLoginEmailButtonState();

        // Hide Navbar
        document.getElementById('main-header').classList.add('hidden');

        // Make sure auth-card is visible since we are inside it
        document.getElementById('auth-card').classList.remove('hidden');
        
        loginView.classList.remove('hidden');
        loginView.classList.add('animate-fade-in');
    }, 280);
}

const MILO_URL = 'https://milo-two-nu.vercel.app'; // local: http://localhost:5173

window.openMilo = function () {
    const modal = document.getElementById('milo-modal');
    const iframe = document.getElementById('milo-iframe');

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    iframe.src = MILO_URL + '/';

    iframe.addEventListener('load', async function onLoad() {
        iframe.removeEventListener('load', onLoad);
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            iframe.contentWindow.postMessage(
                {
                    type: 'SUPABASE_SESSION',
                    access_token: session.access_token,
                    refresh_token: session.refresh_token,
                },
                MILO_URL
            );
            iframe.contentWindow.postMessage(
                {
                    type: 'MILO_USER',
                    email: userEmail,
                    nombre: userName,
                    emp_id: userProfile.empId,
                    proyectos: userProfile.proyectos,
                    seniority: userProfile.seniority,
                    especialidad: userProfile.especialidad,
                },
                MILO_URL
            );
        }
    });
};

window.closeMilo = function () {
    const modal = document.getElementById('milo-modal');
    const iframe = document.getElementById('milo-iframe');
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    iframe.src = '';
};

window.selectMode = async function (mode) {
    if (mode === 'practice' || mode === 'evaluation' || mode === 'pills') {
        currentQuizMode = mode;

        const shouldLoad =
            (mode === 'practice' && practiceData.length === 0) ||
            (mode === 'evaluation' && evaluationData.length === 0) ||
            (mode === 'pills' && pillsCatalog.length === 0);

        if (shouldLoad) {
            beginGlobalLoading(T.common.preparingContent);
            try {
                if (mode === 'practice') {
                    await loadPracticeQuestions();
                } else if (mode === 'evaluation') {
                    await loadEvaluationQuestions();
                } else {
                    await loadPillsCatalog();
                }
            } finally {
                endGlobalLoading();
            }
        }

        rawData = getModeQuestionPool(currentQuizMode);
        updateTimerVisibility();
        updatePoolCount();

        const modeView = document.getElementById('mode-selection-view');
        const dashboardView = document.getElementById('dashboard-view');
        const evalBriefView = document.getElementById('evaluation-brief-view');
        const pillsConstructionView = document.getElementById('pills-construction-view');

        const dashboardTitle = document.getElementById('dashboard-title');
        if (dashboardTitle) {
            if (mode === 'evaluation') dashboardTitle.textContent = T.dashboard.modeEvaluation;
            else if (mode === 'pills') dashboardTitle.textContent = T.dashboard.modePills;
            else dashboardTitle.textContent = T.dashboard.modePractice;
        }

        modeView.classList.add('animate-fade-out');
        setTimeout(() => {
            window.scrollTo(0, 0);
            modeView.classList.add('hidden');
            modeView.classList.remove('animate-fade-out');

            dashboardView.classList.add('hidden');
            evalBriefView?.classList.add('hidden');
            pillsConstructionView?.classList.add('hidden');

            if (mode === 'evaluation') {
                evalBriefView?.classList.remove('hidden');
                evalBriefView?.classList.add('animate-fade-in');
                updateEvaluationBriefAutoUI();
                renderEvaluationBriefSplit();
                window.setRoute('/evaluaciones');
            } else if (mode === 'pills') {
                pillsConstructionView?.classList.remove('hidden');
                pillsConstructionView?.classList.add('animate-fade-in');
                renderPillsList();
                window.setRoute('/pills');
            } else {
                dashboardView.classList.remove('hidden');
                dashboardView.classList.add('animate-fade-in');
                window.trackScreen('screen-category-selection');
                window.setRoute('/pruebas');
            }
            updateHeaderBackButton();
        }, 280);
    }
}

window.backToModes = function () {
    // Regresar directo al Home del usuario (perfil), sin pantalla de selección de modos.
    returnToDashboard();
}

window.startEvaluationSession = function () {
    startQuiz();
}

// ─── EVALUACIÓN 360 AL FORMADOR / EQUIPO (banco_evaluar_formador) ───────────
// Flujo propio: rúbrica sin respuesta correcta, sin timer, sin puntaje.
// Solo registra las respuestas del usuario en respuestas_evaluar_formador.
let formadorData = [];
let formadorBlocks = [];        // [{ modality, questions:[...] }] pendientes en esta corrida
let formadorBlockIdx = 0;       // bloque (modalidad) actual
let formadorQIdx = 0;           // pregunta actual dentro del bloque
let formadorBlockAnswers = [];  // respuestas del bloque actual (se guardan al terminar el bloque)
let formadorTestAnswers = [];   // acumulado en memoria (radar en Test Mode)
let formadorContext = null;     // { ownBucket, formadorBucket, teamBuckets:Set } resuelto por perfil
let formadorCompletedMods = new Set(); // modalidades ya guardadas (de la BD) → para reanudar
let formadorRadarData = {};     // { modalidad: [{comp, avg, n}] } para el gráfico
// Modalidad = tipo_evaluacion. Orden de los 3 bloques de la corrida.
const FORMADOR_MODALITY_ORDER = ['Autoevaluación', 'Evaluación al formador', 'Evaluación a mi equipo'];
const FORMADOR_RANDOM_PER_PICO = 5; // Preguntas por comportamiento (pico) cuando NO tiene obligatorias.
// Picos del radar (comportamientos) y escala de nivel.
const FORMADOR_PICOS = ['Confianza y respeto mutuo', 'Ejecución impecable', 'Mejora continua', 'Pasión por el Cliente', 'Trabajo en equipo'];
const FORMADOR_LEVEL_VALUE = { 'en desarrollo': 1, 'satisfactorio': 2, 'avanzado': 3, 'experto': 4 };
const FORMADOR_LEVEL_LABEL = ['', 'En desarrollo', 'Satisfactorio', 'Avanzado', 'Experto'];
const FORMADOR_RADAR_LABEL = { 'Autoevaluación': 'Yo', 'Evaluación al formador': 'Mi formador', 'Evaluación a mi equipo': 'Mi equipo' };

async function loadFormadorQuestions() {
    if (!supabase) return;
    try {
        const { data, error } = await supabase
            .from('banco_evaluar_formador')
            .select('*')
            .eq('active', true);
        if (error) throw error;
        formadorData = data || [];
    } catch (e) {
        debugError('Error al cargar banco_evaluar_formador:', e);
    }
}

async function ensureFormadorLoaded() {
    if (formadorData.length === 0) await loadFormadorQuestions();
}

/** Bucket común para cruzar ranking_user.especialidad con puesto_1..6. */
function formadorRoleBucket(raw) {
    const n = normalizeLabelKey(raw);
    if (!n) return '';
    if (n.includes('product designer')) return 'product';
    if (n.includes('customer success')) return 'customer';
    const t = specialtyTokens(raw);
    if (t.includes('writer') || t.includes('writing')) return 'writer';
    const hasUx = t.includes('ux');
    const hasUi = t.includes('ui');
    if (hasUx && hasUi) return 'dual';
    if (hasUi) return 'ui';
    if (hasUx) return 'ux';
    return '';
}

/** Normaliza un nombre de persona para emparejar (mayúsculas, sin acentos, espacios colapsados). */
function normalizePersonName(raw) {
    return String(raw || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/\s+/g, ' ').trim();
}

/** ¿La pregunta aplica a alguno de los buckets dados? (cualquier puesto_1..6) */
function formadorQuestionMatchesBuckets(row, buckets) {
    if (!buckets || !buckets.size) return false;
    for (let i = 1; i <= 6; i++) {
        const b = formadorRoleBucket(row[`puesto_${i}`]);
        if (b && buckets.has(b)) return true;
    }
    return false;
}

/** ¿La pregunta tiene parámetro de evaluación (nivel real, no vacío ni NA)? */
function formadorHasNivel(row) {
    return ['nivel_a', 'nivel_b', 'nivel_c', 'nivel_d']
        .some(k => {
            const v = String(row[k] || '').trim().toUpperCase();
            return v && v !== 'NA';
        });
}

/** Obligatorias (siempre se incluyen): «Conocimientos y Habilidades Técnicas» o «sin parámetro» (Solo Admin / sin nivel). */
function isFormadorObligatoria(row) {
    if (String(row.competencia || '').trim() === 'Conocimientos y Habilidades Técnicas') return true;
    return !formadorHasNivel(row);
}

/**
 * Resuelve los buckets de puesto por modalidad (puesto = persona EVALUADA):
 *  - Autoevaluación → tu propio puesto.
 *  - Evaluación al formador → el puesto de tu formador.
 *  - Evaluación a mi equipo → los puestos de las personas cuyo `formador` eres tú.
 */
async function ensureFormadorContext() {
    if (formadorContext) return formadorContext;
    const ctx = { ownBucket: '', formadorBucket: '', teamBuckets: new Set() };
    ctx.ownBucket = formadorRoleBucket(userProfile.especialidad);

    if (supabase) {
        try {
            const { data } = await supabase
                .from('ranking_user')
                .select('nombre, especialidad, formador');
            const rows = data || [];
            const myName = normalizePersonName(userProfile.nombre);
            const myFormador = normalizePersonName(userProfile.formador);
            rows.forEach(r => {
                const nombre = normalizePersonName(r.nombre);
                // Mi formador → su puesto (para "al formador").
                if (myFormador && nombre === myFormador) {
                    const b = formadorRoleBucket(r.especialidad);
                    if (b) ctx.formadorBucket = b;
                }
                // Personas cuyo formador soy yo → su puesto (para "a mi equipo").
                if (myName && normalizePersonName(r.formador) === myName) {
                    const b = formadorRoleBucket(r.especialidad);
                    if (b) ctx.teamBuckets.add(b);
                }
            });
        } catch (e) {
            debugWarn('ensureFormadorContext error:', e);
        }
    }
    formadorContext = ctx;
    return ctx;
}

/** Buckets de puesto que aplican a una modalidad según el perfil. */
function formadorBucketsForModality(modality, ctx) {
    if (modality === 'Autoevaluación') return ctx.ownBucket ? new Set([ctx.ownBucket]) : new Set();
    if (modality === 'Evaluación al formador') return ctx.formadorBucket ? new Set([ctx.formadorBucket]) : new Set();
    if (modality === 'Evaluación a mi equipo') return new Set(ctx.teamBuckets);
    return new Set();
}

/**
 * Arma los BLOQUES pendientes (uno por modalidad NO completada). Por cada comportamiento (pico):
 *  - si tiene obligatorias → TODAS sus obligatorias,
 *  - si no → FORMADOR_RANDOM_PER_PICO aleatorias.
 */
async function buildFormadorBlocks() {
    const ctx = await ensureFormadorContext();
    const blocks = [];

    FORMADOR_MODALITY_ORDER.forEach(modality => {
        if (formadorCompletedMods.has(modality)) return; // ya contestada → reanudar sin repetir
        const buckets = formadorBucketsForModality(modality, ctx);
        if (!buckets.size) return; // sin puesto aplicable → se salta el bloque

        const pool = formadorData.filter(r =>
            String(r.tipo_evaluacion || '').trim() === modality &&
            formadorQuestionMatchesBuckets(r, buckets)
        );
        if (!pool.length) return;

        // Agrupar por comportamiento (pico).
        const byPico = new Map();
        pool.forEach(r => {
            const key = String(r.comportamiento || '').trim() || '—';
            if (!byPico.has(key)) byPico.set(key, []);
            byPico.get(key).push(r);
        });

        const questions = [];
        byPico.forEach(rows => {
            const oblig = rows.filter(isFormadorObligatoria);
            if (oblig.length) questions.push(...oblig);
            else questions.push(...shuffleArray(rows).slice(0, FORMADOR_RANDOM_PER_PICO));
        });
        if (questions.length) blocks.push({ modality, questions });
    });

    return blocks;
}

/** Modalidades ya contestadas (para reanudar). En Test Mode no hay persistencia. */
async function loadFormadorCompletedModalities() {
    formadorCompletedMods = new Set();
    if (isTestModeActive()) return;
    const userId = supabaseSession?.user?.id;
    if (!supabase || !userId) return;
    try {
        const { data } = await supabase
            .from('respuestas_evaluar_formador')
            .select('tipo_evaluacion')
            .eq('user_id', userId);
        (data || []).forEach(r => {
            const t = String(r.tipo_evaluacion || '').trim();
            if (t) formadorCompletedMods.add(t);
        });
    } catch (e) {
        debugWarn('loadFormadorCompletedModalities error:', e);
    }
}

/**
 * Estado para el brief:
 *  'empty'   → puede por rol pero no hay preguntas para su puesto,
 *  'none'    → no ha empezado,
 *  'partial' → tiene etapas contestadas y otras pendientes,
 *  'done'    → contestó todas las modalidades aplicables.
 */
async function getFormadorBriefStatus() {
    await ensureFormadorLoaded();
    formadorContext = null;
    await loadFormadorCompletedModalities();
    const pending = await buildFormadorBlocks();
    const done = formadorCompletedMods.size;
    if (!pending.length && !done) return 'empty';
    if (!pending.length) return 'done';
    if (done) return 'partial';
    return 'none';
}

/** Botón del brief: reanuda lo pendiente, o muestra el radar si ya terminó todo. */
window.startFormadorEvaluation = async function () {
    await ensureFormadorLoaded();
    formadorContext = null; // recalcular por si cambió el perfil (p. ej. Test Mode)
    formadorTestAnswers = [];
    await loadFormadorCompletedModalities();
    const blocks = await buildFormadorBlocks();

    switchSection('formador-interface', async () => {
        ['formador-notice', 'formador-done', 'formador-quiz'].forEach(id =>
            document.getElementById(id)?.classList.add('hidden'));

        if (!blocks.length) {
            if (formadorCompletedMods.size) {
                await showFormadorResults(); // ya completó → ver sus radares
            } else {
                showAppAlert({
                    title: 'Sin preguntas por ahora',
                    message: 'Todavía no hay preguntas disponibles para tu puesto. Inténtalo más tarde.',
                    variant: 'info',
                    confirmText: T.common.understood
                });
            }
            return;
        }
        formadorBlocks = blocks;
        formadorBlockIdx = 0;
        renderFormadorBlockIntro();
    });
};

// Textos de la pantalla de transición por modalidad (a quién se evalúa).
const FORMADOR_NOTICE = {
    'Autoevaluación': {
        title: 'Autoevaluación 🪞',
        text: 'Ahora vas a evaluarte a ti mismo(a). Lee con cuidado y responde con honestidad.'
    },
    'Evaluación al formador': {
        title: 'Evaluación a tu formador 🎓',
        text: 'Ahora vas a evaluar a tu formador(a). Lee con cuidado y responde con honestidad.'
    },
    'Evaluación a mi equipo': {
        title: 'Evaluación a tu equipo 👥',
        text: 'Ahora vas a evaluar a tu equipo. Lee con cuidado y responde con honestidad.'
    },
};

/** Intro del bloque actual: pantalla que dice a quién se evalúa. */
function renderFormadorBlockIntro() {
    const block = formadorBlocks[formadorBlockIdx];
    formadorQIdx = 0;
    formadorBlockAnswers = [];
    showFormadorNotice({ modality: block.modality, mode: 'intro', onContinue: renderFormadorQuestion });
}

/**
 * Pantalla de aviso. mode 'intro' = antes de un bloque (1 botón).
 * mode 'interstage' = terminó un bloque (Continuar ahora / Guardar y salir).
 */
function showFormadorNotice({ modality, mode, finishedModality, onContinue, onSaveExit }) {
    const quiz = document.getElementById('formador-quiz');
    const notice = document.getElementById('formador-notice');
    const title = document.getElementById('formador-notice-title');
    const text = document.getElementById('formador-notice-text');
    const btn = document.getElementById('btn-formador-continue');
    const btnExit = document.getElementById('btn-formador-save-exit');
    if (!notice) { onContinue && onContinue(); return; }

    let copy;
    if (mode === 'interstage') {
        copy = {
            title: '¡Progreso guardado! ✅',
            text: `Terminaste "${finishedModality}". Tus respuestas quedaron guardadas: puedes continuar ahora o seguir después.`
        };
    } else {
        copy = FORMADOR_NOTICE[modality] || { title: 'Evaluación', text: 'Lee con cuidado y responde con honestidad.' };
    }
    if (title) title.textContent = copy.title;
    if (text) text.textContent = copy.text;
    if (btn) {
        btn.textContent = mode === 'interstage' ? 'CONTINUAR AHORA' : 'CONTINUAR';
        btn.onclick = () => { notice.classList.add('hidden'); onContinue && onContinue(); };
    }
    if (btnExit) {
        if (mode === 'interstage' && onSaveExit) {
            btnExit.classList.remove('hidden');
            btnExit.onclick = () => { notice.classList.add('hidden'); onSaveExit(); };
        } else {
            btnExit.classList.add('hidden');
        }
    }
    quiz?.classList.add('hidden');
    document.getElementById('formador-done')?.classList.add('hidden');
    notice.classList.remove('hidden');
}

function renderFormadorQuestion() {
    const block = formadorBlocks[formadorBlockIdx];
    const q = block.questions[formadorQIdx];
    document.getElementById('formador-notice')?.classList.add('hidden');
    document.getElementById('formador-quiz')?.classList.remove('hidden');

    const numEl = document.getElementById('formador-q-num');
    const totEl = document.getElementById('formador-q-total');
    if (numEl) numEl.textContent = String(formadorQIdx + 1);
    if (totEl) totEl.textContent = String(block.questions.length);

    const label = document.getElementById('formador-block-label');
    if (label) {
        let blockLabel = String(q.comportamiento || '').trim();
        // "Solo Admin" es una marca interna; al usuario le mostramos la competencia.
        if (!blockLabel || blockLabel === 'Solo Admin') {
            blockLabel = String(q.competencia || '').trim() || 'Evaluación';
        }
        label.textContent = blockLabel;
    }

    const qText = document.getElementById('formador-question-text');
    if (qText) qText.textContent = q.pregunta || '';

    const cont = document.getElementById('formador-options-container');
    if (!cont) return;
    cont.innerHTML = '';
    cont.style.pointerEvents = '';

    const opts = [
        { k: 'a', text: q.opcion_a, nivel: q.nivel_a },
        { k: 'b', text: q.opcion_b, nivel: q.nivel_b },
        { k: 'c', text: q.opcion_c, nivel: q.nivel_c },
        { k: 'd', text: q.opcion_d, nivel: q.nivel_d },
    ].filter(o => o.text && String(o.text).trim());

    opts.forEach(o => {
        const btn = document.createElement('button');
        btn.className = 'btn-option';
        const span = document.createElement('span');
        span.className = 'option-text';
        span.textContent = o.text;
        btn.appendChild(span);
        btn.onclick = () => selectFormadorAnswer(o);
        cont.appendChild(btn);
    });
}

function selectFormadorAnswer(opt) {
    const block = formadorBlocks[formadorBlockIdx];
    const q = block.questions[formadorQIdx];
    const cont = document.getElementById('formador-options-container');
    if (cont) cont.style.pointerEvents = 'none';

    const answer = {
        pregunta_id: q.id,
        tipo_evaluacion: block.modality,
        comportamiento: String(q.comportamiento || '').trim() || null,
        competencia: String(q.competencia || '').trim() || null,
        puesto: String(userProfile.especialidad || '').trim() || null,
        opcion_elegida: opt.k,
        respuesta: String(opt.text || '').trim() || null,
        nivel: String(opt.nivel || '').trim() || null,
    };
    formadorBlockAnswers.push(answer);
    formadorTestAnswers.push(answer);

    formadorQIdx++;
    if (formadorQIdx >= block.questions.length) {
        finishFormadorBlock();
    } else {
        renderFormadorQuestion();
    }
}

/** Guarda un lote de respuestas (el bloque recién terminado). */
async function saveFormadorAnswers(answers) {
    // Test Mode: solo preview, no se persiste nada.
    if (isTestModeActive()) { debugWarn('saveFormadorAnswers: omitido por Test Mode'); return true; }
    if (!supabase || !answers || !answers.length) return false;
    let userId = supabaseSession?.user?.id || '';
    if (!userId) {
        const { data: authData } = await supabase.auth.getUser();
        userId = authData?.user?.id || '';
    }
    if (!userId) { debugWarn('saveFormadorAnswers: sin user id'); return false; }
    const rows = answers.map(a => ({ ...a, user_id: userId }));
    const { error } = await supabase.from('respuestas_evaluar_formador').insert(rows);
    if (error) { debugError('saveFormadorAnswers error:', error); return false; }
    return true;
}

/** Al terminar un bloque: guarda su progreso y ofrece continuar o salir; al final muestra el radar. */
async function finishFormadorBlock() {
    const block = formadorBlocks[formadorBlockIdx];
    document.getElementById('formador-quiz')?.classList.add('hidden');
    beginGlobalLoading('Guardando tu progreso…');
    try {
        await saveFormadorAnswers(formadorBlockAnswers);
        formadorCompletedMods.add(block.modality);
        userProfile.formadorDoneAt = new Date().toISOString();
    } finally {
        endGlobalLoading();
    }
    formadorBlockAnswers = [];

    const hasNext = formadorBlockIdx < formadorBlocks.length - 1;
    if (hasNext) {
        showFormadorNotice({
            mode: 'interstage',
            finishedModality: block.modality,
            onContinue: () => { formadorBlockIdx++; renderFormadorBlockIntro(); },
            onSaveExit: () => window.formadorBackToBrief(),
        });
    } else {
        await showFormadorResults();
    }
}

// ─── Radar (gráfico de telaraña) de resultados ─────────────────────────────

/** Trae las respuestas para el radar: BD (usuarios reales) o memoria (Test Mode). */
async function fetchFormadorAnswersForRadar() {
    if (isTestModeActive()) return formadorTestAnswers;
    const userId = supabaseSession?.user?.id;
    if (!supabase || !userId) return formadorTestAnswers;
    try {
        const { data } = await supabase
            .from('respuestas_evaluar_formador')
            .select('tipo_evaluacion, comportamiento, nivel')
            .eq('user_id', userId);
        return (data && data.length) ? data : formadorTestAnswers;
    } catch (e) {
        debugWarn('fetchFormadorAnswersForRadar error:', e);
        return formadorTestAnswers;
    }
}

/** Promedia el nivel (1-4) por modalidad × comportamiento. Excluye Solo Admin / sin nivel. */
function computeFormadorRadar(answers) {
    const acc = {};
    (answers || []).forEach(a => {
        const mod = String(a.tipo_evaluacion || '').trim();
        const comp = String(a.comportamiento || '').trim();
        const val = FORMADOR_LEVEL_VALUE[String(a.nivel || '').trim().toLowerCase()];
        if (!mod || !comp || comp === 'Solo Admin' || !val) return;
        acc[mod] = acc[mod] || {};
        acc[mod][comp] = acc[mod][comp] || { sum: 0, count: 0 };
        acc[mod][comp].sum += val;
        acc[mod][comp].count += 1;
    });
    const out = {};
    Object.keys(acc).forEach(mod => {
        out[mod] = Object.keys(acc[mod]).map(comp => ({
            comp, avg: acc[mod][comp].sum / acc[mod][comp].count, n: acc[mod][comp].count
        }));
    });
    return out;
}

/** Muestra el panel final con los 3 radares y el switcher. */
async function showFormadorResults() {
    ['formador-quiz', 'formador-notice'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    beginGlobalLoading('Preparando tus resultados…');
    let answers = [];
    try { answers = await fetchFormadorAnswersForRadar(); } finally { endGlobalLoading(); }
    formadorRadarData = computeFormadorRadar(answers);

    const mods = FORMADOR_MODALITY_ORDER.filter(m => (formadorRadarData[m] || []).length);
    document.getElementById('formador-done')?.classList.remove('hidden');

    const sw = document.getElementById('formador-radar-switcher');
    if (sw) {
        sw.innerHTML = (mods.length > 1)
            ? mods.map((m, i) => `<button type="button" class="formador-radar-tab${i === 0 ? ' active' : ''}" data-mod="${m}">${FORMADOR_RADAR_LABEL[m] || m}</button>`).join('')
            : '';
        sw.querySelectorAll('.formador-radar-tab').forEach(b => {
            b.onclick = () => {
                sw.querySelectorAll('.formador-radar-tab').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                renderFormadorRadar(b.dataset.mod);
            };
        });
    }
    const cont = document.getElementById('formador-radar-container');
    if (mods.length) {
        renderFormadorRadar(mods[0]);
    } else if (cont) {
        cont.innerHTML = '<p style="color:var(--text-muted,#888)">Aún no hay datos suficientes para tu gráfico.</p>';
    }
}

/** Dibuja el radar (SVG, 5 ejes fijos) de una modalidad. */
function renderFormadorRadar(modality) {
    const cont = document.getElementById('formador-radar-container');
    if (!cont) return;
    const arr = formadorRadarData[modality] || [];
    const byComp = {};
    arr.forEach(d => { byComp[d.comp] = d; });

    const S = 320, C = S / 2, R = 112, MAX = 4;
    const angle = i => -Math.PI / 2 + i * 2 * Math.PI / FORMADOR_PICOS.length;
    const pt = (i, r) => [C + r * Math.cos(angle(i)), C + r * Math.sin(angle(i))];
    const col = '#597aff';

    let s = `<svg viewBox="0 0 ${S} ${S}" width="100%" style="max-width:340px;overflow:visible" role="img" aria-label="Radar ${modality}">`;
    // anillos (niveles 1-4)
    for (let k = 1; k <= MAX; k++) {
        const pts = FORMADOR_PICOS.map((_, i) => pt(i, R * k / MAX).map(n => n.toFixed(1)).join(',')).join(' ');
        s += `<polygon points="${pts}" fill="none" stroke="rgba(140,140,160,0.25)" stroke-width="1"/>`;
    }
    // ejes + etiquetas
    FORMADOR_PICOS.forEach((pico, i) => {
        const [x, y] = pt(i, R);
        s += `<line x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(140,140,160,0.25)" stroke-width="1"/>`;
        const [lx, ly] = pt(i, R + 16);
        const anchor = Math.abs(lx - C) < 8 ? 'middle' : (lx > C ? 'start' : 'end');
        const present = !!byComp[pico];
        const words = pico.split(' '); const lines = []; let cur = '';
        words.forEach(w => { if ((cur + ' ' + w).trim().length > 12) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; });
        if (cur.trim()) lines.push(cur.trim());
        const y0 = ly - (lines.length - 1) * 5.5;
        s += `<text x="${lx.toFixed(1)}" y="${y0.toFixed(1)}" text-anchor="${anchor}" font-size="10.5" fill="${present ? 'var(--text-color,#333)' : 'rgba(140,140,160,0.6)'}" font-family="inherit">`
            + lines.map((ln, k) => `<tspan x="${lx.toFixed(1)}" dy="${k ? 11 : 0}">${ln}</tspan>`).join('') + `</text>`;
    });
    // polígono de valores (solo comportamientos presentes)
    const verts = FORMADOR_PICOS.map((p, i) => byComp[p] ? { i, d: byComp[p] } : null).filter(Boolean);
    if (verts.length >= 3) {
        const poly = verts.map(v => pt(v.i, R * v.d.avg / MAX).map(n => n.toFixed(1)).join(',')).join(' ');
        s += `<polygon points="${poly}" fill="${col}33" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>`;
    } else if (verts.length === 2) {
        const a = pt(verts[0].i, R * verts[0].d.avg / MAX), b = pt(verts[1].i, R * verts[1].d.avg / MAX);
        s += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${col}" stroke-width="2.5"/>`;
    }
    verts.forEach(v => {
        const [x, y] = pt(v.i, R * v.d.avg / MAX);
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${col}" stroke="#fff" stroke-width="1.5"><title>${v.d.comp}: ${FORMADOR_LEVEL_LABEL[Math.round(v.d.avg)]} (${v.d.avg.toFixed(1)})</title></circle>`;
    });
    s += `</svg>`;

    // leyenda de valores por comportamiento
    const rows = FORMADOR_PICOS.filter(p => byComp[p]).map(p => {
        const d = byComp[p];
        return `<li style="display:flex;justify-content:space-between;gap:1rem;padding:.2rem 0;font-size:.85rem"><span>${p}</span><b>${FORMADOR_LEVEL_LABEL[Math.round(d.avg)]}</b></li>`;
    }).join('');

    cont.innerHTML =
        `<div style="display:flex;flex-direction:column;align-items:center;gap:.6rem">
            <div style="font-weight:700;font-size:1rem">${FORMADOR_RADAR_LABEL[modality] || modality}</div>
            ${s}
            <ul style="list-style:none;padding:0;margin:.4rem 0 0;width:100%;max-width:340px">${rows}</ul>
            <p style="font-size:.75rem;color:var(--text-muted,#888);margin:.2rem 0 0">Escala: En desarrollo · Satisfactorio · Avanzado · Experto</p>
        </div>`;
}

window.formadorBackToBrief = function () {
    switchSection('landing-page', () => {
        ['mode-selection-view', 'profile-view', 'dashboard-view', 'pills-construction-view']
            .forEach(id => document.getElementById(id)?.classList.add('hidden'));
        document.getElementById('evaluation-brief-view')?.classList.remove('hidden');
        renderEvaluationBriefSplit();
        window.setRoute('/evaluaciones');
        updateHeaderBackButton();
    });
};

async function startGuestMode() {
    // Modo invitado eliminado - todos los usuarios deben tener cuenta
    showAppAlert({
        title: T.alerts.guestModeTitle,
        message: T.alerts.guestModeMessage,
        variant: "info",
        confirmText: T.common.understood
    });
}

function switchSection(targetId, onShow) {
    const sections = ['landing-page', 'quiz-interface', 'pills-quiz-interface', 'break-screen', 'results-screen', 'formador-interface'];
    const visibleSectionId = sections.find(id => !document.getElementById(id).classList.contains('hidden'));

    const executeSwitch = () => {
        if (targetId !== 'quiz-interface' && targetId !== 'pills-quiz-interface') stopQuestionTimer();
        window.scrollTo(0, 0);
        sections.forEach(id => {
            const el = document.getElementById(id);
            if (id === targetId) {
                el.classList.remove('hidden');
                el.classList.remove('animate-fade-in');
                void el.offsetWidth; // forzar reflow para reiniciar animación
                el.classList.add('animate-fade-in');
            } else {
                el.classList.add('hidden');
            }
        });

        if (onShow) onShow();
        updateHeaderBackButton();
    };

    if (visibleSectionId && visibleSectionId !== targetId) {
        const visibleEl = document.getElementById(visibleSectionId);
        visibleEl.classList.add('animate-fade-out');
        setTimeout(() => {
            visibleEl.classList.remove('animate-fade-out');
            executeSwitch();
        }, 280); // Esperar a que termine el fadeOut
    } else {
        executeSwitch();
    }
}

function getNormalizedSeniority(value = '') {
    const raw = String(value || '')
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''); // strip acentos: Júnior → junior, Sénior → senior
    if (!raw) return '';
    if (raw.includes('junior') || raw === 'jr') return 'junior';
    if (raw.includes('medium') || raw.includes('mid') || raw.includes('medio')) return 'medium';
    if (raw.includes('senior') || raw === 'sr') return 'senior';
    if (raw.includes('product designer') || raw.includes('product_designer')) return 'product_designer';
    if (raw.includes('customer experience') || raw.includes('customer_experience') || raw === 'cx') return 'customer_experience';
    return '';
}

function normalizeLabelKey(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeCategoryLabel(value) {
    const normalized = normalizeLabelKey(value);
    const aliases = {
        'writing': 'UX Writing',
        'ux writing': 'UX Writing',
        'research': 'UX Research',
        'ux research': 'UX Research',
        'ux researcher': 'UX Research',
        'ui design': 'UI Design',
        'ui': 'UI Design',
        'strategy': 'Product Strategy',
        'product strategy': 'Product Strategy',
        'cases': 'Casos Prácticos',
        'casos practicos': 'Casos Prácticos'
    };
    return aliases[normalized] || String(value || '').trim();
}

function getQuestionField(question, aliases = []) {
    for (const key of aliases) {
        if (!key) continue;
        const value = question?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return '';
}

/** Cat o Especialidad equivalentes: «UX Research» y «UX Researcher». */
function isUxResearchFamilyLabel(value) {
    const n = normalizeLabelKey(value);
    return n === 'ux research' || n === 'ux researcher';
}

/** Cat equivalente a «UI Design» (p. ej. «UI DESIGN», «Ui Design»). */
function isUiDesignCategory(value) {
    return normalizeLabelKey(value) === 'ui design';
}

/**
 * Tokens de la especialidad, tolerante a la nomenclatura de RRHH.
 * Separa por espacios, «/», «-» y desdobla «UXUI» en «ux ui».
 *   "Diseñador UX/UI" → ['disenador','ux','ui']
 *   "UXUI" / "UX-UI"  → ['ux','ui']
 *   "Diseñador UX"    → ['disenador','ux']
 * Así «Diseñador UX» == «UX», «Diseñador UI» == «UI Design», «Diseñador UX UI» == «UXUI», etc.
 */
function specialtyTokens(especialidadRaw) {
    return normalizeLabelKey(especialidadRaw)
        .replace(/uxui/g, 'ux ui')
        .split(/[^a-z]+/)
        .filter(Boolean);
}

/** Especialidad tipo «UX/UI» (incl. «Diseñador UX UI», «UXUI»): mitad UI Design y mitad UX Research. */
function isUxUiDualSpecialty(especialidadRaw) {
    const t = specialtyTokens(especialidadRaw);
    return t.includes('ux') && t.includes('ui');
}

/** Especialidad UX (sin UI): «UX», «UX Research», «UX Researcher», «Diseñador UX». */
function isUxOnlySpecialty(especialidadRaw) {
    if (isUxUiDualSpecialty(especialidadRaw)) return false;
    if (isUxWritingSpecialty(especialidadRaw)) return false;
    const t = specialtyTokens(especialidadRaw);
    return t.includes('ux') && !t.includes('ui');
}

/**
 * Especialidad UX Writing / UX Writer: debe ver preguntas con Cat = "UX Writing".
 * Cubre: "UX Writer", "UX Writing", "ux writer", "writing", etc.
 */
function isUxWritingSpecialty(especialidadRaw) {
    if (isUxUiDualSpecialty(especialidadRaw)) return false;
    const t = specialtyTokens(especialidadRaw);
    return t.includes('writer') || t.includes('writing');
}

/** Categoría "UX Writing" en la pregunta (ya normalizada por normalizeCategoryLabel). */
function isUxWritingCategory(value) {
    return normalizeLabelKey(value) === 'ux writing';
}

/**
 * Especialidad UI (sin UX): "UI", "UI Design", "UI Designer", etc.
 * Debe ver preguntas con Cat = "UI Design".
 */
function isUiOnlySpecialty(especialidadRaw) {
    if (isUxUiDualSpecialty(especialidadRaw)) return false;
    const t = specialtyTokens(especialidadRaw);
    return t.includes('ui') && !t.includes('ux');
}

/**
 * Puestos «OPS» (ResearchOPS, InterfaceOPS, WritingOPS, GerenteOPS, OPS…).
 * Sus preguntas de evaluación NO están niveladas por seniority (hoy todas son 'junior'),
 * así que el match es solo por categoría (cat = especialidad) e ignora el seniority.
 */
function isOpsSpecialty(especialidadRaw) {
    return normalizeLabelKey(especialidadRaw).replace(/\s+/g, '').endsWith('ops');
}

/**
 * ¿La categoría de la pregunta (Cat) corresponde a la Especialidad del usuario en ranking_user?
 * Sin especialidad en perfil: no se filtra por área (solo seniority), por compatibilidad.
 *
 * Mapeo de especialidades:
 *   UX / UX Research / UX Researcher  → preguntas Cat familia UX Research
 *   UX/UI                              → preguntas Cat UI Design + familia UX Research
 *   UX Writer / UX Writing             → preguntas Cat UX Writing
 *   UI / UI Design / UI Designer       → preguntas Cat UI Design
 *   Otros                              → coincidencia exacta normalizada
 *
 * Checklist manual (Medium en todos):
 *   [x] UX          → Cat UX Research / UX Researcher  ✓
 *   [x] UX/UI       → Cat UI Design + UX Research       ✓
 *   [x] UX Writer   → Cat UX Writing                    ✓ (nuevo)
 *   [x] UI          → Cat UI Design                     ✓ (nuevo)
 */
function categoryMatchesUserEspecialidad(questionCategory, especialidadRaw) {
    const esp = String(especialidadRaw || '').trim();
    if (!esp) return true;

    const cat = String(questionCategory || '').trim();
    if (!cat) return false;

    // Caso 2: UX/UI → mezcla UI Design + familia UX Research
    if (isUxUiDualSpecialty(esp)) {
        return isUiDesignCategory(cat) || isUxResearchFamilyLabel(cat);
    }

    // Caso 3: UX Writer / UX Writing → solo UX Writing
    if (isUxWritingSpecialty(esp)) {
        return isUxWritingCategory(cat);
    }

    // Caso 4: UI / UI Design / UI Designer → solo UI Design
    if (isUiOnlySpecialty(esp)) {
        return isUiDesignCategory(cat);
    }

    // Caso 1: UX / UX Research / UX Researcher → familia UX Research
    if (isUxOnlySpecialty(esp) || isUxResearchFamilyLabel(esp)) {
        return isUxResearchFamilyLabel(cat);
    }

    // Fallback: coincidencia exacta normalizada
    return normalizeLabelKey(cat) === normalizeLabelKey(esp);
}

function shuffleArray(arr) {
    return [...arr].sort(() => Math.random() - 0.5);
}

/**
 * Hasta totalLen preguntas, equilibrando UI Design y UX Research (objetivo mitad y mitad).
 */
function buildBalancedUxUiSession(uiPool, uxPool, totalLen) {
    const half = Math.floor(totalLen / 2);
    const uiS = shuffleArray(uiPool);
    const uxS = shuffleArray(uxPool);
    let uiTake = Math.min(half, uiS.length);
    let uxTake = Math.min(half, uxS.length);
    const session = [...uiS.slice(0, uiTake), ...uxS.slice(0, uxTake)];
    let uiRem = uiS.slice(uiTake);
    let uxRem = uxS.slice(uxTake);
    while (session.length < totalLen && (uiRem.length || uxRem.length)) {
        const uiCount = session.filter((q) => isUiDesignCategory(q.category)).length;
        const uxCount = session.filter((q) => isUxResearchFamilyLabel(q.category)).length;
        if (uxCount < uiCount && uxRem.length) {
            session.push(uxRem.shift());
        } else if (uiRem.length) {
            session.push(uiRem.shift());
        } else if (uxRem.length) {
            session.push(uxRem.shift());
        } else {
            break;
        }
    }
    return shuffleArray(session);
}

function getQuestionSeniority(question) {
    const raw = getQuestionSeniorityRaw(question);
    return raw ? getNormalizedSeniority(raw) : '';
}

/**
 * Preguntas de evaluación: seniority (ranking_user vs Seniority en doc) y área Cat vs Especialidad en ranking_user.
 */
function stripAccents(s) {
    return String(s || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function filterEvaluationQuestionsByUserProfile(normalizedQuestions) {
    const userRaw = String(userProfile.seniority || '').trim();
    const userNorm = getNormalizedSeniority(userRaw);
    const esp = String(userProfile.especialidad || '').trim();
    // Puestos OPS: match solo por categoría (sus preguntas no están niveladas por seniority).
    const opsSpecialty = isOpsSpecialty(esp);

    const matched = normalizedQuestions.filter((q) => {
        if (!opsSpecialty) {
            const qNorm = q.seniority;
            const qRaw = String(q.seniorityRaw || '').trim();
            const seniorityOk =
                (userNorm && qNorm && userNorm === qNorm) ||
                (userRaw && qRaw && stripAccents(userRaw) === stripAccents(qRaw));
            if (!seniorityOk) return false;
        }
        return categoryMatchesUserEspecialidad(q.category, esp);
    });

    if (matched.length === 0 && normalizedQuestions.length > 0) {
        if (DEBUG) {
            const uniqueQSeniorities = [...new Set(normalizedQuestions.map(q => q.seniorityRaw).filter(Boolean))];
            const uniqueQCats = [...new Set(normalizedQuestions.map(q => q.category).filter(Boolean))];
            debugWarn(
                '[eval-filter] Sin preguntas para este usuario.\n',
                `  Usuario seniority raw: "${userRaw}" → norm: "${userNorm}"\n`,
                `  Usuario especialidad: "${esp}"\n`,
                `  Seniorities en preguntas: [${uniqueQSeniorities.join(', ')}]\n`,
                `  Categorías en preguntas: [${uniqueQCats.join(', ')}]`
            );
        }
    }

    return matched;
}

function updateEvaluationStartButtonState() {
    const btnStartEval = document.getElementById('btn-start-evaluation');
    if (!btnStartEval) return;
    const n =
        currentQuizMode === 'evaluation'
            ? filterEvaluationQuestionsByUserProfile(normalize()).length
            : filterEvaluationQuestionsByUserProfile(normalizePoolForEvaluation()).length;
    const isBlocked = isEvaluationHardBlocked();
    const shouldDisable = n === 0 || isBlocked;

    btnStartEval.disabled = shouldDisable;
    btnStartEval.classList.toggle('is-disabled', shouldDisable);
    btnStartEval.innerText = isBlocked ? T.evaluation.btnBlocked : T.evaluation.btnStart;
}

/** Normaliza `evaluationData` sin depender de `rawData` (p. ej. tras recargar preguntas desde Supabase). */
function normalizePoolForEvaluation() {
    const prev = rawData;
    rawData = evaluationData;
    const out = normalize();
    rawData = prev;
    return out;
}

function updateEvaluationBriefAutoUI() {
    const el = document.getElementById('evaluation-auto-summary');
    if (!el) return;

    const userLabel = String(userProfile.seniority || '').trim() || T.profile.noSeniorityLabel;
    const espLabel = String(userProfile.especialidad || '').trim() || 'No definida';
    const normalized =
        currentQuizMode === 'evaluation'
            ? normalize()
            : normalizePoolForEvaluation();
    const pool = filterEvaluationQuestionsByUserProfile(normalized);
    const n = pool.length;

    let detail = '';
    if (isUxUiDualSpecialty(userProfile.especialidad)) {
        const uiN = pool.filter((q) => isUiDesignCategory(q.category)).length;
        const uxN = pool.filter((q) => isUxResearchFamilyLabel(q.category)).length;
        detail = T.evaluation.detailUxUi(uiN, uxN);
    } else if (isUxOnlySpecialty(userProfile.especialidad)) {
        detail = T.evaluation.detailUxOnly;
    } else if (userProfile.especialidad) {
        detail = T.evaluation.detailEspecialidad(espLabel);
    } else {
        detail = T.evaluation.detailNoEspecialidad;
    }

    if (isEvaluationHardBlocked()) {
        el.textContent = T.evaluation.blockedInline;
        updateEvaluationStartButtonState();
        return;
    }

    el.textContent =
        n === 0
            ? T.evaluation.noPool(userLabel, espLabel)
            : T.evaluation.withPool(userLabel, espLabel, n, detail);
    updateEvaluationStartButtonState();
}

function getEvalErrorsStorageKey() {
    const uid = supabaseSession?.user?.id || userEmail || 'anon';
    return `uixlingo_eval_errors:${uid}`;
}

function renderEvaluationCompletedState() {
    const completedView = document.getElementById('evaluation-completed-view');
    const normalContent = document.getElementById('evaluation-brief-content');
    if (!completedView || !normalContent) return;

    if (userProfile.evalCompleted) {
        normalContent.classList.add('hidden');
        completedView.classList.remove('hidden');

        const scoreEl = document.getElementById('eval-completed-score');
        if (scoreEl) scoreEl.innerText = userProfile.testsPoints;

        // Cargar errores desde localStorage y renderizarlos inline
        let savedErrors = [];
        try {
            savedErrors = JSON.parse(localStorage.getItem(getEvalErrorsStorageKey()) || '[]');
        } catch (e) { /* ignorar */ }

        const errorsCard = document.getElementById('eval-errors-card');
        const errorsList = document.getElementById('eval-errors-inline-list');

        if (errorsCard && errorsList) {
            errorsList.innerHTML = '';
            if (savedErrors.length === 0) {
                errorsCard.classList.add('hidden');
            } else {
                errorsCard.classList.remove('hidden');
                savedErrors.forEach((err, index) => {
                    const item = document.createElement('div');
                    item.className = 'eval-error-item';
                    item.innerHTML = `
                        <p class="eval-error-question">${esc(index + 1)}. ${esc(err.question)}</p>
                        <div class="eval-error-tag-row">
                            <span class="review-topic-label">${T.profile.topicToReview}</span>
                            <span class="review-topic-name">${esc(err.studyTag || '—')}</span>
                        </div>
                    `;
                    errorsList.appendChild(item);
                });
            }
        }
    } else {
        completedView.classList.add('hidden');
        normalContent.classList.remove('hidden');
    }
}

/** Fecha legible (es-MX) para el estado completado del formador. */
function formatFormadorDate(iso) {
    try {
        return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) {
        return String(iso || '').slice(0, 10);
    }
}

/**
 * Configura la pantalla dividida del brief:
 * - Izquierda (preguntas): normal vs completado con puntaje (renderEvaluationCompletedState).
 * - Derecha (formador): solo para puestos con equipo; instrucciones vs "completado + fecha".
 */
async function renderEvaluationBriefSplit() {
    renderEvaluationCompletedState();

    const puedeEvaluarFormador = canEvaluateFormador(userProfile.especialidad);
    document.getElementById('eval-col-formador')?.classList.toggle('hidden', !puedeEvaluarFormador);
    document.getElementById('eval-split-divider')?.classList.toggle('hidden', !puedeEvaluarFormador);
    if (!puedeEvaluarFormador) return;

    const status = await getFormadorBriefStatus();

    // 'empty' = puede por rol pero no hay preguntas para su puesto → ocultar la columna.
    if (status === 'empty') {
        document.getElementById('eval-col-formador')?.classList.add('hidden');
        document.getElementById('eval-split-divider')?.classList.add('hidden');
        return;
    }

    const isDone = status === 'done';
    document.getElementById('formador-brief-panel')?.classList.toggle('hidden', isDone);
    document.getElementById('formador-completed-panel')?.classList.toggle('hidden', !isDone);

    const startBtn = document.getElementById('btn-start-formador');
    if (!isDone && startBtn) {
        startBtn.textContent = status === 'partial'
            ? 'CONTINUAR EVALUACIÓN'
            : 'EVALUAR A MI FORMADOR / EQUIPO';
    }
    if (isDone) {
        const dateEl = document.getElementById('formador-completed-date');
        if (dateEl && userProfile.formadorDoneAt) dateEl.textContent = formatFormadorDate(userProfile.formadorDoneAt);
    }
}

function formatSeniorityLabel(seniority) {
    const normalized = getNormalizedSeniority(seniority);
    const labels = T.labels.seniority;
    return labels[normalized] || '';
}

function isPillsMode() {
    return currentQuizMode === 'pills';
}

/**
 * Carga preguntas desde `pills/{pillId}/questions`.
 * Solo incluye `active === true` (si falta el campo, se considera activa) y `type === true_false`.
 */
async function fetchPillQuestions(pillId) {
    if (!supabase || !pillId) return [];
    const parent = pillsCatalog.find((p) => p.id === pillId);
    const parentCategory = String(parent?.category || '').trim();

    const { data, error } = await supabase
        .from('pill_questions')
        .select('*')
        .eq('pill_id', pillId)
        .eq('active', true);
    if (error) {
        if (DEBUG) debugWarn('fetchPillQuestions error:', error);
        return [];
    }

    return (data || [])
        .filter(d => String(d.type || 'true_false').toLowerCase().trim() === 'true_false')
        .map(d => ({
            id: d.id,
            pillId,
            question: d.question,
            correctAnswer: d.correct_answer === true,
            explanation: d.explanation || '',
            category: String(d.category || parentCategory || '').trim(),
            type: 'true_false'
        }));
}

/**
 * Una sola petición: preguntas V/F activas por pill (misma regla que fetchPillQuestions).
 * @returns {Promise<Map<string, { id: string, question: string }[]> | null>}
 *   Map por pill_id, o null si falla la consulta (fallback: mostrar «Contestar» como antes).
 */
async function fetchPillQuestionsBatch(pillIds) {
    const ids = [...new Set((pillIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!supabase || !ids.length) return new Map();

    const { data, error } = await supabase
        .from('pill_questions')
        .select('id, pill_id, question, type, active')
        .in('pill_id', ids)
        .eq('active', true);

    if (error) {
        if (DEBUG) debugWarn('fetchPillQuestionsBatch error:', error);
        return null;
    }

    const map = new Map();
    for (const row of data || []) {
        if (String(row.type || 'true_false').toLowerCase().trim() !== 'true_false') continue;
        const pid = String(row.pill_id || '').trim();
        if (!pid) continue;
        const entry = { id: row.id, question: String(row.question || '').trim() };
        if (!map.has(pid)) map.set(pid, []);
        map.get(pid).push(entry);
    }
    return map;
}

async function loadPillRatingsForList(pillIds) {
    pillRatingsSummaryByPillId = {};
    myPillRatingByPillId = {};
    if (!supabase || !pillIds.length) return;
    try {
        const { data, error } = await supabase
            .from('pill_ratings')
            .select('pill_id, user_id, rating')
            .in('pill_id', pillIds);
        if (error) throw error;

        (data || []).forEach((row) => {
            const pid = String(row.pill_id || '').trim();
            const r = Number(row.rating || 0);
            if (!pid || r < 1 || r > 5) return;
            const prev = pillRatingsSummaryByPillId[pid] || { sum: 0, count: 0 };
            prev.sum += r;
            prev.count += 1;
            pillRatingsSummaryByPillId[pid] = prev;
            if (row.user_id && row.user_id === supabaseSession?.user?.id) {
                myPillRatingByPillId[pid] = r;
            }
        });
    } catch (e) {
        debugWarn('loadPillRatingsForList error:', e);
    }
}

function getPillAverageText(pillId) {
    const stats = pillRatingsSummaryByPillId[String(pillId || '').trim()];
    if (!stats || !stats.count) return T.pills.noVotes;
    const avg = stats.sum / stats.count;
    return `${avg.toFixed(1)}`;
}

function flashPillRatingSavedCheck(pillIdAttr) {
    const id = String(pillIdAttr || '').trim();
    if (!id) return;
    const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
    requestAnimationFrame(() => {
        const wrap = document.querySelector(`[data-pill-id="${safe}"] .pills-rating__stars`);
        if (!wrap) return;
        const tick = document.createElement('span');
        tick.className = 'pills-rating__saved-check';
        tick.setAttribute('aria-hidden', 'true');
        tick.innerHTML = '<i class="fas fa-check"></i>';
        wrap.appendChild(tick);
        requestAnimationFrame(() => tick.classList.add('pills-rating__saved-check--visible'));
        setTimeout(() => {
            tick.classList.remove('pills-rating__saved-check--visible');
            setTimeout(() => tick.remove(), 380);
        }, 950);
    });
}

async function savePillRating(pillId, rating) {
    if (!supabase || !supabaseSession?.user?.id) {
        showAppAlert({
            title: T.alerts.ratingLoginTitle,
            message: T.alerts.ratingLoginMessage,
            variant: 'info',
            confirmText: T.common.understood
        });
        return;
    }
    const pid = String(pillId || '').trim();
    const r = Number(rating || 0);
    if (!pid || r < 1 || r > 5) return;
    // Test Mode: solo preview, no se guarda la calificación.
    if (isTestModeActive()) {
        showAppAlert({
            title: 'Modo prueba',
            message: 'Estás en modo prueba: la calificación no se guarda.',
            variant: 'info',
            confirmText: T.common.understood
        });
        return;
    }
    try {
        const { error } = await supabase
            .from('pill_ratings')
            .upsert(
                {
                    pill_id: pid,
                    user_id: supabaseSession.user.id,
                    rating: r
                },
                { onConflict: 'pill_id,user_id' }
            );
        if (error) throw error;
        await loadPillRatingsForList([pid]);
        await renderPillsList();
        flashPillRatingSavedCheck(pid);
    } catch (e) {
        debugWarn('savePillRating error:', e);
        showAppAlert({
            title: T.alerts.ratingSaveErrorTitle,
            message: T.alerts.ratingSaveErrorMessage,
            variant: 'error',
            confirmText: T.common.understood
        });
    }
}

/**
 * Una card por documento en `pills` (nombre, categoría, descripción). Las preguntas están en la subcolección `questions`.
 */
async function renderPillsList() {
    const grid = document.getElementById('pills-category-grid');
    if (!grid) return;

    if (!pillsCatalog.length) {
        grid.innerHTML = T.pills.emptyGrid;
        return;
    }

    const sorted = [...pillsCatalog].sort((a, b) => {
        const ta = getPillPublishedAtMs(a);
        const tb = getPillPublishedAtMs(b);
        if (ta !== tb) return tb - ta;
        return String(a.name || a.id).localeCompare(String(b.name || b.id), 'es');
    });
    await loadPillRatingsForList(sorted.map((p) => p.id));
    const batchQs = await fetchPillQuestionsBatch(sorted.map((p) => p.id));

    grid.innerHTML = '';
    sorted.forEach((pill, index) => {
        const card = document.createElement('div');
        card.className = 'pills-category-card';
        if (pill.id != null && pill.id !== '') card.setAttribute('data-pill-id', String(pill.id));
        const content = document.createElement('div');
        content.className = 'pills-category-card__content';

        const title = document.createElement('h3');
        title.className = 'pills-category-card__title';
        const pillNameText = String(pill.name || pill.id || T.common.pillFallback).trim();
        const titleMain = document.createElement('span');
        titleMain.className = 'pills-category-card__title-main';
        titleMain.textContent = pillNameText;
        title.appendChild(titleMain);
        if (index === 0) {
            const newTag = document.createElement('span');
            newTag.className = 'bento-pills-new-tag';
            newTag.textContent = 'Nueva pill';
            newTag.setAttribute('aria-hidden', 'false');
            title.appendChild(newTag);
        }

        const meta = document.createElement('p');
        meta.className = 'pills-category-card__meta';
        const catLine = pill.category ? `${pill.category}` : '';
        const desc = pill.description ? String(pill.description).slice(0, 140) + (pill.description.length > 140 ? '…' : '') : '';
        meta.textContent = [catLine, desc].filter(Boolean).join(' · ') || T.pills.metaFallback;

        const pillIdStr = String(pill.id || '').trim();
        const pillQuestions =
            batchQs === null ? null : (batchQs.get(pillIdStr) || []);


        const sealUrl = getPillSealUrl(pill);
        const sealName = getPillSealName(pill);
        const sealWindow = getPillSealWindowState(pill);
        const remainingLabel = formatPillSealRemaining(sealWindow.remainingMs);
        const hasAttempt = Boolean(
            userProfile.pillScores &&
            Object.prototype.hasOwnProperty.call(userProfile.pillScores, String(pill.id || '').trim())
        );
        const hasQuestions = pillQuestions !== null && pillQuestions.length > 0;
        if (hasQuestions && !hasAttempt && !sealWindow.isExpired) {
            const titleTimer = document.createElement('span');
            titleTimer.className = 'pills-category-card__title-timer';
            titleTimer.textContent = T.pills.sealTitleTimer(remainingLabel);
            title.appendChild(titleTimer);
        }
        const sealBlock = hasQuestions ? document.createElement('div') : null;
        if (sealBlock) {
        sealBlock.className = 'pills-seal-preview';

        const sealLabel = document.createElement('span');
        sealLabel.className = 'pills-seal-preview__label';
        if (hasAttempt) {
            sealLabel.textContent = T.pills.sealAfterAttemptLabel;
        } else if (sealWindow.isExpired) {
            sealLabel.textContent = T.pills.sealExpiredLabel;
        } else {
            sealLabel.textContent = T.pills.sealInDispute;
        }
        sealBlock.appendChild(sealLabel);

        if (hasAttempt) {
            const sealInfo = document.createElement('span');
            sealInfo.className = 'pills-seal-preview__empty';
            sealInfo.textContent = T.pills.sealAfterAttemptMessage;
            sealBlock.appendChild(sealInfo);
        } else if (sealWindow.isExpired) {
            const sealInfo = document.createElement('span');
            sealInfo.className = 'pills-seal-preview__empty';
            sealInfo.textContent = T.pills.sealExpiredMessage;
            sealBlock.appendChild(sealInfo);
        } else if (sealUrl) {
            const sealMedia = document.createElement('div');
            sealMedia.className = 'pills-seal-preview__media';
            const sealImg = document.createElement('img');
            sealImg.className = 'pills-seal-preview__img';
            sealImg.src = sealUrl;
            sealImg.alt = sealName || T.pills.sealNoImage;
            sealImg.loading = 'lazy';
            sealImg.decoding = 'async';
            sealImg.width = 72;
            sealImg.height = 72;
            const sealCaption = document.createElement('span');
            sealCaption.className = 'pills-seal-preview__name';
            sealCaption.textContent = T.pills.sealWindowRemaining(remainingLabel);
            sealMedia.appendChild(sealImg);
            sealMedia.appendChild(sealCaption);
            sealBlock.appendChild(sealMedia);
        } else {
            const sealEmpty = document.createElement('span');
            sealEmpty.className = 'pills-seal-preview__empty';
            sealEmpty.textContent = T.pills.noSealAvailable;
            sealBlock.appendChild(sealEmpty);
        }
        }

        const ratingWrap = document.createElement('div');
        ratingWrap.className = 'pills-rating';
        const ratingCta = document.createElement('span');
        ratingCta.className = 'pills-rating__cta';
        ratingCta.textContent = T.pills.ratePill;
        const starsWrap = document.createElement('div');
        starsWrap.className = 'pills-rating__stars';
        const mine = Number(myPillRatingByPillId[String(pill.id || '').trim()] || 0);
        for (let i = 1; i <= 5; i++) {
            const starBtn = document.createElement('button');
            starBtn.type = 'button';
            starBtn.className = `pills-rating__star${i <= mine ? ' is-active' : ''}`;
            starBtn.setAttribute('aria-label', T.pills.starLabel(i));
            starBtn.innerHTML = '<i class="fas fa-star" aria-hidden="true"></i>';
            starBtn.addEventListener('click', async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                await savePillRating(pill.id, i);
            });
            starsWrap.appendChild(starBtn);
        }
        ratingWrap.appendChild(ratingCta);
        ratingWrap.appendChild(starsWrap);
        if (mine > 0) {
            const ratingAvg = document.createElement('span');
            ratingAvg.className = 'pills-rating__avg';
            ratingAvg.textContent = T.pills.averagePrefix + getPillAverageText(pill.id);
            ratingWrap.appendChild(ratingAvg);
        }

        const actions = document.createElement('div');
        actions.className = 'pills-category-card__actions';

        const btnPreview = document.createElement('button');
        btnPreview.type = 'button';
        btnPreview.className = 'btn-secondary pills-btn-preview pills-card-action-btn';
        btnPreview.textContent = T.pills.viewPill;
        const link = getPillMediaLink(pill);
        if (link) {
            btnPreview.addEventListener('click', () => window.open(link, '_blank', 'noopener,noreferrer'));
        } else {
            btnPreview.disabled = true;
            btnPreview.title = T.pills.noLinkYet;
        }

        const btnStart = document.createElement('button');
        btnStart.type = 'button';
        btnStart.className = 'btn-primary pills-btn-start pills-card-action-btn';
        btnStart.textContent = T.pills.answerQuestions;
        btnStart.addEventListener('click', () => window.startPillsQuiz(pill.id));

        actions.appendChild(btnPreview);
        if (pillQuestions === null || pillQuestions.length > 0) {
            actions.appendChild(btnStart);
        }
        content.appendChild(title);
        content.appendChild(meta);
        if (sealBlock) content.appendChild(sealBlock);
        content.appendChild(ratingWrap);
        card.appendChild(content);
        card.appendChild(actions);
        grid.appendChild(card);
    });
}

window.openPillPreview = async function (pillId) {
    const parent = pillsCatalog.find((p) => p.id === pillId);
    const title = parent?.name || pillId;
    if (!supabase) {
        showAppAlert({ title: T.alerts.noConnectionTitle, message: T.alerts.noConnectionMessage, variant: 'error', confirmText: T.common.understood });
        return;
    }
    try {
        const items = await fetchPillQuestions(pillId);
        const desc = parent?.description ? String(parent.description) : '';
        const mediaLink = getPillMediaLink(parent);
        if (items.length === 0) {
            showAppAlert({
                title: title,
                message: desc
                    ? T.alerts.pillPreviewInactive(desc)
                    : T.pills.pillPreviewNoActive,
                variant: 'info',
                confirmText: T.common.close
            });
            return;
        }
        const head = [desc || '', mediaLink ? `${T.pills.materialLinkPrefix}${mediaLink}` : ''].filter(Boolean).join('\n\n');
        showAppAlert({
            title: title,
            message: T.fmt.pillPreviewHead(head, T.pills.pillPreviewFair(items.length)),
            variant: 'info',
            confirmText: T.common.close
        });
    } catch (e) {
        debugError('openPillPreview', e);
        showAppAlert({
            title: T.alerts.pillLoadErrorTitle,
            message: e.message || T.alerts.pillLoadErrorMessage,
            variant: 'error',
            confirmText: T.common.understood
        });
    }
};

window.startPillsQuiz = async function (pillId) {
    if (!supabase) return;
    currentQuizMode = 'pills';
    try {
        let pool = await fetchPillQuestions(pillId);
        if (pool.length === 0) {
            showAppAlert({
                title: T.alerts.pillNoQuestionsTitle,
                message: T.alerts.pillNoQuestionsMessage,
                variant: 'warning',
                confirmText: T.common.understood
            });
            return;
        }
        const parent = pillsCatalog.find((p) => p.id === pillId);
        selectedPillId = pillId;
        pillsSessionHadPriorAttempt = Boolean(
            userProfile.pillScores && Object.prototype.hasOwnProperty.call(userProfile.pillScores, pillId)
        );
        selectedPillMeta = {
            name: String(parent?.name || '').trim(),
            category: String(parent?.category || '').trim(),
            sealUrl: getPillSealUrl(parent),
            sealName: getPillSealName(parent)
        };

        pool = getPillSessionRandomizedPool(pool, pillId);
        lastPillSessionOrderByPillId[pillId] = pool.map((q) => String(q?.id || q?.question || '')).join('|');
        const limit = Math.min(SESSION_LENGTH, pool.length);
        currentSession = pool.slice(0, limit);
        questions = currentSession;
        currentIndex = 0;
        score = 0;
        streak = 0;
        errors = [];
        startTime = new Date();

        switchSection('pills-quiz-interface', () => {
            document.getElementById('main-header').classList.remove('hidden');
            loadPillsQuestion();
        });
    } catch (e) {
        debugError('startPillsQuiz', e);
        showAppAlert({
            title: T.common.error,
            message: e.message || T.alerts.pillQuizErrorMessage,
            variant: 'error',
            confirmText: T.common.understood
        });
    }
};

function loadPillsQuestion() {
    pillsAnswerLocked = false;
    const q = currentSession[currentIndex];
    if (!q) return;

    document.getElementById('pills-current-q-num').innerText = String(currentIndex + 1);
    document.getElementById('pills-q-total').innerText = `/${currentSession.length}`;

    document.getElementById('pills-question-text').innerText = q.question || '';

    document.getElementById('feedback-panel').classList.add('hidden');
    document.getElementById('feedback-overlay').classList.add('hidden');
    document.getElementById('feedback-overlay').classList.add('opacity-0');

    const nextBtn = document.getElementById('btn-next-question');
    if (nextBtn) nextBtn.innerText = T.feedback.next;

    document.querySelectorAll('.pills-drop-zone').forEach((z) => {
        z.classList.remove('pills-drop-zone--hover');
        z.style.pointerEvents = 'auto';
    });
    const card = document.getElementById('pills-question-card');
    if (card) {
        card.setAttribute('aria-grabbed', 'false');
        card.classList.remove('pills-question-card--dragging');
        card.classList.remove('pills-question-card--swiping-left', 'pills-question-card--swiping-right');
        pillsClearCardDirectionHints(card);
        card.style.transform = '';
        card.style.setProperty('--swipe-opacity', '0');
        pillsTouchDeltaX = 0;
        pillsTouchDeltaY = 0;
        pillsUpdateCardDraggable();
    }
}

function handlePillsAnswer(userBool) {
    if (pillsAnswerLocked) return;
    const panel = document.getElementById('feedback-panel');
    if (panel && !panel.classList.contains('hidden')) return;

    pillsAnswerLocked = true;
    const card = document.getElementById('pills-question-card');
    if (card) {
        card.classList.remove('pills-question-card--swiping-left', 'pills-question-card--swiping-right');
        pillsClearCardDirectionHints(card);
        card.style.transform = '';
        card.style.setProperty('--swipe-opacity', '0');
    }
    document.querySelectorAll('.pills-drop-zone').forEach((z) => {
        z.style.pointerEvents = 'none';
    });

    const q = currentSession[currentIndex];
    const correct = q.correctAnswer === true;
    const isCorrect = userBool === correct;

    if (isCorrect) {
        score++;
        streak++;
        checkStreakBonus();
    } else {
        streak = 0;
        errors.push(q);
    }
    updateStreakUI();
    showFeedbackPills(isCorrect, q, userBool);
}

function showFeedbackPills(isCorrect, q, userAnswer) {
    const panel = document.getElementById('feedback-panel');
    const overlay = document.getElementById('feedback-overlay');
    const title = document.getElementById('feedback-title');
    const msg = document.getElementById('feedback-msg');
    const icon = document.getElementById('feedback-icon');
    const tipBox = document.getElementById('study-tip-box');
    const nextBtn = document.getElementById('btn-next-question');

    panel.classList.remove('hidden');
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.remove('opacity-0'), 10);

    panel.classList.remove('animate-slide-up');
    void panel.offsetWidth;
    panel.classList.add('animate-slide-up');

    const userLabel = userAnswer ? T.feedback.true : T.feedback.false;
    const correctLabel = q.correctAnswer === true ? T.feedback.true : T.feedback.false;
    const expl = q.explanation || '';

    if (isCorrect) {
        panel.className = 'feedback-panel feedback-panel--correct animate-slide-up';
        title.innerText = T.feedback.correct;
        title.className = 'feedback-title-text feedback-title--correct';
        icon.innerHTML = '<i class="fas fa-check-circle icon-feedback-correct"></i>';
        tipBox.classList.add('hidden');
        msg.innerHTML = expl ? `<p><strong>${T.feedback.whyLabel}</strong> ${esc(expl)}</p>` : '';
        if (nextBtn) nextBtn.innerText = T.feedback.next;
    } else {
        panel.className = 'feedback-panel feedback-panel--wrong animate-slide-up';
        title.innerText = T.feedback.incorrect;
        title.className = 'feedback-title-text feedback-title--wrong';
        icon.innerHTML = '<i class="fas fa-exclamation-triangle icon-feedback-wrong"></i>';
        tipBox.classList.add('hidden');
        msg.innerHTML = `
            <p><strong>${T.feedback.answerYour}</strong> ${esc(userLabel)} · <strong>${T.feedback.answerCorrect}</strong> ${esc(correctLabel)}</p>
            ${expl ? `<p><strong>${T.feedback.recommendation}</strong> ${esc(expl)}</p>` : ''}`;
        if (nextBtn) nextBtn.innerText = T.feedback.next;
    }

    focusFeedbackNextButton();
}

function onPillsTouchStart(e) {
    const pillsSection = document.getElementById('pills-quiz-interface');
    if (pillsSection.classList.contains('hidden') || pillsAnswerLocked) return;
    if (!e.touches || e.touches.length !== 1) return;
    pillsTouchDragging = true;
    pillsTouchStartX = e.touches[0].clientX;
    pillsTouchStartY = e.touches[0].clientY;
    pillsTouchDeltaX = 0;
    pillsTouchDeltaY = 0;
    pillsLastPointerClientX = pillsTouchStartX;
    pillsLastPointerClientY = pillsTouchStartY;
}

function onPillsTouchMove(e) {
    if (!pillsTouchDragging) return;
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    pillsApplySwipeVisual(t.clientX, t.clientY);
}

function onPillsSwipeEnd() {
    if (!pillsTouchDragging) return;
    pillsTouchDragging = false;
    const card = document.getElementById('pills-question-card');
    if (!card) return;

    if (isPillsSwipeViewportMobile()) {
        const dx = pillsTouchDeltaX;
        const abs = Math.abs(dx);
        const answer = dx > 0;
        if (abs >= PILLS_SWIPE_THRESHOLD) {
            const outX = answer ? 280 : -280;
            const rot = answer ? 10 : -10;
            card.style.transform = `translateX(${outX}px) rotate(${rot}deg)`;
            setTimeout(() => handlePillsAnswer(answer), 120);
            return;
        }
    } else {
        const dyDown = Math.max(0, pillsLastPointerClientY - pillsTouchStartY);
        if (dyDown >= PILLS_SWIPE_THRESHOLD_DESKTOP_Y) {
            const layout = document.querySelector('.pills-tf-layout');
            const mid = layout
                ? layout.getBoundingClientRect().left + layout.getBoundingClientRect().width / 2
                : pillsTouchStartX;
            const answer = pillsLastPointerClientX >= mid;
            const outDx = (answer ? 1 : -1) * 40;
            card.style.transform = `translate(${outDx}px, 240px) rotate(${answer ? 8 : -8}deg)`;
            setTimeout(() => handlePillsAnswer(answer), 120);
            return;
        }
    }

    card.style.transform = '';
    card.classList.remove('pills-question-card--swiping-left', 'pills-question-card--swiping-right');
    pillsClearCardDirectionHints(card);
    card.style.setProperty('--swipe-opacity', '0');
}

function onPillsPointerDown(e) {
    if (e.pointerType !== 'mouse') return;
    const pillsSection = document.getElementById('pills-quiz-interface');
    if (pillsSection.classList.contains('hidden') || pillsAnswerLocked) return;
    if (e.button !== 0) return;
    e.preventDefault();
    pillsTouchDragging = true;
    pillsTouchStartX = e.clientX;
    pillsTouchStartY = e.clientY;
    pillsTouchDeltaX = 0;
    pillsTouchDeltaY = 0;
    pillsLastPointerClientX = e.clientX;
    pillsLastPointerClientY = e.clientY;
    pillsSwipePointerId = e.pointerId;
    const card = document.getElementById('pills-question-card');
    if (card) card.setPointerCapture(e.pointerId);
}

function onPillsPointerMove(e) {
    if (!pillsTouchDragging || pillsSwipePointerId !== e.pointerId) return;
    pillsApplySwipeVisual(e.clientX, e.clientY);
}

function onPillsPointerUp(e) {
    if (pillsSwipePointerId !== e.pointerId) return;
    const card = document.getElementById('pills-question-card');
    if (card && card.hasPointerCapture(e.pointerId)) {
        try {
            card.releasePointerCapture(e.pointerId);
        } catch (_) {
            /* ignore */
        }
    }
    pillsSwipePointerId = null;
    onPillsSwipeEnd();
}

let pillsQuizInteractionsBound = false;
function initPillsQuizInteractions() {
    if (pillsQuizInteractionsBound) return;
    const zFalse = document.getElementById('pills-drop-false');
    const zTrue = document.getElementById('pills-drop-true');
    const card = document.getElementById('pills-question-card');
    if (!zFalse || !zTrue || !card) return;
    pillsQuizInteractionsBound = true;

    [zFalse, zTrue].forEach((zone) => {
        zone.addEventListener('click', () => {
            const pillsSection = document.getElementById('pills-quiz-interface');
            if (pillsSection.classList.contains('hidden')) return;
            const v = zone.getAttribute('data-pill-answer') === 'true';
            handlePillsAnswer(v);
        });
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('pills-drop-zone--hover');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('pills-drop-zone--hover'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('pills-drop-zone--hover');
            const v = zone.getAttribute('data-pill-answer') === 'true';
            handlePillsAnswer(v);
        });
    });

    const blankDragImg = (() => {
        const c = document.createElement('canvas');
        c.width = 1;
        c.height = 1;
        return c;
    })();

    card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', 'pill');
        e.dataTransfer.effectAllowed = 'move';
        try {
            e.dataTransfer.setDragImage(blankDragImg, 0, 0);
        } catch (_) {
            /* ignore */
        }
        card.classList.add('pills-question-card--dragging');
        card.setAttribute('aria-grabbed', 'true');
    });
    card.addEventListener('drag', (ev) => {
        if (typeof ev.clientX === 'number' && ev.clientX !== 0) {
            pillsApplyDragHintFromClientX(ev.clientX);
        }
    });
    card.addEventListener('dragend', () => {
        card.classList.remove('pills-question-card--dragging');
        card.setAttribute('aria-grabbed', 'false');
        pillsClearCardDirectionHints(card);
    });
    card.addEventListener('touchstart', onPillsTouchStart, { passive: true });
    card.addEventListener('touchmove', onPillsTouchMove, { passive: true });
    card.addEventListener('touchend', onPillsSwipeEnd, { passive: true });
    card.addEventListener('touchcancel', onPillsSwipeEnd, { passive: true });

    card.addEventListener('pointerdown', onPillsPointerDown);
    card.addEventListener('pointermove', onPillsPointerMove);
    card.addEventListener('pointerup', onPillsPointerUp);
    card.addEventListener('pointercancel', onPillsPointerUp);

    pillsUpdateCardDraggable();
    window.addEventListener('resize', pillsUpdateCardDraggable);
}

function startQuiz() {
    if (currentQuizMode === 'pills') {
        showAppAlert({
            title: T.alerts.pillsChooseAreaTitle,
            message: T.alerts.pillsChooseAreaMessage,
            variant: 'info',
            confirmText: T.common.understood
        });
        return;
    }
    if (isEvaluationMode() && isEvaluationHardBlocked()) {
        showAppAlert({
            title: T.alerts.evaluationBlockedTitle,
            message: T.alerts.evaluationBlockedMessage,
            variant: "error",
            confirmText: T.common.understood
        });
        return;
    }

    const allQuestions = normalize();
    // Filtro insensible a mayúsculas/minúsculas
    const normalizedActive = new Set(
        Array.from(activeCategories).map(c => normalizeLabelKey(normalizeCategoryLabel(c)))
    );

    if (currentQuizMode === 'evaluation') {
        questions = filterEvaluationQuestionsByUserProfile(allQuestions);
    } else {
        const filteredQuestions = allQuestions.filter(q =>
            normalizedActive.has(normalizeLabelKey(normalizeCategoryLabel(q.category)))
        );
        questions = filteredQuestions;
    }

    if (questions.length === 0) {
        showAppAlert({
            title: T.alerts.noQuestionsTitle,
            message: currentQuizMode === 'evaluation'
                ? T.alerts.noQuestionsEvalRanking
                : T.alerts.noQuestionsPracticeMode,
            variant: "warning",
            confirmText: T.common.understood
        });
        return;
    }

    if (currentQuizMode === 'evaluation' && isUxUiDualSpecialty(userProfile.especialidad)) {
        const uiPool = questions.filter((q) => isUiDesignCategory(q.category));
        const uxPool = questions.filter((q) => isUxResearchFamilyLabel(q.category));
        currentSession = buildBalancedUxUiSession(uiPool, uxPool, EVALUATION_SESSION_LENGTH_UX_UI);
        if (currentSession.length === 0) {
            showAppAlert({
                title: T.alerts.noQuestionsTitle,
                message: T.alerts.noQuestionsEvaluationMessage,
                variant: "warning",
                confirmText: T.common.understood
            });
            return;
        }
    } else {
        const targetSessionLength =
            currentQuizMode === 'evaluation'
                ? (isUxOnlySpecialty(userProfile.especialidad) ? EVALUATION_SESSION_LENGTH_UX_ONLY : EVALUATION_SESSION_LENGTH)
                : SESSION_LENGTH;
        const sessionLimit = Math.min(targetSessionLength, questions.length);
        currentSession = shuffleArray(questions).slice(0, sessionLimit);
    }

    // Inicializar bolsa de imágenes para descansos (1–8) y mezclar para evitar repeticiones
    breakImages = [1, 2, 3, 4, 5, 6, 7, 8].sort(() => Math.random() - 0.5);

    startTime = new Date(); // Iniciar cronómetro
    currentIndex = 0;
    score = 0;
    streak = 0;
    document.getElementById('streak-counter').innerText = 0;
    stopSparkEngine();
    const flame = document.getElementById('streak-flame');
    flame.className = 'fas fa-fire streak-icon';
    flame.classList.remove('flame-sparking', 'snowflake-in');
    document.getElementById('streak-area').classList.remove('streak-area--active');
    errors = [];
    isEvaluationSessionActive = isEvaluationMode();

    // Resetear barra de nivel instantáneamente
    const levelBar = document.getElementById('level-progress-bar');
    if (levelBar) {
        levelBar.style.transition = 'none';
        levelBar.style.height = '0%';
    }

    switchSection('quiz-interface', () => {
        document.getElementById('main-header').classList.remove('hidden');
        loadQuestion();
    });
}

function restartDirectly() {
    startQuiz();
}

function returnToDashboard() {
    isEvaluationSessionActive = false;
    switchSection('landing-page', () => {
        // Restablecer vistas dentro de landing page a dashboard (Perfil)
        document.getElementById('dashboard-view')?.classList.add('hidden');
        document.getElementById('mode-selection-view').classList.add('hidden');
        document.getElementById('evaluation-brief-view')?.classList.add('hidden');
        document.getElementById('pills-construction-view')?.classList.add('hidden');
        document.getElementById('pills-quiz-interface')?.classList.add('hidden');
        document.getElementById('talents-view')?.classList.add('hidden');
        
        document.getElementById('auth-card').classList.add('hidden'); // Changed to hide
        document.getElementById('login-view').classList.add('hidden');
        document.getElementById('profile-view').classList.remove('hidden');
        window.setRoute('/');

        // La Navbar (main-header) se mantiene visible en el dashboard
        document.getElementById('main-header').classList.remove('hidden');

        document.getElementById('feedback-panel').classList.add('hidden');
        document.getElementById('feedback-overlay').classList.add('hidden');
        updatePoolCount();
    });
}

function updateHeaderBackButton() {
    const btn = document.getElementById('btn-back-header');
    const header = document.getElementById('main-header');
    if (!btn || !header) return;

    if (header.classList.contains('hidden')) {
        btn.classList.add('hidden');
        btn.onclick = null;
        return;
    }

    const isQuizActive =
        !document.getElementById('quiz-interface')?.classList.contains('hidden') ||
        !document.getElementById('pills-quiz-interface')?.classList.contains('hidden') ||
        !document.getElementById('break-screen')?.classList.contains('hidden');

    if (isQuizActive) {
        btn.classList.remove('hidden');
        btn.onclick = () => backToTopicSelection();
        btn.title = 'Volver al tablero';
        btn.setAttribute('aria-label', 'Volver al tablero');
        return;
    }

    const isResultsActive = !document.getElementById('results-screen')?.classList.contains('hidden');
    if (isResultsActive) {
        btn.classList.remove('hidden');
        btn.onclick = () => handleHeaderClick();
        btn.title = 'Volver al inicio';
        btn.setAttribute('aria-label', 'Volver al inicio');
        return;
    }

    const isFormadorActive = !document.getElementById('formador-interface')?.classList.contains('hidden');
    if (isFormadorActive) {
        btn.classList.remove('hidden');
        btn.onclick = () => formadorBackToBrief();
        btn.title = 'Volver a la evaluación';
        btn.setAttribute('aria-label', 'Volver a la evaluación');
        return;
    }

    const landingVisible = !document.getElementById('landing-page')?.classList.contains('hidden');
    if (!landingVisible) {
        btn.classList.add('hidden');
        btn.onclick = null;
        return;
    }

    const profileVisible = !document.getElementById('profile-view')?.classList.contains('hidden');
    if (profileVisible) {
        btn.classList.add('hidden');
        btn.onclick = null;
        return;
    }

    const talentsVisible = !document.getElementById('talents-view')?.classList.contains('hidden');
    if (talentsVisible) {
        btn.classList.remove('hidden');
        btn.onclick = () => backFromTalentsView();
        btn.title = 'Volver al perfil';
        btn.setAttribute('aria-label', 'Volver al perfil');
        return;
    }

    const subViewVisible =
        !document.getElementById('dashboard-view')?.classList.contains('hidden') ||
        !document.getElementById('evaluation-brief-view')?.classList.contains('hidden') ||
        !document.getElementById('pills-construction-view')?.classList.contains('hidden');

    if (subViewVisible) {
        btn.classList.remove('hidden');
        btn.onclick = () => backToModes();
        btn.title = 'Volver';
        btn.setAttribute('aria-label', 'Volver');
        return;
    }

    btn.classList.add('hidden');
    btn.onclick = null;
}

window.backToTopicSelection = async function() {
    const isQuizActive = !document.getElementById('quiz-interface').classList.contains('hidden') ||
        !document.getElementById('pills-quiz-interface').classList.contains('hidden') ||
        !document.getElementById('break-screen').classList.contains('hidden');

    if (isQuizActive) {
        const shouldLeave = await showAppConfirm({
            title: T.alerts.abandonSessionTitle,
            message: T.alerts.abandonSessionMessage,
            confirmText: T.common.yesExit,
            cancelText: T.alerts.confirmStayPractice,
            variant: "warning"
        });
        if (!shouldLeave) {
            return;
        }
    }
    
    isEvaluationSessionActive = false;
    returnToDashboard();
}

async function handleHeaderClick() {
    const isQuizActive = !document.getElementById('quiz-interface').classList.contains('hidden') ||
        !document.getElementById('pills-quiz-interface').classList.contains('hidden') ||
        !document.getElementById('break-screen').classList.contains('hidden');

    if (isQuizActive) {
        const shouldLeave = await showAppConfirm({
            title: T.alerts.exitTestTitle,
            message: T.alerts.exitTestMessage,
            confirmText: T.common.yesBackToMenu,
            cancelText: T.alerts.confirmStayTest,
            variant: "warning"
        });
        if (shouldLeave) {
            isEvaluationSessionActive = false;
            returnToDashboard();
        }
    } else {
        isEvaluationSessionActive = false;
        returnToDashboard();
    }
}

function loadQuestion() {
    window.scrollTo(0, 0);
    const q = currentSession[currentIndex];
    document.getElementById('current-q-num').innerText = currentIndex + 1;
    const qTotal = document.getElementById('q-total');
    if (qTotal) qTotal.innerText = `/${currentSession.length}`;

    const badge = document.getElementById('topic-badge');
    const seniorityLabel =
        formatSeniorityLabel(q.seniority) || (q.seniorityRaw ? String(q.seniorityRaw).trim() : '');
    const shouldShowSeniority = currentQuizMode === 'evaluation' && seniorityLabel;
    badge.innerText = shouldShowSeniority ? `${q.category} • ${seniorityLabel}` : q.category;

    const categoryClass = {
        "UX Writing": "badge--ux-writing",
        "UX Research": "badge--ux-research",
        "UX Researcher": "badge--ux-research",
        "UI Design": "badge--ui-design",
        "Product Strategy": "badge--product-strategy",
        "Casos Prácticos": "badge--casos-practicos"
    };
    const badgeMod =
        categoryClass[q.category] ||
        (isUiDesignCategory(q.category) ? 'badge--ui-design' : '') ||
        (isUxResearchFamilyLabel(q.category) ? 'badge--ux-research' : '');
    badge.className = `topic-badge ${badgeMod}`;

    document.getElementById('question-text').innerText = q.question;

    const container = document.getElementById('options-container');
    container.innerHTML = '';
    container.style.pointerEvents = 'auto';

    q.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = "btn-option";
        const span = document.createElement('span');
        span.className = 'option-text';
        span.textContent = opt.text;
        btn.appendChild(span);
        btn.onclick = () => handleAnswer(opt.correct, btn);
        container.appendChild(btn);
    });

    document.getElementById('btn-dont-know').classList.remove('hidden');
    document.getElementById('feedback-panel').classList.add('hidden');
    document.getElementById('feedback-overlay').classList.add('hidden');
    const nextBtn = document.getElementById('btn-next-question');
    if (nextBtn) nextBtn.innerText = T.feedback.next;

    resetQuestionTimer();
}

function handleDontKnow() {
    handleAnswer(false, null, false);
}

function handleAnswer(isCorrect, btn, isTimeout = false) {
    const feedbackOpen = document.getElementById('feedback-panel');
    if (feedbackOpen && !feedbackOpen.classList.contains('hidden')) return;

    stopQuestionTimer();
    const container = document.getElementById('options-container');
    container.style.pointerEvents = 'none';
    document.getElementById('btn-dont-know').classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const q = currentSession[currentIndex];

    if (isCorrect) {
        score++;
        streak++;
        checkStreakBonus();
        if (btn) btn.classList.add('option-correct');
        showFeedback(true, q, false);
    } else {
        streak = 0;
        errors.push(q);
        if (btn) btn.classList.add('option-wrong');
        highlightCorrect(q);
        showFeedback(false, q, isTimeout);
    }
    updateStreakUI();
}

function highlightCorrect(q) {
    const buttons = document.querySelectorAll('.btn-option');
    buttons.forEach((b, idx) => {
        if (q.options[idx].correct) b.classList.add('option-correct');
    });
}

function showFeedback(isCorrect, q, isTimeout = false) {
    const panel = document.getElementById('feedback-panel');
    const overlay = document.getElementById('feedback-overlay');
    const title = document.getElementById('feedback-title');
    const msg = document.getElementById('feedback-msg');
    const icon = document.getElementById('feedback-icon');
    const tipBox = document.getElementById('study-tip-box');
    const nextBtn = document.getElementById('btn-next-question');

    panel.classList.remove('hidden');
    overlay.classList.remove('hidden');
    // Fade in overlay
    setTimeout(() => overlay.classList.remove('opacity-0'), 10);

    panel.classList.remove('animate-slide-up');
    void panel.offsetWidth; // Forzar reflow para reiniciar animación
    panel.classList.add('animate-slide-up');

    if (isCorrect) {
        panel.className = "feedback-panel feedback-panel--correct animate-slide-up";
        title.innerText = T.feedback.correct;
        title.className = "feedback-title-text feedback-title--correct";
        icon.innerHTML = '<i class="fas fa-check-circle icon-feedback-correct"></i>';
        tipBox.classList.add('hidden');
        msg.innerText = q.explanation;
        if (nextBtn) nextBtn.innerText = T.feedback.next;
    } else {
        panel.className = "feedback-panel feedback-panel--wrong animate-slide-up";
        title.innerText = isTimeout ? T.feedback.timeUpTitle : T.feedback.incorrectTitle;
        title.className = "feedback-title-text feedback-title--wrong";
        icon.innerHTML = '<i class="fas fa-exclamation-triangle icon-feedback-wrong"></i>';
        tipBox.classList.add('hidden');

        const correctOpt = q.options.find(o => o.correct);
        if (isTimeout) {
            msg.innerHTML = T.feedback.timeUpMessage(esc(correctOpt ? correctOpt.text : ''), esc(q.explanation || ''));
            if (nextBtn) nextBtn.innerText = T.feedback.nextQuestion;
        } else {
            msg.innerHTML = T.feedback.wrongMessage(esc(correctOpt ? correctOpt.text : ''), esc(q.explanation || ''));
            if (nextBtn) nextBtn.innerText = T.feedback.next;
        }
    }

    focusFeedbackNextButton();
}

function focusFeedbackNextButton() {
    const nextBtn = document.getElementById('btn-next-question');
    const ae = document.activeElement;
    if (ae instanceof HTMLElement) {
        if (ae.closest('#options-container')) ae.blur();
        if (ae.closest('#pills-quiz-interface')) ae.blur();
    }
    nextBtn?.focus({ preventScroll: true });
}

// ===== MOTOR DE PARTÍCULAS (Canvas, ~0KB extra) =====
let sparkAnimId = null;
let sparkParticles = [];
let previousStreak = 0; // Para detectar cuando se pierde la racha

function startSparkEngine() {
    if (sparkAnimId) return; // Ya está corriendo
    const canvas = document.getElementById('spark-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = 68;
    canvas.height = 68;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 + 4;
    const colors = ['#f97316', '#fbbf24', '#fcd34d'];

    function spawnParticle() {
        const angle = -40 - Math.random() * 100; // Más centrado hacia arriba
        const speed = 0.2 + Math.random() * 0.5; // Mucho más lento
        const rad = (angle * Math.PI) / 180;
        sparkParticles.push({
            x: cx + (Math.random() - 0.5) * 4,
            y: cy - 2,
            vx: Math.cos(rad) * speed,
            vy: Math.sin(rad) * speed,
            life: 1,
            decay: 0.008 + Math.random() * 0.012, // Duran más
            size: 1 + Math.random() * 1.5, // Más pequeñas
            color: colors[Math.floor(Math.random() * colors.length)]
        });
    }

    function loop() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Emitir partículas muy esporádicamente
        if (Math.random() < 0.06) spawnParticle();
        if (streak >= 7 && Math.random() < 0.04) spawnParticle();

        for (let i = sparkParticles.length - 1; i >= 0; i--) {
            const p = sparkParticles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy -= 0.008; // Flotan suavemente
            p.life -= p.decay;

            if (p.life <= 0) {
                sparkParticles.splice(i, 1);
                continue;
            }

            ctx.save();
            ctx.globalAlpha = p.life * 0.7; // Más transparentes
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 3 * p.life;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        sparkAnimId = requestAnimationFrame(loop);
    }
    loop();
}

function stopSparkEngine() {
    if (sparkAnimId) {
        cancelAnimationFrame(sparkAnimId);
        sparkAnimId = null;
    }
    sparkParticles = [];
    const canvas = document.getElementById('spark-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

function emitIceShatter() {
    const wrapper = document.getElementById('streak-icon-wrapper');
    // Crear fragmentos de hielo que salen volando
    const shardCount = 8;
    const shardColors = ['#93c5fd', '#60a5fa', '#bfdbfe', '#dbeafe', '#3b82f6'];
    for (let i = 0; i < shardCount; i++) {
        const shard = document.createElement('div');
        shard.classList.add('ice-shard');

        // Triángulo SVG como fragmento de hielo
        const size = 5 + Math.random() * 7;
        const color = shardColors[Math.floor(Math.random() * shardColors.length)];
        shard.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 10 10"><polygon points="5,0 10,8 0,8" fill="${color}" opacity="0.9"/></svg>`;

        // Dirección aleatoria 360°
        const angle = Math.random() * 360;
        const distance = 18 + Math.random() * 25;
        const rad = (angle * Math.PI) / 180;
        shard.style.setProperty('--ix', `${Math.cos(rad) * distance}px`);
        shard.style.setProperty('--iy', `${Math.sin(rad) * distance}px`);
        shard.style.setProperty('--ir', `${-180 + Math.random() * 360}deg`);
        shard.style.left = '50%';
        shard.style.top = '50%';
        shard.style.marginLeft = `-${size / 2}px`;
        shard.style.marginTop = `-${size / 2}px`;

        wrapper.appendChild(shard);
        setTimeout(() => shard.remove(), 700);
    }
}

function updateStreakUI() {
    document.getElementById('streak-counter').innerText = streak;
    const flame = document.getElementById('streak-flame');
    const area = document.getElementById('streak-area');

    if (streak === 0 && previousStreak >= 5) {
        // === PERDIÓ RACHA DE 5+: hielo rompiéndose + sonido ===
        stopSparkEngine();
        emitIceShatter();
        playIceSound();

        flame.className = 'fas fa-snowflake streak-icon snowflake-in';
        area.classList.remove('streak-area--active');

    } else if (streak === 0 && previousStreak > 0) {
        // === PERDIÓ RACHA menor a 5: solo visual, sin sonido de hielo ===
        stopSparkEngine();
        flame.className = 'fas fa-snowflake streak-icon snowflake-in';
        area.classList.remove('streak-area--active');

    } else if (streak === 0) {
        // Sin racha (estado neutral)
        stopSparkEngine();
        flame.className = 'fas fa-fire streak-icon';
        area.classList.remove('streak-area--active');

    } else if (streak >= 5) {
        // Racha 5+ → fuego intenso con sparks sutiles
        flame.className = 'fas fa-fire streak-icon flame-sparking';
        area.classList.add('streak-area--active');
        startSparkEngine();

        // Sonido de chispas al ACTIVAR la racha de 5 por primera vez
        if (previousStreak < 5 && streak === 5) {
            playSparkSound();
        }

    } else {
        // Racha 1-4 → fuego normal con pulse, sin sparks
        stopSparkEngine();
        flame.className = 'fas fa-fire streak-icon animate-pulse';
        area.classList.add('streak-area--active');
    }

    previousStreak = streak;
}

// === SONIDO DE CHISPAS CREPITANTES al activar racha de 5 (3s, 50% vol, fade-out) ===
function playSparkSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const t = audioCtx.currentTime;
        const duration = 3;
        const sr = audioCtx.sampleRate;
        const masterVol = 0.5; // 50% volumen

        // --- Capa 1: Crackles/pops irregulares (el sonido principal) ---
        const crklBuf = audioCtx.createBuffer(1, sr * duration, sr);
        const crklData = crklBuf.getChannelData(0);
        for (let i = 0; i < crklData.length; i++) {
            // Pops de distinta intensidad a intervalos aleatorios
            const r = Math.random();
            if (r < 0.003) crklData[i] = (Math.random() * 2 - 1) * 0.7;       // Pop fuerte
            else if (r < 0.012) crklData[i] = (Math.random() * 2 - 1) * 0.3;   // Pop medio
            else if (r < 0.04) crklData[i] = (Math.random() * 2 - 1) * 0.08;   // Micro snap
            else crklData[i] = (Math.random() * 2 - 1) * 0.01;                  // Ruido base sutil
        }
        const crklSrc = audioCtx.createBufferSource();
        crklSrc.buffer = crklBuf;

        // Filtro bandpass para que suene a madera quemándose
        const crklBP = audioCtx.createBiquadFilter();
        crklBP.type = 'bandpass';
        crklBP.frequency.value = 2800;
        crklBP.Q.value = 0.4;

        // Fade-in rápido + mantener + fade-out suave
        const crklGain = audioCtx.createGain();
        crklGain.gain.setValueAtTime(0, t);
        crklGain.gain.linearRampToValueAtTime(0.25 * masterVol, t + 0.15);
        crklGain.gain.setValueAtTime(0.25 * masterVol, t + 1.5);
        crklGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

        crklSrc.connect(crklBP).connect(crklGain).connect(audioCtx.destination);

        // --- Capa 2: Rumble cálido bajo (brasa) ---
        const warmBuf = audioCtx.createBuffer(1, sr * duration, sr);
        const warmData = warmBuf.getChannelData(0);
        for (let i = 0; i < warmData.length; i++) {
            warmData[i] = (Math.random() * 2 - 1);
        }
        const warmSrc = audioCtx.createBufferSource();
        warmSrc.buffer = warmBuf;
        const warmLP = audioCtx.createBiquadFilter();
        warmLP.type = 'lowpass';
        warmLP.frequency.value = 180;
        const warmGain = audioCtx.createGain();
        warmGain.gain.setValueAtTime(0, t);
        warmGain.gain.linearRampToValueAtTime(0.1 * masterVol, t + 0.3);
        warmGain.gain.setValueAtTime(0.1 * masterVol, t + 1.5);
        warmGain.gain.exponentialRampToValueAtTime(0.001, t + duration);
        warmSrc.connect(warmLP).connect(warmGain).connect(audioCtx.destination);

        crklSrc.start(t);
        crklSrc.stop(t + duration);
        warmSrc.start(t);
        warmSrc.stop(t + duration);

        setTimeout(() => audioCtx.close(), (duration + 0.5) * 1000);
    } catch (e) { }
}

// === SONIDO DE HIELO REALISTA (Web Audio API, sin archivos) ===
function playIceSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const t = audioCtx.currentTime;

        // --- CAPA 1: Crack inicial (impacto corto y seco) ---
        const crackDur = 0.08;
        const crackBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * crackDur, audioCtx.sampleRate);
        const crackData = crackBuf.getChannelData(0);
        for (let i = 0; i < crackData.length; i++) {
            const n = i / crackData.length;
            crackData[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, 8) * 0.6;
        }
        const crackSrc = audioCtx.createBufferSource();
        crackSrc.buffer = crackBuf;
        const crackBP = audioCtx.createBiquadFilter();
        crackBP.type = 'bandpass';
        crackBP.frequency.value = 4500;
        crackBP.Q.value = 1.5;
        const crackGain = audioCtx.createGain();
        crackGain.gain.value = 0.5;
        crackSrc.connect(crackBP).connect(crackGain).connect(audioCtx.destination);
        crackSrc.start(t);

        // --- CAPA 2: Tinkle (fragmentos cayendo, tono agudo resonante) ---
        [5200, 3800, 6500].forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq;
            const g = audioCtx.createGain();
            const start = t + 0.02 + idx * 0.04;
            g.gain.setValueAtTime(0, start);
            g.gain.linearRampToValueAtTime(0.06, start + 0.005);
            g.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
            osc.connect(g).connect(audioCtx.destination);
            osc.start(start);
            osc.stop(start + 0.15);
        });

        // --- CAPA 3: Crujido (ruido filtrado más largo, como grietas) ---
        const crunchDur = 0.3;
        const crunchBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * crunchDur, audioCtx.sampleRate);
        const crunchData = crunchBuf.getChannelData(0);
        for (let i = 0; i < crunchData.length; i++) {
            const n = i / crunchData.length;
            // Ruido con "pops" irregulares simulando microfracturas
            const pop = Math.random() < 0.03 ? (Math.random() * 2 - 1) * 0.8 : 0;
            crunchData[i] = ((Math.random() * 2 - 1) * 0.15 + pop) * Math.pow(1 - n, 2);
        }
        const crunchSrc = audioCtx.createBufferSource();
        crunchSrc.buffer = crunchBuf;
        const crunchHP = audioCtx.createBiquadFilter();
        crunchHP.type = 'highpass';
        crunchHP.frequency.value = 2000;
        const crunchLP = audioCtx.createBiquadFilter();
        crunchLP.type = 'lowpass';
        crunchLP.frequency.value = 7000;
        const crunchGain = audioCtx.createGain();
        crunchGain.gain.value = 0.35;
        crunchSrc.connect(crunchHP).connect(crunchLP).connect(crunchGain).connect(audioCtx.destination);
        crunchSrc.start(t + 0.01);

        setTimeout(() => audioCtx.close(), 600);
    } catch (e) { }
}

function checkStreakBonus() {
    if (streak > 0 && streak % 5 === 0) {
        const toast = document.getElementById('streak-toast');
        if (!toast) return; // Protección: Si no existe el toast, salimos sin romper la app
        document.getElementById('streak-msg-sub').innerText = T.quiz.streakSeguidas(streak);
        toast.style.opacity = '1';
        toast.style.transform = 'translate(-50%, 20px)';
        confetti({ particleCount: 50, spread: 60, origin: { y: 0.2 } });
        setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translate(-50%, -20px)'; }, 2500);
    }
}

function nextQuestion() {
    currentIndex++;
    if (currentIndex < currentSession.length) {
        if (currentQuizMode === 'pills') {
            document.getElementById('feedback-panel').classList.add('hidden');
            document.getElementById('feedback-overlay').classList.add('hidden');
            document.getElementById('feedback-overlay').classList.add('opacity-0');
            loadPillsQuestion();
            return;
        }
        // Descanso cada 5 preguntas (5, 10, 15...)
        if (currentIndex > 0 && currentIndex % 5 === 0) {
            document.getElementById('feedback-panel').classList.add('hidden');
            document.getElementById('feedback-overlay').classList.add('hidden');
            document.getElementById('feedback-overlay').classList.add('opacity-0');
            showBreakScreen();
        } else {
            // Transición suave entre preguntas
            const qContent = document.getElementById('question-content');
            const qHeader = document.getElementById('sticky-question-header');
            const feedback = document.getElementById('feedback-panel');
            const overlay = document.getElementById('feedback-overlay');

            qContent.classList.add('animate-fade-out');
            qHeader.classList.add('animate-fade-out');
            feedback.classList.add('animate-fade-out');
            overlay.classList.add('opacity-0');

            setTimeout(() => {
                loadQuestion();
                qContent.classList.remove('animate-fade-out');
                qHeader.classList.remove('animate-fade-out');
                feedback.classList.remove('animate-fade-out');
                feedback.classList.add('hidden');
                overlay.classList.add('hidden');
                qContent.classList.add('animate-fade-in');
                qHeader.classList.add('animate-fade-in');
            }, 300);
        }
    }
    else {
        document.getElementById('feedback-panel').classList.add('hidden');
        document.getElementById('feedback-overlay').classList.add('hidden');
        document.getElementById('feedback-overlay').classList.add('opacity-0');
        showResults();
    }
}

function isEvaluationMode() {
    return currentQuizMode === 'evaluation';
}

function getEvalViolationStorageKey() {
    const uid = supabaseSession?.user?.id || userEmail || 'anon';
    return `${EVAL_VIOLATION_STORAGE_PREFIX}:${uid}`;
}

function getEvalViolationCount() {
    const raw = localStorage.getItem(getEvalViolationStorageKey());
    const parsed = Number.parseInt(raw || '0', 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function isEvaluationHardBlocked() {
    // Test Mode: sin bloqueo por intentos (previsualización).
    if (isTestModeActive()) return false;
    return ENABLE_EVAL_HARD_BLOCK && getEvalViolationCount() >= 3;
}

function setEvalViolationCount(count) {
    localStorage.setItem(getEvalViolationStorageKey(), String(Math.max(0, count)));
}

function isEvaluationFlowVisible() {
    const quizVisible = !document.getElementById('quiz-interface').classList.contains('hidden');
    const breakVisible = !document.getElementById('break-screen').classList.contains('hidden');
    return quizVisible || breakVisible;
}

async function handleEvaluationViolation(reason = 'focus_lost') {
    // Test Mode: no se cuentan violaciones ni se expulsa (previsualización).
    if (isTestModeActive()) return;
    if (!isEvaluationMode() || !isEvaluationSessionActive || !isEvaluationFlowVisible()) return;
    if (isHandlingEvalViolation) return;

    const now = Date.now();
    if (now - lastEvalViolationAt < EVAL_FOCUS_EVENT_DEBOUNCE_MS) return;
    lastEvalViolationAt = now;
    isHandlingEvalViolation = true;

    const nextCount = getEvalViolationCount() + 1;
    setEvalViolationCount(nextCount);

    // Punto de integración para backend (Supabase): registrar reason, timestamp y count.
    if (DEBUG) {
        debugWarn('[anti-cheat] evaluation violation detected:', { reason, count: nextCount });
    }

    stopQuestionTimer();
    isEvaluationSessionActive = false;
    currentSession = [];
    questions = [];
    currentIndex = 0;

    const feedbackPanel = document.getElementById('feedback-panel');
    const feedbackOverlay = document.getElementById('feedback-overlay');
    if (feedbackPanel) feedbackPanel.classList.add('hidden');
    if (feedbackOverlay) {
        feedbackOverlay.classList.add('hidden');
        feedbackOverlay.classList.add('opacity-0');
    }

    returnToDashboard();

    let title = "";
    let message = "";
    let variant = "";

    if (nextCount === 1) {
        title = T.evaluation.violation1Title;
        message = T.evaluation.violation1Message;
        variant = "warning";
    } else if (nextCount === 2) {
        title = T.evaluation.violation2Title;
        message = T.evaluation.violation2Message;
        variant = "warning";
    } else {
        title = T.evaluation.violation3Title;
        message = T.evaluation.violation3Message;
        variant = "error";
    }

    setTimeout(async () => {
        await showAppAlert({ title, message, variant, confirmText: T.common.understood });
        isHandlingEvalViolation = false;
    }, 320);
}

function updateTimerVisibility() {
    const timerEl = document.getElementById('evaluation-timer');
    if (!timerEl) return;
    if (isEvaluationMode()) {
        timerEl.classList.remove('hidden');
    } else {
        timerEl.classList.add('hidden');
    }
}

function updateTimerUI() {
    const timerEl = document.getElementById('evaluation-timer');
    const timerValueEl = document.getElementById('evaluation-timer-value');
    if (!timerEl || !timerValueEl) return;

    timerValueEl.innerText = T.quiz.timerSeconds(evaluationTimeLeft);
    if (evaluationTimeLeft <= 2) timerEl.classList.add('quiz-timer--warning');
    else timerEl.classList.remove('quiz-timer--warning');
}

function stopQuestionTimer() {
    if (evaluationTimerId) {
        clearInterval(evaluationTimerId);
        evaluationTimerId = null;
    }
}

function resetQuestionTimer() {
    stopQuestionTimer();
    updateTimerVisibility();

    if (!isEvaluationMode()) return;

    evaluationTimeLeft = EVALUATION_QUESTION_TIME;
    updateTimerUI();

    evaluationTimerId = setInterval(() => {
        evaluationTimeLeft -= 1;
        updateTimerUI();

        if (evaluationTimeLeft <= 0) {
            stopQuestionTimer();
            const dontKnowBtn = document.getElementById('btn-dont-know');
            if (!dontKnowBtn || dontKnowBtn.classList.contains('hidden')) return;
            handleAnswer(false, null, true);
        }
    }, 1000);
}

function getBreakMessages() {
    const name = userProfile.nickname || (userName || '').split(' ')[0] || "campeón";
    return [
        { title: `¡Bien hecho ${name}!`, msg: "Ya has completado el primer bloque. Respira y seguimos." },
        { title: `¡Vas increíble ${name}!`, msg: "Has llegado al 50% de la prueba. Mantén el enfoque." },
        { title: `¡Último esfuerzo ${name}!`, msg: "Solo queda un bloque más. ¡Tú puedes con esto!" }
    ];
}

function showBreakScreen() {
    window.scrollTo(0, 0);

    const fallbackName = userProfile.nickname || (userName || '').split(' ')[0] || "campeón";
    const messages = getBreakMessages();
    const breakIndex = (currentIndex / 5) - 1;
    const content = messages[breakIndex] || { title: `¡Sigue así ${fallbackName}!`, msg: "Tómate un momento para recargar energía." };

    document.getElementById('break-title').innerText = content.title;
    document.getElementById('break-message').innerText = content.msg;

    // Obtener siguiente imagen única de la bolsa
    let imgNum = breakImages.pop();
    // Si se acaban (raro en sesión corta), rellenar o elegir random
    if (!imgNum) imgNum = Math.floor(Math.random() * 8) + 1;

    document.getElementById('break-image').src = MATERIAL.breakWebp(imgNum);

    switchSection('break-screen');
}

function continueFromBreak() {
    switchSection('quiz-interface', () => loadQuestion());
}

// --- FUNCIONES DE RANKING ---
/**
 * Pills en `ranking_user`: solo la última pill publicada (`getLatestPublishedPill`),
 * solo el primer intento cuenta (pillsPoints + pillsRankPillId + pillsRankTiempo).
 * Nueva pill → otros pillsRankPillId no entran en el query; efecto “reset” semanal.
 */
async function fetchLatestPillRankingRows(limitN = 10) {
    if (!supabase) return [];
    const latest = getLatestPublishedPill();
    if (!latest?.id) return [];
    const pillId = latest.id;
    try {
        const { data: scoresData, error } = await supabase
            .from('user_scores')
            .select('user_id, pills_points, pills_rank_tiempo')
            .eq('pills_rank_pill_id', pillId)
            .limit(80);
        if (error) throw error;
        const scoreUserIds = (scoresData || []).map(d => d.user_id).filter(Boolean);
        let pillUserInfoMap = new Map();
        if (scoreUserIds.length > 0) {
            const { data: userInfoData } = await supabase
                .from('ranking_user')
                .select('user_id, email, nombre')
                .in('user_id', scoreUserIds);
            (userInfoData || []).forEach(u => pillUserInfoMap.set(String(u.user_id), u));
        }
        const rows = (scoresData || []).map(d => {
            const info = pillUserInfoMap.get(String(d.user_id)) || {};
            return {
                id: info.email || d.user_id,
                email: info.email || '',
                nombre: info.nombre || '',
                pillsPoints: d.pills_points,
                pillsRankTiempo: d.pills_rank_tiempo
            };
        });
        rows.sort((a, b) => {
            const pd = Number(b.pillsPoints || 0) - Number(a.pillsPoints || 0);
            if (pd !== 0) return pd;
            return Number(a.pillsRankTiempo ?? 999999999) - Number(b.pillsRankTiempo ?? 999999999);
        });
        return rows.slice(0, limitN);
    } catch (e) {
        debugWarn('fetchLatestPillRankingRows', e);
        throw e;
    }
}

async function saveScoreToCloud(finalScore, timeSeconds) {
    // Test Mode: solo preview, no se persisten puntajes ni resultados.
    if (isTestModeActive()) { debugWarn('saveScoreToCloud: omitido por Test Mode'); return false; }
    if (!supabase || !userEmail) return false;

    const pointsFieldByMode = {
        practice: 'quest_points',
        evaluation: 'tests_points_q2',
        pills: 'pills_points'
    };
    const pointsField = pointsFieldByMode[currentQuizMode] || 'quest_points';
    const profileFieldByMode = {
        practice: 'questPoints',
        evaluation: 'testsPoints',
        pills: 'pillsPoints'
    };
    const profileField = profileFieldByMode[currentQuizMode] || 'questPoints';
    let userId = supabaseSession?.user?.id || '';

    if (!userId) {
        const { data: authData } = await supabase.auth.getUser();
        userId = authData?.user?.id || '';
    }
    if (!userId) {
        if (DEBUG) debugWarn('saveScoreToCloud: no auth user id available');
        return false;
    }

    try {
        let existingPillAttempt = null;
        let hasValidExistingPillAttempt = false;
        let isPillFirstAttempt = true;
        let pillAttemptQueryFailed = false;
        const currentPillScore = Number(finalScore || 0);
        const currentPillAttemptQualifies = currentPillScore > 0;
        const selectedPill = currentQuizMode === 'pills'
            ? pillsCatalog.find((p) => String(p.id || '') === String(selectedPillId || ''))
            : null;
        const sealWindowState = getPillSealWindowState(selectedPill);
        const canAwardSealByTime = !sealWindowState.isExpired;
        if (currentQuizMode === 'pills' && selectedPillId) {
            let firstAttemptRow = null;
            let firstAttemptErr = null;
            ({ data: firstAttemptRow, error: firstAttemptErr } = await supabase
                .from('user_pill_scores')
                .select('pill_id, score, total, errors, sticker_granted')
                .eq('user_id', userId)
                .eq('pill_id', selectedPillId)
                .maybeSingle());
            if (firstAttemptErr) {
                // Fallback legado sin columnas nuevas.
                ({ data: firstAttemptRow, error: firstAttemptErr } = await supabase
                    .from('user_pill_scores')
                    .select('pill_id, score, total')
                    .eq('user_id', userId)
                    .eq('pill_id', selectedPillId)
                    .maybeSingle());
            }
            if (firstAttemptErr) {
                // No bloquear guardado en ranking_user por errores de tabla auxiliar.
                pillAttemptQueryFailed = true;
                if (DEBUG) debugWarn('saveScoreToCloud: pill attempt lookup fallback failed', firstAttemptErr);
            }
            existingPillAttempt = firstAttemptRow || null;
            hasValidExistingPillAttempt = isValidPillFirstAttemptRow(existingPillAttempt);
            if (hasValidExistingPillAttempt) isPillFirstAttempt = false;
        }

        // Leer ranking actual
        const [{ data: rankingData }, { data: scoresData }] = await Promise.all([
            supabase.from('ranking_user').select('user_id, nombre, email, seniority, especialidad, formador').eq('email', userEmail.toLowerCase()).single(),
            supabase.from('user_scores').select('quest_points, tests_points_q2, pills_points, pills_rank_pill_id, pills_rank_tiempo, puntos, tiempo, fecha').eq('user_id', userId).maybeSingle(),
        ]);
        const existing = { ...(rankingData || {}), ...(scoresData || {}) };

        const latestPill = getLatestPublishedPill();
        const isLatestPillSession =
            currentQuizMode === 'pills' && latestPill && selectedPillId === latestPill.id;
        const rankingHasValidPillScore = Number(existing.pills_points || 0) > 0;
        const pillsRankingLockedByRanking =
            isLatestPillSession &&
            rankingHasValidPillScore &&
            String(existing.pills_rank_pill_id || '') === String(selectedPillId);
        if (pillsRankingLockedByRanking) isPillFirstAttempt = false;
        const pillsRankingLocked =
            currentQuizMode === 'pills' && selectedPillId && (pillsRankingLockedByRanking || !isPillFirstAttempt);

        const rankingMerge = {
            user_id: userId,
            nombre: userName,
            email: userEmail.toLowerCase(),
        };
        const scoresMerge = {
            user_id: userId,
            fecha: new Date().toISOString(),
        };
        let shouldUpdate = false;

        if (currentQuizMode === 'practice') {
            const cur = Number(existing.quest_points || 0);
            const next = Number(finalScore || 0);
            scoresMerge.quest_points = Math.max(cur, next);
            shouldUpdate = next > cur;
        } else if (currentQuizMode === 'evaluation') {
            const isFirstEvalAttempt = existing.tests_points_q2 == null;
            if (isFirstEvalAttempt) {
                scoresMerge.tests_points_q2 = Number(finalScore || 0);
            }
        } else if (currentQuizMode === 'pills') {
            if (isLatestPillSession && !pillsRankingLockedByRanking && currentPillAttemptQualifies) {
                scoresMerge.pills_points = currentPillScore;
                scoresMerge.pills_rank_pill_id = selectedPillId;
                scoresMerge.pills_rank_tiempo = Number(timeSeconds || 0);
            }
        } else {
            const cur = Number(existing[pointsField] || 0);
            scoresMerge[pointsField] = Math.max(cur, Number(finalScore || 0));
        }

        const { error: rankingUpsertError } = await supabase
            .from('ranking_user')
            .upsert(rankingMerge, { onConflict: 'email' });
        if (rankingUpsertError) throw rankingUpsertError;

        const { error: scoresUpsertError } = await supabase
            .from('user_scores')
            .upsert(scoresMerge, { onConflict: 'user_id' });
        if (scoresUpsertError) throw scoresUpsertError;

        // Verificación defensiva para práctica: confirmar que quedó persistido el mejor récord.
        if (currentQuizMode === 'practice') {
            const expectedBest = Number(scoresMerge.quest_points || 0);
            const { data: persistedRow, error: persistedReadError } = await supabase
                .from('user_scores')
                .select('quest_points')
                .eq('user_id', userId)
                .single();
            if (persistedReadError) throw persistedReadError;
            const persistedBest = Number(persistedRow?.quest_points || 0);
            if (persistedBest < expectedBest) {
                const { error: forceUpdateError } = await supabase
                    .from('user_scores')
                    .update({ quest_points: expectedBest, fecha: new Date().toISOString() })
                    .eq('user_id', userId);
                if (forceUpdateError) throw forceUpdateError;
            }
        }

        if (currentQuizMode === 'evaluation') {
            const newScore = Number(finalScore || 0);
            const newTime = Number(timeSeconds || 0);
            const isFirstEvalAttempt = existing.tests_points_q2 == null;

            shouldUpdate = isFirstEvalAttempt;

            if (shouldUpdate) {
                const { error: evalLegacyUpsertError } = await supabase.from('user_scores').upsert({
                    user_id: userId,
                    puntos: newScore,
                    tiempo: newTime,
                    fecha: new Date().toISOString()
                }, { onConflict: 'user_id' });
                if (evalLegacyUpsertError) throw evalLegacyUpsertError;

                // Guardar errores en localStorage para que el usuario pueda estudiarlos después
                try {
                    const evalErrorsKey = `uixlingo_eval_errors:${userId}`;
                    const errorsToSave = errors.map(e => ({ question: e.question, studyTag: e.studyTag }));
                    localStorage.setItem(evalErrorsKey, JSON.stringify(errorsToSave));
                } catch (lsErr) {
                    debugWarn('saveScoreToCloud: no se pudieron guardar errores en localStorage', lsErr);
                }

                userProfile.evalCompleted = true;
            }
        }

        // Guardar puntaje por modo en user_profiles
        if (userId) {
            const currentValue = Number(userProfile[profileField] || 0);
            let scoreToSave = currentQuizMode === 'practice'
                ? Math.max(currentValue, Number(finalScore || 0))
                : Number(finalScore || 0);
            if (currentQuizMode === 'pills' && !currentPillAttemptQualifies) {
                scoreToSave = currentValue;
            }
            if (currentQuizMode === 'pills' && pillsRankingLocked) {
                scoreToSave = currentValue;
            }
            // Para evaluación: solo guardar en user_profiles si es el primer intento
            if (currentQuizMode === 'evaluation' && !shouldUpdate) {
                scoreToSave = currentValue;
            }

            const profilePayload = {
                id: userId,
                [pointsField]: scoreToSave,
                seniority: userProfile.seniority,
                nombre: userName,
                email: userEmail
            };

            await supabase.from('user_profiles').upsert(profilePayload, { onConflict: 'id' });

            // Guardar pill scores en tabla separada
            const canPersistFirstAttemptAux =
                currentQuizMode === 'pills' &&
                selectedPillId &&
                currentPillAttemptQualifies &&
                isPillFirstAttempt &&
                !hasValidExistingPillAttempt &&
                !pillAttemptQueryFailed;
            if (canPersistFirstAttemptAux) {
                const totalQs = Math.max(Number(currentSession?.length || 0), 0);
                const errCount = Math.max(totalQs - Number(finalScore || 0), 0);
                const stickerGranted = totalQs > 0 && errCount <= 1 && canAwardSealByTime;
                const pillScore = {
                    user_id: userId,
                    pill_id: selectedPillId,
                    score: Number(finalScore || 0),
                    total: totalQs,
                    errors: errCount,
                    sticker_granted: stickerGranted
                };
                let upsertErr = null;
                ({ error: upsertErr } = await supabase
                    .from('user_pill_scores')
                    .upsert(pillScore, { onConflict: 'user_id,pill_id' }));
                if (upsertErr) {
                    // Fallback legado sin columnas nuevas: guardar score/total para registrar intento.
                    const legacyPillScore = {
                        user_id: userId,
                        pill_id: selectedPillId,
                        score: Number(finalScore || 0),
                        total: totalQs
                    };
                    const { error: legacyErr } = await supabase
                        .from('user_pill_scores')
                        .upsert(legacyPillScore, { onConflict: 'user_id,pill_id' });
                    if (legacyErr) throw legacyErr;
                }
                userProfile.pillScores[selectedPillId] = {
                    score: pillScore.score,
                    total: pillScore.total,
                    errors: pillScore.errors,
                    stickerGranted: pillScore.sticker_granted
                };
            } else if (currentQuizMode === 'pills' && selectedPillId && hasValidExistingPillAttempt && existingPillAttempt) {
                const legacyTotal = Number(existingPillAttempt.total || 0);
                const legacyScore = Number(existingPillAttempt.score || 0);
                const legacyErrors = Math.max(legacyTotal - legacyScore, 0);
                const resolvedErrors =
                    existingPillAttempt.errors === undefined || existingPillAttempt.errors === null
                        ? legacyErrors
                        : Number(existingPillAttempt.errors || 0);
                const resolvedSticker =
                    existingPillAttempt.sticker_granted === undefined || existingPillAttempt.sticker_granted === null
                        ? (legacyTotal > 0 && resolvedErrors <= 1)
                        : Boolean(existingPillAttempt.sticker_granted);
                userProfile.pillScores[selectedPillId] = {
                    score: legacyScore,
                    total: legacyTotal,
                    errors: resolvedErrors,
                    stickerGranted: resolvedSticker
                };
            }

            // Actualizar estado local
            userProfile[profileField] = scoreToSave;
            if (
                currentQuizMode === 'pills' &&
                isLatestPillSession &&
                !pillsRankingLockedByRanking &&
                currentPillAttemptQualifies
            ) {
                userProfile.latestPillRankId = String(selectedPillId || '').trim();
            }
            if (currentQuizMode === 'pills') {
                await loadUserSeals(userId);
            }
            renderProfile();
            updatePracticeRankUI();
        }

        return shouldUpdate;
    } catch (e) {
        debugWarn('saveScoreToCloud error:', e);
    }
    return false;
}

async function openLeaderboard(mode = 'practice') {
    document.getElementById('leaderboard-modal').classList.remove('hidden');
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = T.leaderboard.loading;

    if (!supabase) {
        list.innerHTML = `<div class="leaderboard-error">${esc(T.alerts.supabaseConfigError)}</div>`;
        return;
    }

    try {
        const modalTitleEl = document.querySelector('#leaderboard-modal .modal-title');

        if (mode === 'pills') {
            const latest = getLatestPublishedPill();
            if (modalTitleEl) {
                const pillLabel = latest?.name ? esc(String(latest.name)) : T.leaderboard.pillCurrent;
                modalTitleEl.innerHTML = T.fmt.leaderboardPillTitle(pillLabel);
            }
            const users = await fetchLatestPillRankingRows(50);
            list.innerHTML = '';
            if (users.length === 0) {
                list.innerHTML = `<div class="leaderboard-error">${esc(T.leaderboard.noFirstTries)}</div>`;
            } else {
                users.slice(0, 10).forEach((data, index) => {
                    const isMe =
                        data.id === userEmail ||
                        String(data.email || '').toLowerCase() === String(userEmail || '').toLowerCase();
                    const pts = Number(data.pillsPoints || 0);
                    const sec = Number(data.pillsRankTiempo || 0);
                    const timeLine = sec > 0 ? T.quiz.timerSeconds(sec) : T.common.dash;
                    list.innerHTML += `
            <div class="leaderboard-item ${isMe ? 'leaderboard-item--me' : ''}">
                <div class="leaderboard-item__left">
                    <span class="leaderboard-rank">#${index + 1}</span>
                    <span class="leaderboard-name ${isMe ? 'leaderboard-name--me' : ''}">${esc(data.nombre || T.common.anonymous)}</span>
                </div>
                <div class="leaderboard-score">
                    <div class="leaderboard-pts">${esc(T.leaderboard.pts(pts))}</div>
                    <div class="leaderboard-time">${esc(T.leaderboard.tiebreaker(timeLine))}</div>
                </div>
            </div>`;
                });
            }
        } else {
            if (modalTitleEl) {
                modalTitleEl.innerHTML = T.leaderboard.top10Title;
            }
            const modeFieldMap = {
                evaluation: 'tests_points_q2',
                quest: 'quest_points',
                practice: 'quest_points',
                pills: 'pills_points'
            };
            const pointsField = modeFieldMap[mode] || 'tests_points_q2';
            const { data: rawScores, error } = await supabase
                .from('user_scores')
                .select('user_id, tiempo, quest_points, tests_points_q2, pills_points')
                .order(pointsField, { ascending: false })
                .limit(50);
            if (error) throw error;

            const lbUids = (rawScores || []).map(d => d.user_id).filter(Boolean);
            let lbUserInfoMap = new Map();
            if (lbUids.length > 0) {
                const { data: lbUserData } = await supabase
                    .from('ranking_user')
                    .select('user_id, email, nombre')
                    .in('user_id', lbUids);
                (lbUserData || []).forEach(u => lbUserInfoMap.set(String(u.user_id), u));
            }

            let users = (rawScores || []).map(d => {
                const info = lbUserInfoMap.get(String(d.user_id)) || {};
                return {
                    id: info.email || d.user_id,
                    email: info.email || '',
                    nombre: info.nombre || '',
                    tiempo: d.tiempo,
                    questPoints: d.quest_points,
                    quest_points: d.quest_points,
                    tests_points_q2: d.tests_points_q2,
                    pills_points: d.pills_points
                };
            });

            users.sort((a, b) => {
                const pointsDiff = Number(b[pointsField] || 0) - Number(a[pointsField] || 0);
                if (pointsDiff !== 0) return pointsDiff;
                if (mode === 'evaluation') return Number(a.tiempo || 999999) - Number(b.tiempo || 999999);
                return 0;
            });

            list.innerHTML = '';

            users.slice(0, 10).forEach((data, index) => {
                const isMe = String(data.email || '').toLowerCase() === String(userEmail || '').toLowerCase();
                list.innerHTML += `
            <div class="leaderboard-item ${isMe ? 'leaderboard-item--me' : ''}">
                <div class="leaderboard-item__left">
                    <span class="leaderboard-rank">#${index + 1}</span>
                    <span class="leaderboard-name ${isMe ? 'leaderboard-name--me' : ''}">${esc(data.nombre || T.common.anonymous)}</span>
                </div>
                <div class="leaderboard-score">
                    <div class="leaderboard-pts">${esc(T.leaderboard.pts(Number(data[pointsField] || 0)))}</div>
                    <div class="leaderboard-time">${mode === 'evaluation' ? esc(T.leaderboard.evaluationTime(Number(data.tiempo || 0))) : esc(T.leaderboard.rankingByPoints)}</div>
                </div>
            </div>`;
            });
        }
    } catch (e) {
        list.innerHTML = `<div class="leaderboard-error">
            <p class="leaderboard-error__title">${esc(T.alerts.leaderboardConnectionTitle)}</p>
            <p>${esc(e.message)}</p>
            <p class="leaderboard-error__hint">${esc(T.alerts.leaderboardConnectionHint)}</p>
        </div>`;
    }
}

function closeLeaderboard() {
    document.getElementById('leaderboard-modal').classList.add('hidden');
}

function animateEvaluationDonut({ donut, correctCountEl, correctTextEl, incorrectTextEl, totalAnswered, correctCount, incorrectCount }) {
    if (!donut) return;

    const safeTotal = Math.max(Number(totalAnswered) || 0, 0);
    const safeCorrect = Math.max(Number(correctCount) || 0, 0);
    const safeIncorrect = Math.max(Number(incorrectCount) || 0, 0);
    const targetPct = safeTotal > 0 ? (safeCorrect / safeTotal) * 100 : 0;
    const durationMs = 700;
    const start = performance.now();

    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    const tick = (now) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / durationMs, 1);
        const eased = easeOutCubic(t);
        const animatedPct = targetPct * eased;
        const animatedCorrect = Math.round(safeCorrect * eased);
        const animatedIncorrect = Math.max(safeTotal - animatedCorrect, 0);

        donut.style.setProperty('--correct-angle', `${Math.round(animatedPct * 3.6)}deg`);
        if (correctCountEl) correctCountEl.innerText = String(animatedCorrect);
        if (correctTextEl) correctTextEl.innerText = T.results.correctLabel(animatedCorrect);
        if (incorrectTextEl) incorrectTextEl.innerText = T.results.incorrectLabel(animatedIncorrect);

        if (t < 1) {
            requestAnimationFrame(tick);
            return;
        }

        // Snap final values to avoid rounding drift.
        donut.style.setProperty('--correct-angle', `${Math.round(targetPct * 3.6)}deg`);
        if (correctCountEl) correctCountEl.innerText = String(safeCorrect);
        if (correctTextEl) correctTextEl.innerText = T.results.correctLabel(safeCorrect);
        if (incorrectTextEl) incorrectTextEl.innerText = T.results.incorrectLabel(safeIncorrect);
    };

    requestAnimationFrame(tick);
}

window.goToPillsHomeFromResults = async function goToPillsHomeFromResults() {
    currentQuizMode = 'pills';
    isEvaluationSessionActive = false;

    if (pillsCatalog.length === 0) {
        beginGlobalLoading(T.common.preparingContent);
        try {
            await loadPillsCatalog();
        } finally {
            endGlobalLoading();
        }
    }

    switchSection('landing-page', () => {
        document.getElementById('dashboard-view')?.classList.add('hidden');
        document.getElementById('mode-selection-view')?.classList.add('hidden');
        document.getElementById('evaluation-brief-view')?.classList.add('hidden');
        document.getElementById('profile-view')?.classList.add('hidden');
        document.getElementById('auth-card')?.classList.add('hidden');
        document.getElementById('login-view')?.classList.add('hidden');

        document.getElementById('pills-construction-view')?.classList.remove('hidden');
        document.getElementById('pills-construction-view')?.classList.add('animate-fade-in');

        document.getElementById('main-header')?.classList.remove('hidden');

        document.getElementById('feedback-panel')?.classList.add('hidden');
        document.getElementById('feedback-overlay')?.classList.add('hidden');

        renderPillsList();
        window.scrollTo(0, 0);
    });
};

async function showPillsResultsInScreen() {
    window.trackScreen('screen-results-pills');
    window.setRoute('/resultados');
    const resultsTitle = document.getElementById('results-title');
    const careerPath = document.querySelector('.career-path');
    const content = document.getElementById('results-content');
    const blockDefault = document.getElementById('results-block-default');
    const blockPills = document.getElementById('results-block-pills');
    const recordBadge = document.getElementById('new-record-badge');

    const totalAnswered = currentSession.length || 0;
    const catalogPill = pillsCatalog.find((p) => p.id === selectedPillId);
    const pillDisplayName = String(
        selectedPillMeta.name || catalogPill?.name || selectedPillId || T.common.pillFallback
    ).trim();

    if (careerPath) careerPath.classList.add('hidden');
    if (blockDefault) blockDefault.classList.add('hidden');
    if (blockPills) blockPills.classList.remove('hidden');
    if (resultsTitle) resultsTitle.innerText = T.pills.resultsTitle;

    const pillNameEl = document.getElementById('results-pills-pill-name');
    const scoreNumEl = document.getElementById('results-pills-score-num');
    const scoreOfEl = document.getElementById('results-pills-score-of');
    const donutEl = document.getElementById('results-pills-donut');
    const stickerEl = document.getElementById('results-pills-sticker');
    const stickerImgEl = document.getElementById('results-pills-sticker-img');
    const stickerTextEl = document.getElementById('results-pills-sticker-text');

    if (pillNameEl) pillNameEl.textContent = pillDisplayName;
    if (scoreNumEl) scoreNumEl.textContent = String(score);
    if (scoreOfEl) scoreOfEl.textContent = totalAnswered > 0 ? T.pills.scoreOf(totalAnswered) : '';
    if (donutEl) {
        const correctPct = totalAnswered > 0 ? (Number(score || 0) / totalAnswered) * 100 : 0;
        donutEl.style.setProperty('--correct-angle', `${Math.round(correctPct * 3.6)}deg`);
    }

    const errCountPill = Math.max(totalAnswered - Number(score || 0), 0);
    const sealUrl = selectedPillMeta.sealUrl || getPillSealUrl(catalogPill);
    const sealName = selectedPillMeta.sealName || getPillSealName(catalogPill);
    const sealWindow = getPillSealWindowState(catalogPill);
    if (stickerEl) {
        stickerEl.classList.remove(
            'results-pills-sticker--win',
            'results-pills-sticker--lose',
            'results-pills-sticker--neutral'
        );
        let prizeImg = MATERIAL.pillGeneral;
        let prizeAlt = T.pills.stickerAltResult;
        let prizeHtml = '';
        if (pillsSessionHadPriorAttempt) {
            stickerEl.classList.add('results-pills-sticker--neutral');
            prizeImg = MATERIAL.pillGeneral;
            prizeAlt = T.pills.stickerAltExtra;
            prizeHtml = T.pills.stickerHtmlNeutral;
        } else if (sealWindow.isExpired) {
            stickerEl.classList.add('results-pills-sticker--lose');
            prizeImg = MATERIAL.pillPerder;
            prizeAlt = T.pills.stickerAltLose;
            prizeHtml = T.pills.stickerHtmlExpired;
        } else if (errCountPill <= 1 && sealUrl) {
            stickerEl.classList.add('results-pills-sticker--win');
            prizeImg = sealUrl;
            prizeAlt = T.pills.stickerAltWin;
            prizeHtml = T.pills.stickerHtmlWin;
        } else {
            stickerEl.classList.add('results-pills-sticker--lose');
            prizeImg = MATERIAL.pillPerder;
            prizeAlt = T.pills.stickerAltLose;
            prizeHtml = errCountPill <= 1 && !sealUrl
                ? T.pills.noSealAvailable
                : T.pills.stickerHtmlLose;
        }
        if (stickerImgEl) {
            stickerImgEl.src = prizeImg;
            stickerImgEl.alt = sealName || prizeAlt;
        }
        if (stickerTextEl) stickerTextEl.innerHTML = prizeHtml;
        stickerEl.classList.remove('hidden');
    }

    if (recordBadge) recordBadge.classList.add('hidden');

    const endTime = new Date();
    const timeTaken = Math.round((endTime - startTime) / 1000);
    await saveScoreToCloud(score, timeTaken);

    if (content) {
        content.classList.remove('hidden', 'opacity-0');
        void content.offsetWidth;
        content.classList.add('animate-slide-up');
    }

    if (!pillsSessionHadPriorAttempt && errCountPill <= 1) {
        confetti({ particleCount: 120, spread: 65, origin: { y: 0.55 } });
    }
}

async function showResults() {
    isEvaluationSessionActive = false;
    window.scrollTo(0, 0);
    switchSection('results-screen', async () => {
        if (isPillsMode()) {
            await showPillsResultsInScreen();
            return;
        }

        const blockDefault = document.getElementById('results-block-default');
        const blockPills = document.getElementById('results-block-pills');
        if (blockPills) blockPills.classList.add('hidden');
        if (blockDefault) blockDefault.classList.remove('hidden');

        const isEvaluationResult = currentQuizMode === 'evaluation';
        window.trackScreen(isEvaluationResult ? 'screen-results-evaluacion' : 'screen-results-pruebas');
        window.setRoute('/resultados');
        const resultsTitle = document.getElementById('results-title');
        const careerPath = document.querySelector('.career-path');
        const content = document.getElementById('results-content');
        const classicScoreBlock = document.getElementById('classic-score-block');
        const evaluationSummary = document.getElementById('evaluation-results-summary');
        const leaderboardBtn = document.getElementById('results-leaderboard-btn');
        const resultsDivider = document.getElementById('results-divider');
        const restartBtn = document.getElementById('results-restart-btn');
        const recordBadge = document.getElementById('new-record-badge');

        document.getElementById('final-score').innerText = score;
        const totalAnswered = currentSession.length || 0;
        const incorrectCount = Math.max(totalAnswered - score, 0);

        if (resultsTitle) {
            resultsTitle.innerText = isEvaluationResult ? T.results.evaluation : T.results.levelUxUi;
        }

        if (careerPath) {
            careerPath.classList.toggle('hidden', isEvaluationResult);
        }
        if (classicScoreBlock) {
            classicScoreBlock.classList.toggle('hidden', isEvaluationResult);
        }
        if (evaluationSummary) {
            evaluationSummary.classList.toggle('hidden', !isEvaluationResult);
        }
        if (leaderboardBtn) {
            leaderboardBtn.classList.toggle('hidden', isEvaluationResult);
        }
        if (resultsDivider) {
            resultsDivider.classList.toggle('hidden', isEvaluationResult);
        }
        if (restartBtn) {
            restartBtn.classList.toggle('hidden', isEvaluationResult);
        }

        const evalErrorsWrap = document.getElementById('results-eval-errors-wrap');
        if (evalErrorsWrap) {
            evalErrorsWrap.classList.toggle('hidden', !isEvaluationResult || errors.length === 0);
        }

        if (isEvaluationResult) {
            const donut = document.getElementById('evaluation-donut');
            const correctCountEl = document.getElementById('evaluation-correct-count');
            const correctTextEl = document.getElementById('evaluation-correct-text');
            const incorrectTextEl = document.getElementById('evaluation-incorrect-text');
            if (donut) donut.style.setProperty('--correct-angle', `0deg`);
            if (correctCountEl) correctCountEl.innerText = '0';
            if (correctTextEl) correctTextEl.innerText = T.results.correctLabel(0);
            if (incorrectTextEl) incorrectTextEl.innerText = T.results.incorrectLabel(totalAnswered);

            animateEvaluationDonut({
                donut,
                correctCountEl,
                correctTextEl,
                incorrectTextEl,
                totalAnswered,
                correctCount: score,
                incorrectCount
            });
        }

        // Resetear animación del camino
        const levelBar = document.getElementById('level-progress-bar');
        levelBar.style.transition = 'none';
        levelBar.style.height = '0%';
        void levelBar.offsetWidth; // Force reflow
        levelBar.style.transition = '';

        document.querySelectorAll('.level-node').forEach(node => {
            const circle = node.querySelector('.node-circle');
            const text = node.querySelector('.node-text');
            circle.className = "node-circle";
            text.className = "node-text";
            circle.querySelector('i').className = "fas " + circle.querySelector('i').className.split(' ')[1] + " node-icon";
        });

        content.classList.add('hidden', 'opacity-0');
        content.classList.remove('animate-slide-up');

        // Guardar en Supabase
        const endTime = new Date();
        const timeTaken = Math.round((endTime - startTime) / 1000); // Segundos
        const isNewRecord = await saveScoreToCloud(score, timeTaken);

        if (!isEvaluationResult && isNewRecord) {
            recordBadge.classList.remove('hidden');
        } else {
            recordBadge.classList.add('hidden');
        }

        if (isEvaluationResult) {
            content.classList.remove('hidden');
            void content.offsetWidth;
            content.classList.remove('opacity-0');
            content.classList.add('animate-slide-up');
        } else {
            // Iniciar Animación del Camino
            setTimeout(() => {
                const pct = (score / currentSession.length) * 100;

                // Calcular altura visual basada en nodos (0, 25, 50, 75, 100)
                // Thresholds: 0, 40, 65, 85, 100
                let visualPct = 0;
                if (pct <= 40) visualPct = (pct / 40) * 25;
                else if (pct <= 65) visualPct = 25 + ((pct - 40) / (65 - 40)) * 25;
                else if (pct <= 85) visualPct = 50 + ((pct - 65) / (85 - 65)) * 25;
                else visualPct = 75 + ((pct - 85) / (100 - 85)) * 25;

                // Asegurar que la barra suba al menos un poco si hay puntos, o se quede en 0
                const barHeight = Math.max(visualPct, score > 0 ? 5 : 0);
                document.getElementById('level-progress-bar').style.height = `${barHeight}%`;

                // Iluminar nodos alcanzados
                const nodes = document.querySelectorAll('.level-node');
                nodes.forEach(node => {
                    const level = parseInt(node.getAttribute('data-level'));
                    if (pct >= level) {
                        setTimeout(() => {
                            const circle = node.querySelector('.node-circle');
                            const text = node.querySelector('.node-text');
                            circle.classList.add('node-circle--active');
                            text.classList.add('node-text--active');
                        }, (level / 100) * 1500); // Sincronizar iluminación con la subida de la barra
                    }
                });

                // Mostrar detalles al finalizar
                setTimeout(() => {
                    content.classList.remove('hidden');
                    void content.offsetWidth; // Reflow
                    content.classList.remove('opacity-0');
                    content.classList.add('animate-slide-up');
                    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
                }, 2200);
            }, 500);
        }

    });
}

// --- FUNCIONES DE UTILIDAD ---
window.copyAllTopics = function (btn) {
    if (errors.length === 0) return;

    const uniqueTags = [...new Set(errors.map(e => e.studyTag))];
    const textToCopy = T.common.copyTopicsPrefix + uniqueTags.join("\n- ");

    navigator.clipboard.writeText(textToCopy).then(() => {
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> ' + T.common.copied;
        btn.classList.add('btn--success-state');

        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.classList.remove('btn--success-state');
        }, 2000);
    }).catch(err => {
        showAppAlert({
            title: T.alerts.clipboardErrorTitle,
            message: T.alerts.clipboardErrorMessage,
            variant: "error",
            confirmText: T.common.understood
        });
    });
}

window.openReviewSheet = function () {
    const sheet = document.getElementById('review-sheet');
    const list = document.getElementById('review-list');
    sheet.classList.remove('hidden');
    list.innerHTML = '';

    errors.forEach((err, index) => {
        const item = document.createElement('div');
        item.className = "review-item";
        item.innerHTML = `
            <p class="review-question">${esc(index + 1)}. ${esc(err.question)}</p>
            <div class="review-item__footer">
                <div>
                    <span class="review-topic-label">${T.profile.topicToReview}</span>
                    <span class="review-topic-name">${esc(err.studyTag)}</span>
                </div>
                <button class="btn-copy-topic" title="Copiar tema">
                    <i class="fas fa-copy"></i>
                </button>
            </div>
        `;
        const copyBtn = item.querySelector('.btn-copy-topic');
        if (copyBtn) copyBtn.addEventListener('click', function () { copySingleTopic(err.studyTag, this); });
        list.appendChild(item);
    });
}

window.closeReviewSheet = function () {
    document.getElementById('review-sheet').classList.add('hidden');
    const reviewSheetContent = document.getElementById('review-sheet-content');
    if (reviewSheetContent) reviewSheetContent.style.transform = '';
}

window.copySingleTopic = function (topic, btn) {
    navigator.clipboard.writeText(T.common.copyTopicPrefix + topic).then(() => {
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check icon-feedback-correct"></i>';
        btn.classList.add('btn-copy-topic--done');

        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.classList.remove('btn-copy-topic--done');
        }, 1500);
    });
}

// Drag Logic for Review Sheet
const sheetContent = document.getElementById('review-sheet-content');
const reviewList = document.getElementById('review-list');
let startY = null;
let currentY = null;

if (sheetContent && reviewList) {
    sheetContent.addEventListener('touchstart', (e) => {
        const isHeader = !reviewList.contains(e.target);
        const isAtTop = reviewList.scrollTop === 0;

        if (isHeader || isAtTop) {
            startY = e.touches[0].clientY;
            currentY = startY;
            sheetContent.style.transition = 'none';
        } else {
            startY = null;
        }
    }, { passive: true });

    sheetContent.addEventListener('touchmove', (e) => {
        if (startY === null) return;
        currentY = e.touches[0].clientY;
        const diff = currentY - startY;

        if (diff > 0) {
            if (e.cancelable) e.preventDefault();
            sheetContent.style.transform = `translateY(${diff}px)`;
        }
    }, { passive: false });

    sheetContent.addEventListener('touchend', () => {
        if (startY === null) return;
        const diff = currentY - startY;
        sheetContent.style.transition = 'transform 0.3s ease-out';
        if (diff > 100) {
            closeReviewSheet();
        } else {
            sheetContent.style.transform = '';
        }
        startY = null;
    });
}

// Exponer funciones al objeto window porque type="module" las aísla (centralizado en global-handlers.js)
exposeToWindow({
    toggleCategory,
    validateEmailFormat,
    validatePasswordFormat,
    verifyEmail,
    doLogin,
    checkUserEmail: verifyEmail,
    startGuestMode,
    startQuiz,
    handleDontKnow,
    nextQuestion,
    continueFromBreak,
    returnToDashboard,
    handleHeaderClick,
    restartDirectly,
    openLeaderboard,
    closeLeaderboard,
    openTalentPeersModal,
    closeTalentPeersModal,
    openTestModePanel,
    exitTestMode,
});

// Inicialización
updatePoolCount();
initPillsQuizInteractions();

// === Anti-cheat listeners (solo aplican en evaluación activa) ===
document.addEventListener('visibilitychange', () => {
    if (document.hidden) handleEvaluationViolation('visibilitychange');
});

window.addEventListener('blur', () => {
    handleEvaluationViolation('blur');
});

window.addEventListener('pagehide', () => {
    handleEvaluationViolation('pagehide');
});

/**
 * DotGrid Implementation for Vanilla JS
 * Ported from ReactBits with custom momentum physics to avoid InertiaPlugin dependency.
 */

class DotGrid {
    constructor(container, options = {}) {
        this.container = container;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.container.appendChild(this.canvas);

        this.dotSize = options.dotSize || 3;
        this.gap = options.gap || 15;
        this.baseColor = options.baseColor || '#8c59fe';
        this.activeColor = options.activeColor || '#ace738';
        this.proximity = options.proximity || 25;
        this.speedTrigger = options.speedTrigger || 10;
        this.shockRadius = options.shockRadius || 10;
        this.shockStrength = options.shockStrength || 5;
        this.maxSpeed = options.maxSpeed || 5000;
        this.resistance = options.resistance || 35;
        this.returnDuration = options.returnDuration || 0.3;

        this.dots = [];
        this.pointer = {
            x: -1000,
            y: -1000,
            vx: 0,
            vy: 0,
            speed: 0,
            lastTime: 0,
            lastX: 0,
            lastY: 0
        };

        this.baseRgb = this.hexToRgb(this.baseColor);
        this.activeRgb = this.hexToRgb(this.activeColor);
        this.isVisible = true;
        this.init();
    }

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 0, g: 0, b: 0 };
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());

        // Listen on window to capture events over all layers
        window.addEventListener('mousemove', (e) => this.onMove(e));
        window.addEventListener('click', (e) => this.onClick(e));

        this.render();
    }

    resize() {
        const rect = this.container.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;
        this.ctx.scale(dpr, dpr);

        this.buildGrid();
    }

    buildGrid() {
        const cell = this.dotSize + this.gap;
        const cols = Math.floor((this.width + this.gap) / cell);
        const rows = Math.floor((this.height + this.gap) / cell);

        const gridW = cell * cols - this.gap;
        const gridH = cell * rows - this.gap;

        const startX = (this.width - gridW) / 2 + this.dotSize / 2;
        const startY = (this.height - gridH) / 2 + this.dotSize / 2;

        this.dots = [];
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                this.dots.push({
                    cx: startX + x * cell,
                    cy: startY + y * cell,
                    xOffset: 0,
                    yOffset: 0,
                    vx: 0,
                    vy: 0,
                    isAnimating: false
                });
            }
        }
    }

    onMove(e) {
        if (!this.isVisible) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const now = performance.now();
        const dt = now - this.pointer.lastTime;
        let vx = 0, vy = 0, speed = 0;

        if (dt > 0) {
            vx = (x - this.pointer.lastX) / dt * 1000;
            vy = (y - this.pointer.lastY) / dt * 1000;
            speed = Math.min(this.maxSpeed, Math.hypot(vx, vy));
        }

        this.pointer = { x, y, vx, vy, speed, lastTime: now, lastX: x, lastY: y };

        if (speed >= this.speedTrigger) {
            this.triggerShock(x, y, vx, vy, true);
        }
    }

    onClick(e) {
        if (!this.isVisible) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this.triggerShock(x, y, 0, 0, false);
    }

    triggerShock(px, py, vx, vy, isMove) {
        for (const dot of this.dots) {
            const dx = dot.cx - px;
            const dy = dot.cy - py;
            const dist = Math.hypot(dx, dy);

            if (dist < this.shockRadius) {
                // Kill existing GSAP tweens for this dot
                if (window.gsap) gsap.killTweensOf(dot);

                let pushX, pushY;
                if (isMove) {
                    pushX = dx * 0.2 + vx * 0.005;
                    pushY = dy * 0.2 + vy * 0.005;
                } else {
                    const falloff = 1 - dist / this.shockRadius;
                    pushX = dx * this.shockStrength * falloff;
                    pushY = dy * this.shockStrength * falloff;
                }

                // Simulate inertia/shock with GSAP
                if (window.gsap) {
                    gsap.to(dot, {
                        xOffset: pushX,
                        yOffset: pushY,
                        duration: 0.1,
                        onComplete: () => {
                            gsap.to(dot, {
                                xOffset: 0,
                                yOffset: 0,
                                duration: this.returnDuration,
                                ease: "elastic.out(1, 0.5)"
                            });
                        }
                    });
                }
            }
        }
    }

    render() {
        if (!this.isVisible) return;
        this.ctx.clearRect(0, 0, this.width, this.height);

        const proxSq = this.proximity * this.proximity;

        for (const dot of this.dots) {
            const ox = dot.cx + dot.xOffset;
            const oy = dot.cy + dot.yOffset;
            const dx = ox - this.pointer.x;
            const dy = oy - this.pointer.y;
            const dsq = dx * dx + dy * dy;

            let color = this.baseColor;
            let currentSize = this.dotSize;

            if (dsq <= proxSq) {
                const dist = Math.sqrt(dsq);
                const t = 1 - dist / this.proximity;

                // Color interpolation
                const r = Math.round(this.baseRgb.r + (this.activeRgb.r - this.baseRgb.r) * t);
                const g = Math.round(this.baseRgb.g + (this.activeRgb.g - this.baseRgb.g) * t);
                const b = Math.round(this.baseRgb.b + (this.activeRgb.b - this.baseRgb.b) * t);
                color = `rgb(${r},${g},${b})`;

                // Scale / Zoom effect
                currentSize = this.dotSize * (1 + t * 1.5); // Grow up to 2.5x
            }

            this.ctx.beginPath();
            this.ctx.arc(ox, oy, currentSize / 2, 0, Math.PI * 2);
            this.ctx.fillStyle = color;
            this.ctx.fill();
        }

        requestAnimationFrame(() => this.render());
    }

    setVisibility(visible) {
        this.isVisible = visible;
        if (visible) {
            this.container.classList.remove('dotgrid--hidden');
            // Restart loop if it was stopped
            this.render();
        } else {
            this.container.classList.add('dotgrid--hidden');
            // Loop will stop itself on next frame due to isVisible check
        }
    }
}

// Global instance 
let globalDotGrid = null;

// Auto-init for index.html integration
const dotGridContainer = document.getElementById('dotgrid-container');
if (dotGridContainer) {
    globalDotGrid = new DotGrid(dotGridContainer, {
        dotSize: 4,
        gap: 24,
        baseColor: "#8c59fe",
        activeColor: "#ace738",
        proximity: 100, // Increased for better zoom experience
        speedTrigger: 20, // More sensitive
        shockRadius: 120,
        shockStrength: 6,
        maxSpeed: 5000,
        resistance: 350,
        returnDuration: 0.5
    });
}
