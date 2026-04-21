// Security: HTML escape to prevent XSS when inserting external data into innerHTML
export function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

// Security: Validates FontAwesome icon class names (only allow fa- prefixed alphanumeric-hyphen names)
export function safeIconClass(icon) {
    return /^fa-[a-z0-9-]+$/.test(icon || '') ? icon : 'fa-question';
}

/** Solo http(s) para <img src>; evita javascript: y datos no URL. */
export function safeTalentImageUrl(url) {
    const s = String(url ?? '').trim();
    if (!s) return '';
    try {
        const u = new URL(s);
        if (u.protocol === 'https:' || u.protocol === 'http:') return s;
    } catch (_) {
        /* ignore */
    }
    return '';
}

/**
 * URLs seguras para window.open y enlaces externos: solo http(s) absolutas, o rutas relativas al mismo origen.
 * Rechaza javascript:, data: y URLs opacas no http(s).
 */
export function safeHttpUrl(url) {
    const s = String(url ?? '').trim();
    if (!s) return '';
    try {
        const u = new URL(s);
        if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
    } catch (_) {
        /* no es URL absoluta */
    }
    try {
        if (s.startsWith('/') && !s.startsWith('//')) {
            return new URL(s, window.location.origin).href;
        }
    } catch (_) {
        /* ignore */
    }
    return '';
}

/** Baraja copia del array (Fisher–Yates). */
export function shuffleFisherYates(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}
