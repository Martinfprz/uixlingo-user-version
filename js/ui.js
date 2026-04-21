import { UI_TEXT } from './copy.js';

const D = UI_TEXT.dialog;

let appDialogInitialized = false;
let appDialogOverlayEl = null;
let appDialogEl = null;
let appDialogTitleEl = null;
let appDialogMessageEl = null;
let appDialogIconEl = null;
let appDialogCancelEl = null;
let appDialogConfirmEl = null;
let appDialogResolver = null;

function initAppDialog() {
    if (appDialogInitialized) return;

    appDialogOverlayEl = document.getElementById('app-dialog-overlay');
    appDialogEl = document.getElementById('app-dialog');
    appDialogTitleEl = document.getElementById('app-dialog-title');
    appDialogMessageEl = document.getElementById('app-dialog-message');
    appDialogIconEl = document.getElementById('app-dialog-icon');
    appDialogCancelEl = document.getElementById('app-dialog-cancel');
    appDialogConfirmEl = document.getElementById('app-dialog-confirm');

    if (!appDialogOverlayEl || !appDialogEl || !appDialogTitleEl || !appDialogMessageEl || !appDialogIconEl || !appDialogCancelEl || !appDialogConfirmEl) {
        return;
    }

    appDialogOverlayEl.addEventListener('click', (e) => {
        if (e.target === appDialogOverlayEl && appDialogResolver) appDialogResolver(false);
    });

    document.addEventListener('keydown', (e) => {
        if (!appDialogResolver || appDialogOverlayEl.classList.contains('hidden')) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            appDialogResolver(false);
            return;
        }

        if (e.key === 'Tab') {
            const focusables = [appDialogCancelEl, appDialogConfirmEl].filter(el => !el.classList.contains('hidden'));
            if (focusables.length === 0) return;
            const dialogFocusIndex = focusables.indexOf(document.activeElement);
            let nextIndex;
            if (e.shiftKey) nextIndex = dialogFocusIndex <= 0 ? focusables.length - 1 : dialogFocusIndex - 1;
            else nextIndex = dialogFocusIndex >= focusables.length - 1 ? 0 : dialogFocusIndex + 1;
            e.preventDefault();
            focusables[nextIndex].focus();
        }
    });

    appDialogInitialized = true;
}

function getDialogIconClass(variant) {
    if (variant === 'warning') return 'fas fa-triangle-exclamation';
    if (variant === 'error') return 'fas fa-circle-xmark';
    if (variant === 'success') return 'fas fa-circle-check';
    return 'fas fa-circle-info';
}

function openAppDialog({
    title = D.title,
    message = '',
    variant = 'info',
    confirmText = D.confirm,
    cancelText = D.cancel,
    isConfirm = false
}) {
    initAppDialog();
    if (!appDialogInitialized) {
        if (isConfirm) return Promise.resolve(window.confirm(message || title));
        window.alert(message || title);
        return Promise.resolve(true);
    }

    appDialogOverlayEl.setAttribute('data-variant', variant);
    appDialogTitleEl.innerText = title;
    appDialogMessageEl.innerText = message;
    appDialogIconEl.innerHTML = `<i class="${getDialogIconClass(variant)}"></i>`;

    appDialogConfirmEl.innerText = confirmText;
    appDialogCancelEl.innerText = cancelText;

    /* Confirmación: acción segura arriba (primary), destructiva abajo (outline). Alert: un solo primary. */
    if (isConfirm) {
        appDialogCancelEl.className = 'btn-primary';
        appDialogConfirmEl.className = 'btn-outline-blue';
    } else {
        appDialogCancelEl.className = 'btn-outline-blue hidden';
        appDialogConfirmEl.className = 'btn-primary';
    }

    appDialogOverlayEl.classList.remove('hidden');
    appDialogOverlayEl.setAttribute('aria-hidden', 'false');

    return new Promise((resolve) => {
        const cleanup = () => {
            appDialogConfirmEl.onclick = null;
            appDialogCancelEl.onclick = null;
            appDialogResolver = null;
            appDialogOverlayEl.classList.add('hidden');
            appDialogOverlayEl.setAttribute('aria-hidden', 'true');
        };

        appDialogResolver = (value) => {
            cleanup();
            resolve(value);
        };

        appDialogConfirmEl.onclick = () => appDialogResolver(true);
        appDialogCancelEl.onclick = () => appDialogResolver(false);

        const firstFocus = isConfirm ? appDialogCancelEl : appDialogConfirmEl;
        setTimeout(() => firstFocus.focus(), 10);
    });
}

export function showAppAlert({ title = D.title, message = '', variant = 'info', confirmText = D.confirm }) {
    return openAppDialog({ title, message, variant, confirmText, isConfirm: false });
}

export function showAppConfirm({
    title = D.confirmDialogTitle,
    message = '',
    confirmText = D.confirmContinue,
    cancelText = D.cancel,
    variant = 'warning'
}) {
    return openAppDialog({ title, message, variant, confirmText, cancelText, isConfirm: true });
}
