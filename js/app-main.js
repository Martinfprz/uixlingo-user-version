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
    RESET_PASSWORD_PATH,
} from './constants.js';
import { esc, safeIconClass, safeTalentImageUrl, safeHttpUrl, shuffleFisherYates } from './utils.js';
import { supabase } from './supabase.js';
import { showAppAlert, showAppConfirm } from './ui.js';
import { exposeToWindow } from './global-handlers.js';
import { UI_TEXT as T } from './copy.js';

let supabaseSession = null;
/** True cuando el usuario llegó desde un link de recuperación y aún no guarda la nueva contraseña. */
let isPasswordRecoveryFlow = false;
/** Flag síncrono para capturar el evento SIGNED_IN en caso de que Supabase no emita PASSWORD_RECOVERY. */
let _recoveryFlowPending = false;

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
        console.error("Error al cargar preguntas de práctica:", e);
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
        console.error("Error al cargar preguntas de evaluación:", e);
    }
}

async function loadPillsCatalog() {
    if (!supabase) return;
    try {
        const { data, error } = await supabase.from('pills').select('*').order('sort_order');
        if (error) throw error;
        pillsCatalog = (data || []).map(p => ({
            ...p,
            published_at: p.published_at,
            publishedAt: p.published_at,
            order: p.sort_order
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
        console.error("Error al cargar píldoras:", e);
    }
}

// Listener de autenticación: solo maneja sesión (datos se cargan bajo demanda)
if (supabase) {
    supabase.auth.onAuthStateChange((event, session) => {
        supabaseSession = session;

        if (event === 'PASSWORD_RECOVERY') {
            _recoveryFlowPending = false;
            openRecoveryModal();
            return;
        }

        // Supabase a veces emite SIGNED_IN en lugar de PASSWORD_RECOVERY.
        if (event === 'SIGNED_IN' && _recoveryFlowPending) {
            _recoveryFlowPending = false;
            openRecoveryModal();
            return;
        }

        // INITIAL_SESSION: el SDK ya procesó el hash ANTES de que este listener se registrara.
        // Si hay sesión activa y estamos en /reset-password, es un flujo de recovery.
        if (event === 'INITIAL_SESSION' && session) {
            const onResetRoute = window.location.pathname === RESET_PASSWORD_PATH
                || window.location.pathname === `${RESET_PASSWORD_PATH}/`;
            if (onResetRoute || _recoveryFlowPending) {
                _recoveryFlowPending = false;
                openRecoveryModal();
            }
        }
    });
}

/**
 * Detecta los tres formatos de callback que Supabase puede emitir en el link de recuperación:
 *   1. PKCE flow  → ?code=...  (más común en v2, default)
 *   2. token_hash → ?token_hash=...&type=recovery
 *   3. Implicit   → #access_token=...&type=recovery  (procesado automáticamente por el SDK)
 * Se llama al inicio del módulo para que el intercambio ocurra antes de cualquier render.
 */
async function initPasswordRecoveryFlow() {
    if (!supabase) return;

    const isResetPasswordRoute = window.location.pathname === RESET_PASSWORD_PATH || window.location.pathname === `${RESET_PASSWORD_PATH}/`;
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    const code = params.get('code');
    const tokenHash = params.get('token_hash');
    const type = params.get('type');
    const hasRecoveryHash = hash.includes('type=recovery');

    // --- Formato 1: PKCE (?code=...) ---
    if (code) {
        _recoveryFlowPending = true; // activar ANTES del await para que onAuthStateChange lo vea
        history.replaceState({}, document.title, window.location.pathname);
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        _recoveryFlowPending = false;
        if (error) {
            _showRecoveryError();
            return;
        }
        // Fallback final: si ni PASSWORD_RECOVERY ni SIGNED_IN abrieron el modal
        if (!isPasswordRecoveryFlow) await _openRecoveryModalIfSessionAvailable();
        return;
    }

    // --- Formato 2: token_hash (?token_hash=...&type=recovery) ---
    if (tokenHash && type === 'recovery') {
        _recoveryFlowPending = true;
        history.replaceState({}, document.title, window.location.pathname);
        const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
        _recoveryFlowPending = false;
        if (error) {
            _showRecoveryError();
            return;
        }
        if (!isPasswordRecoveryFlow) await _openRecoveryModalIfSessionAvailable();
        return;
    }

    // --- Formato 3: Implicit (#access_token=...&type=recovery) ---
    // El SDK procesa este hash automáticamente y dispara PASSWORD_RECOVERY o INITIAL_SESSION.
    // Limpiamos el hash de la URL y esperamos con reintentos progresivos.
    if (hasRecoveryHash) {
        history.replaceState({}, document.title, RESET_PASSWORD_PATH);
        for (const ms of [50, 150, 300, 600, 1000]) {
            await new Promise(r => setTimeout(r, ms));
            if (isPasswordRecoveryFlow) return; // ya abierto por onAuthStateChange
            const opened = await _openRecoveryModalIfSessionAvailable();
            if (opened) return;
        }
        _showRecoveryError();
        return;
    }

    // Fallback: ya en /reset-password, verificar si hay sesión activa (ej. recarga de página).
    if (isResetPasswordRoute) {
        const opened = await _openRecoveryModalIfSessionAvailable();
        if (!opened) _showRecoveryError();
    }
}

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

// Iniciar detección de recovery inmediatamente (sin await para no bloquear el render del splash)
initPasswordRecoveryFlow();

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
let selectedPillMeta = { name: '', category: '' };
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
            const total = Number(s.total || 0);
            const score = Number(s.score || 0);
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
        console.warn('loadUserProfile error:', e);
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
 * - tests_points  -> #profile-tests-pts
 * - pills_points  -> #profile-pills-pts
 * Seniority y especialidad del perfil (#profile-seniority, #profile-especialidad) vienen de aquí.
 */
async function loadRankingUserStats() {
    if (!supabase || !userEmail || !userEmail.includes('@')) return;
    try {
        const { data, error } = await supabase
            .from('ranking_user')
            .select('seniority, especialidad, quest_points, tests_points, pills_points, pills_rank_pill_id')
            .eq('email', userEmail.toLowerCase())
            .single();
        if (error) throw error;
        if (data) {
            const rawSeniority = data.seniority;
            if (rawSeniority && String(rawSeniority).trim()) {
                userProfile.seniority = String(rawSeniority).trim();
            }
            if (data.especialidad && String(data.especialidad).trim()) {
                userProfile.especialidad = String(data.especialidad).trim();
            }
            userProfile.questPoints = Number(data.quest_points || 0);
            userProfile.testsPoints = Number(data.tests_points || 0);
            userProfile.pillsPoints = Number(data.pills_points || 0);
            userProfile.latestPillRankId = String(data.pills_rank_pill_id || '').trim();
            userProfile.evalCompleted = data.tests_points != null;
        }
    } catch (e) {
        console.warn('loadRankingUserStats error:', e);
    }
}

async function loadUserSeals(uid) {
    if (!supabase || !uid) return;
    try {
        const { data, error } = await supabase
            .from('user_sellos')
            .select('fecha_asignacion, sellos(id, nombre, icono)')
            .eq('user_id', uid);
        if (error) throw error;
        userProfile.seals = (data || []).map(d => ({
            id: d.sellos.id,
            name: d.sellos.nombre || T.common.sealFallback,
            icon: d.sellos.icono  || 'fa-star',
            date: d.fecha_asignacion || new Date().toISOString().split('T')[0]
        }));
    } catch (e) {
        console.warn('loadUserSeals error:', e);
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

        const { data: habRows, error: hErr } = await supabase
            .from('habilidades')
            .select('id, nombre, icono, imagen_url')
            .in('id', orderedIds);
        if (hErr) throw hErr;

        const byId = new Map();
        (habRows || []).forEach((h) => {
            byId.set(String(h.id), h);
        });

        userProfile.talents = orderedIds.map((id) => {
            const h = byId.get(String(id));
            return {
                name: (h && h.nombre) || T.common.skillFallback,
                icon: (h && h.icono) || 'fa-brain',
                imageUrl: (h && h.imagen_url) || '',
                sortOrder: 0
            };
        });
    } catch (e) {
        console.warn('loadUserSkills error:', e);
    }
}

async function loadAllUserData(uid) {
    await Promise.all([
        loadUserProfile(uid),
        loadUserSeals(uid),
        loadUserSkills(uid)
    ]);
    await loadRankingUserStats();
}

// --- PROFILE LOGIC ---
function renderProfileSeniorityEspecialidadCard() {
    const sEl = document.getElementById('profile-seniority');
    const eEl = document.getElementById('profile-especialidad');
    if (sEl) {
        sEl.textContent = userProfile.seniority || T.profile.explorador;
    }
    if (eEl) {
        const esp = String(userProfile.especialidad || '').trim();
        eEl.textContent = esp || T.profile.sinRegistrar;
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
    const newTagEl = document.getElementById('profile-pills-new-tag');

    if (!labelEl || !valueEl || !inviteEl || !singleActions || !dualActions) return;

    const setPillsNewTagVisible = (visible) => {
        if (newTagEl) {
            newTagEl.classList.toggle('hidden', !visible);
            newTagEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }
    };

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
    const entry = userProfile.pillScores && userProfile.pillScores[pillId];
    const hasAttemptFromRanking =
        String(userProfile.latestPillRankId || '') === String(pillId);
    const hasAttempt = (entry !== undefined && entry !== null) || hasAttemptFromRanking;

    if (hasAttempt) {
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

    // Stats
    renderProfileSeniorityEspecialidadCard();
    document.getElementById('profile-quest-pts').innerText = userProfile.questPoints;
    document.getElementById('profile-tests-pts').innerText = userProfile.testsPoints;
    renderProfilePillsCard();
    const rankEl = document.getElementById('profile-practice-rank');
    if (rankEl) rankEl.innerText = T.profile.rankCalculating;
    renderSeals();

    // Talents
    const talentsContainer = document.getElementById('profile-talents');
    talentsContainer.innerHTML = '';
    if (userProfile.talents.length === 0) {
        talentsContainer.innerHTML = T.profile.talentsEmpty;
    } else {
        userProfile.talents.forEach((talent) => {
            const div = document.createElement('div');
            div.className = 'talent-item talent-item--badge';
            const label = String(talent.name || T.common.skillFallback);
            div.setAttribute('title', label);
            div.setAttribute('aria-label', label);
            const imgSrc = safeTalentImageUrl(talent.imageUrl);
            if (imgSrc) {
                const img = document.createElement('img');
                img.className = 'talent-item__img';
                img.src = imgSrc;
                img.alt = label;
                img.loading = 'lazy';
                img.decoding = 'async';
                div.appendChild(img);
            } else {
                const iconEl = document.createElement('i');
                iconEl.className = `fas ${safeIconClass(talent.icon)}`;
                iconEl.setAttribute('aria-hidden', 'true');
                div.appendChild(iconEl);
            }
            const span = document.createElement('span');
            span.className = 'talent-item__name';
            span.textContent = label;
            div.appendChild(span);
            talentsContainer.appendChild(div);
        });
    }
}

async function updatePracticeRankUI() {
    const rankEl = document.getElementById('profile-practice-rank');
    if (!rankEl) return;
    if (!supabase || !userEmail) {
        rankEl.innerText = T.profile.rankUnavailable;
        return;
    }

    try {
        const { data: users, error } = await supabase
            .from('ranking_user')
            .select('email, quest_points')
            .order('quest_points', { ascending: false });
        if (error) throw error;
        if (!users || users.length === 0) {
            rankEl.innerText = T.profile.rankEmpty;
            return;
        }

        const index = users.findIndex(u =>
            u.email && String(u.email).toLowerCase() === String(userEmail).toLowerCase()
        );

        if (index === -1) {
            rankEl.innerText = T.profile.rankNoPosition;
            return;
        }

        rankEl.innerText = T.profile.rankPosition(index + 1);
    } catch (e) {
        rankEl.innerText = T.profile.rankLoadError;
    }
}


function renderSeals() {
    const recentContainer = document.getElementById('profile-seals-recent');
    const historyList = document.getElementById('seals-history-list');
    if (!recentContainer || !historyList) return;

    // Sort seals by date descending
    const sortedSeals = [...userProfile.seals].sort((a, b) => new Date(b.date) - new Date(a.date));

    // Render Recent (top 5)
    recentContainer.innerHTML = '';
    if (sortedSeals.length === 0) {
        recentContainer.innerHTML = T.profile.sealsEmpty;
        document.querySelector('.bento-seals-expand-btn')?.classList.add('hidden');
        return;
    }
    document.querySelector('.bento-seals-expand-btn')?.classList.remove('hidden');

    sortedSeals.slice(0, 5).forEach(seal => {
        const div = document.createElement('div');
        div.className = 'bento-seal-item';
        const circle = document.createElement('div');
        circle.className = 'bento-seal-circle';
        circle.title = seal.name;
        const circleIcon = document.createElement('i');
        circleIcon.className = `fas ${safeIconClass(seal.icon)}`;
        circle.appendChild(circleIcon);
        const nameSpan = document.createElement('span');
        nameSpan.className = 'bento-seal-name';
        nameSpan.textContent = seal.name;
        div.appendChild(circle);
        div.appendChild(nameSpan);
        recentContainer.appendChild(div);
    });

    // Render History (grouped by month)
    historyList.innerHTML = '';
    const grouped = {};
    sortedSeals.forEach(seal => {
        const date = new Date(seal.date);
        const monthYear = date.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
        if (!grouped[monthYear]) grouped[monthYear] = [];
        grouped[monthYear].push(seal);
    });

    for (const [month, seals] of Object.entries(grouped)) {
        const monthDiv = document.createElement('div');
        monthDiv.className = 'seals-history-month';
        monthDiv.innerHTML = `<h4>${esc(month)}</h4>`;
        
        const grid = document.createElement('div');
        grid.className = 'bento-seals-grid bento-seals-grid--small';
        
        seals.forEach(seal => {
            const item = document.createElement('div');
            item.className = 'bento-seal-item';
            const circle = document.createElement('div');
            circle.className = 'bento-seal-circle bento-seal-circle--small';
            const circleIcon = document.createElement('i');
            circleIcon.className = `fas ${safeIconClass(seal.icon)}`;
            circle.appendChild(circleIcon);
            const nameSpan = document.createElement('span');
            nameSpan.className = 'bento-seal-name';
            nameSpan.textContent = seal.name;
            item.appendChild(circle);
            item.appendChild(nameSpan);
            grid.appendChild(item);
        });
        
        monthDiv.appendChild(grid);
        historyList.appendChild(monthDiv);
    }
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
                console.warn("Pregunta sin respuesta correcta detectada:", getQuestionField(q, ['Q', 'q']));
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
        console.warn('verifyEmail error:', e);
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

window.sendPasswordReset = async function () {
    if (!emailVerified || !userEmail || !supabase) return;

    const btn = document.getElementById('btn-forgot-password');
    const originalText = btn.textContent;
    btn.textContent = T.auth.forgotSending;
    btn.disabled = true;

    try {
        const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
            redirectTo: window.location.origin + RESET_PASSWORD_PATH
        });

        if (error) {
            console.warn('sendPasswordReset error:', error);
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
        console.warn('sendPasswordReset unexpected error:', e);
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
            console.warn('showDashboard error:', dashErr);
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
        console.warn('doLogin error:', e);
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

    const avatarPlaceholder = document.querySelector('.user-avatar-placeholder');
    if (avatarPlaceholder) {
        avatarPlaceholder.innerText = firstName.charAt(0).toUpperCase();
    }

    const userId = supabaseSession?.user?.id;
    userProfile.nickname = name;

    beginGlobalLoading(T.common.loadingProfile);
    try {
        // Carga de datos: errores aislados para no romper la transición
        if (userId) {
            try { await loadAllUserData(userId); } catch (e) { console.warn('loadAllUserData:', e); }
        }
        if (pillsCatalog.length === 0) {
            try { await loadPillsCatalog(); } catch (e) { console.warn('loadPillsCatalog:', e); }
        }
        if (!userProfile.nickname) userProfile.nickname = name;

        try { renderProfile(); } catch (e) { console.warn('renderProfile:', e); }
        try { updatePracticeRankUI(); } catch (e) { console.warn('updatePracticeRankUI:', e); }

        document.getElementById('main-header').classList.remove('hidden');

        loginView.classList.add('animate-fade-out');
        setTimeout(() => {
            loginView.classList.add('hidden');
            loginView.classList.remove('animate-fade-out');
            document.getElementById('auth-card').classList.add('hidden');
            profileView.classList.remove('hidden');
            profileView.classList.add('animate-fade-in');
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
        questPoints: 0,
        testsPoints: 0,
        pillsPoints: 0,
        latestPillRankId: '',
        pillScores: {},
        seals: [],
        talents: []
    };

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

        resetLoginEmailButtonState();

        // Hide Navbar
        document.getElementById('main-header').classList.add('hidden');

        // Make sure auth-card is visible since we are inside it
        document.getElementById('auth-card').classList.remove('hidden');
        
        loginView.classList.remove('hidden');
        loginView.classList.add('animate-fade-in');
    }, 280);
}

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
                renderEvaluationCompletedState();
            } else if (mode === 'pills') {
                pillsConstructionView?.classList.remove('hidden');
                pillsConstructionView?.classList.add('animate-fade-in');
                renderPillsList();
            } else {
                dashboardView.classList.remove('hidden');
                dashboardView.classList.add('animate-fade-in');
            }
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
    const sections = ['landing-page', 'quiz-interface', 'pills-quiz-interface', 'break-screen', 'results-screen'];
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

/** Especialidad tipo «UX/UI»: mitad UI Design y mitad UX Research en evaluación. */
function isUxUiDualSpecialty(especialidadRaw) {
    const n = normalizeLabelKey(especialidadRaw);
    if (!n) return false;
    if (n.includes('ux/ui') || n.includes('ux-ui')) return true;
    if (n === 'ux ui' || n === 'uxui') return true;
    if (n.includes('ux') && n.includes('ui') && (n.includes('/') || n.includes('-'))) return true;
    return false;
}

/** Especialidad UX (sin UI): incluye etiquetas UX, UX Research o UX Researcher. */
function isUxOnlySpecialty(especialidadRaw) {
    const n = normalizeLabelKey(especialidadRaw);
    if (!n) return false;
    if (isUxUiDualSpecialty(especialidadRaw)) return false;
    return n === 'ux' || n === 'ux research' || n === 'ux researcher';
}

/**
 * Especialidad UX Writing / UX Writer: debe ver preguntas con Cat = "UX Writing".
 * Cubre: "UX Writer", "UX Writing", "ux writer", "writing", etc.
 */
function isUxWritingSpecialty(especialidadRaw) {
    const n = normalizeLabelKey(especialidadRaw);
    if (!n) return false;
    if (isUxUiDualSpecialty(especialidadRaw)) return false;
    return n === 'ux writer' || n === 'ux writing' || n === 'writing' ||
           n.includes('ux writer') || n.includes('ux writing');
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
    const n = normalizeLabelKey(especialidadRaw);
    if (!n) return false;
    if (isUxUiDualSpecialty(especialidadRaw)) return false;
    return n === 'ui' || n === 'ui design' || n === 'ui designer' ||
           (n.startsWith('ui') && !n.includes('ux'));
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

    const matched = normalizedQuestions.filter((q) => {
        const qNorm = q.seniority;
        const qRaw = String(q.seniorityRaw || '').trim();
        const seniorityOk =
            (userNorm && qNorm && userNorm === qNorm) ||
            (userRaw && qRaw && stripAccents(userRaw) === stripAccents(qRaw));
        if (!seniorityOk) return false;
        return categoryMatchesUserEspecialidad(q.category, esp);
    });

    if (matched.length === 0 && normalizedQuestions.length > 0) {
        if (DEBUG) {
            const uniqueQSeniorities = [...new Set(normalizedQuestions.map(q => q.seniorityRaw).filter(Boolean))];
            const uniqueQCats = [...new Set(normalizedQuestions.map(q => q.category).filter(Boolean))];
            console.warn(
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
        if (DEBUG) console.warn('fetchPillQuestions error:', error);
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
        console.warn('loadPillRatingsForList error:', e);
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
        console.warn('savePillRating error:', e);
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

    const sorted = [...pillsCatalog].sort((a, b) =>
        String(a.name || a.id).localeCompare(String(b.name || b.id), 'es')
    );
    await loadPillRatingsForList(sorted.map((p) => p.id));

    grid.innerHTML = '';
    sorted.forEach((pill) => {
        const card = document.createElement('div');
        card.className = 'pills-category-card';
        if (pill.id != null && pill.id !== '') card.setAttribute('data-pill-id', String(pill.id));
        const content = document.createElement('div');
        content.className = 'pills-category-card__content';

        const title = document.createElement('h3');
        title.className = 'pills-category-card__title';
        title.textContent = pill.name || pill.id || T.common.pillFallback;

        const meta = document.createElement('p');
        meta.className = 'pills-category-card__meta';
        const catLine = pill.category ? `${pill.category}` : '';
        const desc = pill.description ? String(pill.description).slice(0, 140) + (pill.description.length > 140 ? '…' : '') : '';
        meta.textContent = [catLine, desc].filter(Boolean).join(' · ') || T.pills.metaFallback;

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
        btnPreview.className = 'btn-outline-blue pills-btn-preview pills-card-action-btn';
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
        btnStart.className = 'btn-cta pills-btn-start pills-card-action-btn';
        btnStart.textContent = T.pills.answerQuestions;
        btnStart.addEventListener('click', () => window.startPillsQuiz(pill.id));

        actions.appendChild(btnPreview);
        actions.appendChild(btnStart);
        content.appendChild(title);
        content.appendChild(meta);
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
        console.error('openPillPreview', e);
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
            category: String(parent?.category || '').trim()
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
            const btnBack = document.getElementById('btn-back-header');
            if (btnBack) btnBack.classList.remove('hidden');
            loadPillsQuestion();
        });
    } catch (e) {
        console.error('startPillsQuiz', e);
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
        const btnBackHeader = document.getElementById('btn-back-header');
        if (btnBackHeader) btnBackHeader.classList.remove('hidden');
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
        
        document.getElementById('auth-card').classList.add('hidden'); // Changed to hide
        document.getElementById('login-view').classList.add('hidden');
        document.getElementById('profile-view').classList.remove('hidden');

        // La Navbar (main-header) se mantiene visible en el dashboard
        document.getElementById('main-header').classList.remove('hidden');
        const btnBackHeader = document.getElementById('btn-back-header');
        if (btnBackHeader) btnBackHeader.classList.add('hidden');

        document.getElementById('feedback-panel').classList.add('hidden');
        document.getElementById('feedback-overlay').classList.add('hidden');
        updatePoolCount();
    });
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
        console.warn('[anti-cheat] evaluation violation detected:', { reason, count: nextCount });
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
    const name = userName || "campeón";
    return [
        { title: `¡Bien hecho ${name}!`, msg: "Ya has completado el primer bloque. Respira y seguimos." },
        { title: `¡Vas increíble ${name}!`, msg: "Has llegado al 50% de la prueba. Mantén el enfoque." },
        { title: `¡Último esfuerzo ${name}!`, msg: "Solo queda un bloque más. ¡Tú puedes con esto!" }
    ];
}

function showBreakScreen() {
    window.scrollTo(0, 0);

    const messages = getBreakMessages();
    const breakIndex = (currentIndex / 5) - 1;
    const content = messages[breakIndex] || { title: `¡Sigue así ${userName || "campeón"}!`, msg: "Tómate un momento para recargar energía." };

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
        const { data, error } = await supabase
            .from('ranking_user')
            .select('email, nombre, pills_points, pills_rank_tiempo')
            .eq('pills_rank_pill_id', pillId)
            .limit(80);
        if (error) throw error;
        const rows = (data || []).map(d => ({
            id: d.email,
            email: d.email,
            nombre: d.nombre,
            pillsPoints: d.pills_points,
            pillsRankTiempo: d.pills_rank_tiempo
        }));
        rows.sort((a, b) => {
            const pd = Number(b.pillsPoints || 0) - Number(a.pillsPoints || 0);
            if (pd !== 0) return pd;
            return Number(a.pillsRankTiempo ?? 999999999) - Number(b.pillsRankTiempo ?? 999999999);
        });
        return rows.slice(0, limitN);
    } catch (e) {
        console.warn('fetchLatestPillRankingRows', e);
        throw e;
    }
}

async function saveScoreToCloud(finalScore, timeSeconds) {
    if (!supabase || !userEmail) return false;

    const pointsFieldByMode = {
        practice: 'quest_points',
        evaluation: 'tests_points',
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
        if (DEBUG) console.warn('saveScoreToCloud: no auth user id available');
        return false;
    }

    try {
        let existingPillAttempt = null;
        let isPillFirstAttempt = true;
        let pillAttemptQueryFailed = false;
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
                if (DEBUG) console.warn('saveScoreToCloud: pill attempt lookup fallback failed', firstAttemptErr);
            }
            existingPillAttempt = firstAttemptRow || null;
            if (existingPillAttempt) isPillFirstAttempt = false;
        }

        // Leer ranking actual
        const { data: rankingData } = await supabase
            .from('ranking_user')
            .select('*')
            .eq('email', userEmail.toLowerCase())
            .single();

        const existing = rankingData || {};

        const latestPill = getLatestPublishedPill();
        const isLatestPillSession =
            currentQuizMode === 'pills' && latestPill && selectedPillId === latestPill.id;
        const pillsRankingLockedByRanking =
            isLatestPillSession && String(existing.pills_rank_pill_id || '') === String(selectedPillId);
        if (pillsRankingLockedByRanking) isPillFirstAttempt = false;
        const pillsRankingLocked =
            currentQuizMode === 'pills' && selectedPillId && (pillsRankingLockedByRanking || !isPillFirstAttempt);

        const rankingMerge = {
            user_id: userId,
            nombre: userName,
            email: userEmail.toLowerCase(),
            fecha: new Date().toISOString()
        };
        let shouldUpdate = false;

        if (currentQuizMode === 'practice') {
            const cur = Number(existing.quest_points || 0);
            const next = Number(finalScore || 0);
            rankingMerge.quest_points = Math.max(cur, next);
            shouldUpdate = next > cur;
        } else if (currentQuizMode === 'evaluation') {
            const isFirstEvalAttempt = existing.tests_points == null;
            if (isFirstEvalAttempt) {
                rankingMerge.tests_points = Number(finalScore || 0);
            }
        } else if (currentQuizMode === 'pills') {
            if (isLatestPillSession && !pillsRankingLockedByRanking) {
                rankingMerge.pills_points = Number(finalScore || 0);
                rankingMerge.pills_rank_pill_id = selectedPillId;
                rankingMerge.pills_rank_tiempo = Number(timeSeconds || 0);
            }
        } else {
            const cur = Number(existing[pointsField] || 0);
            rankingMerge[pointsField] = Math.max(cur, Number(finalScore || 0));
        }

        const { error: rankingUpsertError } = await supabase
            .from('ranking_user')
            .upsert(rankingMerge, { onConflict: 'email' });
        if (rankingUpsertError) throw rankingUpsertError;

        // Verificación defensiva para práctica: confirmar que quedó persistido el mejor récord.
        if (currentQuizMode === 'practice') {
            const expectedBest = Number(rankingMerge.quest_points || 0);
            const { data: persistedRow, error: persistedReadError } = await supabase
                .from('ranking_user')
                .select('quest_points')
                .eq('email', userEmail.toLowerCase())
                .single();
            if (persistedReadError) throw persistedReadError;
            const persistedBest = Number(persistedRow?.quest_points || 0);
            if (persistedBest < expectedBest) {
                const { error: forceUpdateError } = await supabase
                    .from('ranking_user')
                    .update({ quest_points: expectedBest, fecha: new Date().toISOString() })
                    .eq('email', userEmail.toLowerCase())
                    .eq('user_id', userId);
                if (forceUpdateError) throw forceUpdateError;
            }
        }

        if (currentQuizMode === 'evaluation') {
            const newScore = Number(finalScore || 0);
            const newTime = Number(timeSeconds || 0);
            const isFirstEvalAttempt = existing.tests_points == null;

            shouldUpdate = isFirstEvalAttempt;

            if (shouldUpdate) {
                const { error: evalLegacyUpsertError } = await supabase.from('ranking_user').upsert({
                    user_id: userId,
                    nombre: userName,
                    email: userEmail.toLowerCase(),
                    puntos: newScore,
                    tiempo: newTime,
                    fecha: new Date().toISOString()
                }, { onConflict: 'email' });
                if (evalLegacyUpsertError) throw evalLegacyUpsertError;

                // Guardar errores en localStorage para que el usuario pueda estudiarlos después
                try {
                    const evalErrorsKey = `uixlingo_eval_errors:${userId}`;
                    const errorsToSave = errors.map(e => ({ question: e.question, studyTag: e.studyTag }));
                    localStorage.setItem(evalErrorsKey, JSON.stringify(errorsToSave));
                } catch (lsErr) {
                    console.warn('saveScoreToCloud: no se pudieron guardar errores en localStorage', lsErr);
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
                isPillFirstAttempt &&
                !existingPillAttempt &&
                !pillAttemptQueryFailed;
            if (canPersistFirstAttemptAux) {
                const totalQs = Math.max(Number(currentSession?.length || 0), 0);
                const errCount = Math.max(totalQs - Number(finalScore || 0), 0);
                const stickerGranted = totalQs > 0 && errCount <= 1;
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
            } else if (currentQuizMode === 'pills' && selectedPillId && existingPillAttempt) {
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
            if (currentQuizMode === 'pills' && isLatestPillSession && !pillsRankingLockedByRanking) {
                userProfile.latestPillRankId = String(selectedPillId || '').trim();
            }
            renderProfile();
            updatePracticeRankUI();
        }

        return shouldUpdate;
    } catch (e) {
        console.warn('saveScoreToCloud error:', e);
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
                evaluation: 'tests_points',
                quest: 'quest_points',
                practice: 'quest_points',
                pills: 'pills_points'
            };
            const pointsField = modeFieldMap[mode] || 'tests_points';
            const { data: rawUsers, error } = await supabase
                .from('ranking_user')
                .select('email, nombre, tiempo, quest_points, tests_points, pills_points')
                .order(pointsField, { ascending: false })
                .limit(50);
            if (error) throw error;

            let users = (rawUsers || []).map(d => ({
                id: d.email,
                email: d.email,
                nombre: d.nombre,
                tiempo: d.tiempo,
                questPoints: d.quest_points,
                quest_points: d.quest_points,
                tests_points: d.tests_points,
                pills_points: d.pills_points
            }));

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
        const btnBack = document.getElementById('btn-back-header');
        if (btnBack) btnBack.classList.add('hidden');

        document.getElementById('feedback-panel')?.classList.add('hidden');
        document.getElementById('feedback-overlay')?.classList.add('hidden');

        renderPillsList();
        window.scrollTo(0, 0);
    });
};

async function showPillsResultsInScreen() {
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
        } else if (errCountPill <= 1) {
            stickerEl.classList.add('results-pills-sticker--win');
            prizeImg = MATERIAL.pillGanaste;
            prizeAlt = T.pills.stickerAltWin;
            prizeHtml = T.pills.stickerHtmlWin;
        } else {
            stickerEl.classList.add('results-pills-sticker--lose');
            prizeImg = MATERIAL.pillPerder;
            prizeAlt = T.pills.stickerAltLose;
            prizeHtml = T.pills.stickerHtmlLose;
        }
        if (stickerImgEl) {
            stickerImgEl.src = prizeImg;
            stickerImgEl.alt = prizeAlt;
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
