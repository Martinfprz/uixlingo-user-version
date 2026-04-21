// --- SISTEMA DE TEMAS (Dark / Light) ---

function _updateThemeIcon(theme) {
    const icon = document.getElementById('theme-icon');
    if (!icon) return;
    icon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
}

export function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('uixlingo-theme', next);
    _updateThemeIcon(next);
}

window.toggleTheme = toggleTheme;

// Actualizar ícono al cargar (el data-theme ya fue aplicado por el script inline del <head>)
window.addEventListener('DOMContentLoaded', () => {
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    _updateThemeIcon(theme);
});

// Sincronizar con cambios de preferencia del sistema (solo si el usuario no eligió manualmente)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('uixlingo-theme')) {
        const theme = e.matches ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        _updateThemeIcon(theme);
    }
});
