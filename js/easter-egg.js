(function () {
    const COMBO = [
        'ArrowUp', 'ArrowUp',
        'ArrowDown', 'ArrowDown',
        'ArrowLeft', 'ArrowRight',
        'ArrowLeft', 'ArrowRight'
    ];
    let progress = 0;
    let resetTimer = null;

    function isOnHome() {
        const profileView = document.getElementById('profile-view');
        const landingPage = document.getElementById('landing-page');
        const quizInterface = document.getElementById('quiz-interface');
        const pillsQuiz = document.getElementById('pills-quiz-interface');
        const breakScreen = document.getElementById('break-screen');
        const resultsScreen = document.getElementById('results-screen');

        const quizActive =
            (quizInterface && !quizInterface.classList.contains('hidden')) ||
            (pillsQuiz && !pillsQuiz.classList.contains('hidden')) ||
            (breakScreen && !breakScreen.classList.contains('hidden')) ||
            (resultsScreen && !resultsScreen.classList.contains('hidden'));

        if (quizActive) return false;

        const profileVisible = profileView && !profileView.classList.contains('hidden');
        const landingVisible = landingPage && !landingPage.classList.contains('hidden');
        return profileVisible || landingVisible;
    }

    function triggerEasterEgg() {
        const modal = document.getElementById('easter-egg-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.classList.add('easter-egg--entering');
        setTimeout(() => modal.classList.remove('easter-egg--entering'), 400);

        if (typeof confetti === 'function') {
            confetti({
                particleCount: 120,
                spread: 80,
                origin: { y: 0.5 },
                colors: ['#8c59fe', '#ace738', '#ffffff', '#c084fc'],
                zIndex: 9999,
            });
        }
    }

    // — Teclado (desktop) —
    document.addEventListener('keydown', function (e) {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            progress = 0;
            return;
        }
        if (!isOnHome()) { progress = 0; return; }

        clearTimeout(resetTimer);

        if (e.key === COMBO[progress]) {
            progress++;
            if (progress === COMBO.length) {
                progress = 0;
                triggerEasterEgg();
            }
        } else {
            progress = e.key === COMBO[0] ? 1 : 0;
        }

        resetTimer = setTimeout(() => { progress = 0; }, 2000);
    });

    // — Logo: 7 taps en home (mobile) / navegación normal fuera del home —
    const TAP_GOAL = 7;
    const TAP_WINDOW = 3000;
    let tapCount = 0;
    let tapTimer = null;

    document.addEventListener('DOMContentLoaded', function () {
        const logoWrapper = document.querySelector('.logo-wrapper');
        const homeLogo = document.getElementById('home-logo');

        if (logoWrapper) {
            logoWrapper.addEventListener('click', function () {
                if (!isOnHome()) {
                    // Fuera del home: comportamiento normal de navegación
                    tapCount = 0;
                    clearTimeout(tapTimer);
                    if (typeof handleHeaderClick === 'function') handleHeaderClick();
                    return;
                }

                // En home: contar taps para el easter egg
                clearTimeout(tapTimer);
                tapCount++;

                if (tapCount >= TAP_GOAL) {
                    tapCount = 0;
                    triggerEasterEgg();
                    return;
                }

                tapTimer = setTimeout(() => { tapCount = 0; }, TAP_WINDOW);
            });

            logoWrapper.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    logoWrapper.click();
                }
            });
        }

        if (homeLogo) {
            homeLogo.addEventListener('click', function () {
                clearTimeout(tapTimer);
                tapCount++;

                if (tapCount >= TAP_GOAL) {
                    tapCount = 0;
                    triggerEasterEgg();
                    return;
                }

                tapTimer = setTimeout(() => { tapCount = 0; }, TAP_WINDOW);
            });
        }
    });

    // — Cerrar modal —
    document.addEventListener('click', function (e) {
        const modal = document.getElementById('easter-egg-modal');
        if (!modal || modal.classList.contains('hidden')) return;
        if (e.target === modal || e.target.id === 'easter-egg-close') {
            modal.classList.add('hidden');
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            const modal = document.getElementById('easter-egg-modal');
            if (modal && !modal.classList.contains('hidden')) {
                modal.classList.add('hidden');
            }
        }
    });
})();
