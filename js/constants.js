/** URL y clave anónima de Supabase (públicas en cliente). */
export const SUPABASE_URL = 'https://pmezmoobuwwbirwzensj.supabase.co';
export const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtZXptb29idXd3Ymlyd3plbnNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwOTE0NjgsImV4cCI6MjA5MDY2NzQ2OH0.CCl6PJ-bJQATkUgeajz-M1foB_p8l6iS8tX5C079SE8';

/** Imágenes públicas en Storage (bucket `materiales`) */
export const MATERIAL_STORAGE_PUBLIC =
    'https://pmezmoobuwwbirwzensj.supabase.co/storage/v1/object/public/materiales';

export const MATERIAL = {
    logo: `${MATERIAL_STORAGE_PUBLIC}/logo.png`,
    favicon: `${MATERIAL_STORAGE_PUBLIC}/favicon.webp`,
    breakWebp: (n) => `${MATERIAL_STORAGE_PUBLIC}/${n}.webp`,
    pillGanaste: `${MATERIAL_STORAGE_PUBLIC}/ganaste.webp`,
    pillPerder: `${MATERIAL_STORAGE_PUBLIC}/perder.webp`,
    pillGeneral: `${MATERIAL_STORAGE_PUBLIC}/general.webp`
};

export const SESSION_LENGTH = 20;
export const EVALUATION_SESSION_LENGTH = 15;
/** Sesión evaluación especialidad UX/UI: 8 UI Design + 8 UX Research cuando el pool lo permite. */
export const EVALUATION_SESSION_LENGTH_UX_UI = 16;
/** Sesión evaluación especialidad UX (no UX/UI): hasta 15 preguntas. */
export const EVALUATION_SESSION_LENGTH_UX_ONLY = 15;

/** Activar solo en desarrollo: logs extra en consola (no exponer en producción). */
export const DEBUG = false;

export const EVALUATION_QUESTION_TIME = 30;
export const ENABLE_EVAL_HARD_BLOCK = true;
export const EVAL_VIOLATION_STORAGE_PREFIX = 'uix_eval_violations_v1';
export const EVAL_FOCUS_EVENT_DEBOUNCE_MS = 1200;

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_COOLDOWN_MS = 30_000;

/** Rate-limit suave en login (mutado en auth). */
export const _loginGuard = { count: 0, blockedUntil: 0 };

export const PILLS_SWIPE_THRESHOLD = 90;
/** Desktop: cuánto hay que arrastrar hacia abajo para confirmar (hacia los botones). */
export const PILLS_SWIPE_THRESHOLD_DESKTOP_Y = 76;

export const PILLS_HINT_DEAD_PX = 14;

/** Path fijo para el redirect de recuperación de contraseña. Debe estar en Supabase > Auth > Redirect URLs. */
export const RESET_PASSWORD_PATH = '/reset-password';
/** Dominio público canónico para links de recuperación enviados por correo. */
export const PUBLIC_APP_ORIGIN = 'https://uixlingo-user-version.vercel.app';
