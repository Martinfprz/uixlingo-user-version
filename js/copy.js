/**
 * Textos de UI centralizados (mantenimiento e internacionalización futura).
 * Plantillas dinámicas en `fmt`.
 */
import {
    EVALUATION_SESSION_LENGTH_UX_UI,
    EVALUATION_SESSION_LENGTH_UX_ONLY,
} from './constants.js';

export const UI_TEXT = {
    common: {
        loading: 'Cargando...',
        loadingProfile: 'Cargando tu perfil...',
        preparingContent: 'Preparando contenido...',
        understood: 'Entendido',
        close: 'Cerrar',
        continue: 'Continuar',
        accept: 'Aceptar',
        cancel: 'Cancelar',
        error: 'Error',
        yesExit: 'Sí, salir',
        yesBackToMenu: 'Sí, volver al menú',
        copied: '¡Copiado!',
        copyTopicsPrefix: 'Temas a reforzar UX/UI:\n- ',
        copyTopicPrefix: 'Tema a reforzar: ',
        anonymous: 'Anónimo',
        dash: '—',
        pillFallback: 'Pill',
        skillFallback: 'Habilidad',
        sealFallback: 'Sello',
    },

    dialog: {
        title: 'Aviso',
        confirm: 'Aceptar',
        cancel: 'Cancelar',
        confirmDialogTitle: 'Confirmación',
        confirmContinue: 'Continuar',
    },

    auth: {
        loginTitle: 'Inicia sesión',
        loginButton: 'Iniciar sesión',
        loginButtonSpinner: '<i class="fas fa-circle-notch animate-spin"></i> Entrando...',
        emailValidating: '<i class="fas fa-circle-notch animate-spin"></i> Validando correo...',
        emailValidated: '<i class="fas fa-circle-check"></i> Correo validado',
        firstLoginModalTitle: 'Seguridad de Cuenta',
        firstLoginModalDesc: 'Es tu primer inicio de sesión. Por favor, establece una nueva contraseña segura para continuar.',
        forgotSending: 'Enviando...',
        forgotSent: '¡Correo enviado!',
        passwordMinError: 'La contraseña debe tener al menos 8 caracteres.',
        passwordMismatch: 'Las contraseñas no coinciden.',
        passwordSameAsOld: 'La nueva contraseña no puede ser igual a la actual.',
        savePasswordSpinner: '<i class="fas fa-circle-notch animate-spin"></i> Guardando...',
        savePasswordBtn: 'GUARDAR Y CONTINUAR',
        recoverySavePasswordBtn: 'ACTUALIZAR CONTRASEÑA',
        savePasswordError: 'Error al guardar. Intenta de nuevo.',
        passwordCreatedTitle: '¡Contraseña creada!',
        passwordCreatedMessage: 'Tu contraseña fue guardada. A partir de ahora úsala para iniciar sesión.',
        recoveryModalTitle: 'Establece tu nueva contraseña',
        recoveryModalDesc: 'El link de recuperación es válido. Ingresa la contraseña que usarás para iniciar sesión.',
        recoverySuccessTitle: '¡Contraseña actualizada!',
        recoverySuccessMessage: 'Tu contraseña fue actualizada correctamente. Inicia sesión con la nueva contraseña.',
    },

    alerts: {
        emailNotRegisteredTitle: 'Correo no registrado',
        emailNotRegisteredMessage: (email) =>
            `El correo ${email} no está registrado en la plataforma. Verifica que sea el correo correcto.`,
        verifyConnectionTitle: 'Error de conexión',
        verifyConnectionMessage: 'No se pudo verificar el correo. Intenta de nuevo.',
        resetErrorTitle: 'Error',
        resetErrorMessage: 'No se pudo enviar el correo. Intenta de nuevo.',
        resetRateLimitTitle: 'Demasiados intentos',
        resetRateLimitMessage:
            'Hiciste demasiadas solicitudes de recuperación. Espera un momento y vuelve a intentar.',
        resetRedirectTitle: 'Configuración de enlace no válida',
        resetRedirectMessage:
            'No se pudo generar el enlace de recuperación para esta URL. Contacta al equipo para validar Redirect URLs en Supabase.',
        resetUserNotFoundTitle: 'Cuenta no disponible',
        resetUserNotFoundMessage:
            'No fue posible enviar la recuperación porque la cuenta no está disponible en Authentication.',
        resetProviderErrorTitle: 'Servicio de correo no disponible',
        resetProviderErrorMessage:
            'El proveedor de correo no respondió. Intenta nuevamente en unos minutos.',
        resetUnexpectedWithDetail: (detail) =>
            `No se pudo enviar el correo de recuperación. Detalle: ${detail}`,
        resetCheckEmailTitle: 'Revisa tu correo',
        resetCheckEmailMessage: (email) =>
            `Se envió un enlace de recuperación a ${email}. Úsalo para establecer una nueva contraseña.`,
        recoveryInvalidTitle: 'Enlace inválido o expirado',
        recoveryInvalidMessage: 'El enlace de recuperación no es válido o ya expiró. Solicita uno nuevo desde la pantalla de inicio.',
        tooManyAttemptsTitle: 'Demasiados intentos',
        tooManyAttemptsMessage: (sec) =>
            `Por seguridad, espera ${sec}s antes de intentar de nuevo.`,
        loginInvalidTitle: 'Acceso no válido',
        loginInvalidMessage: 'Contraseña incorrecta o correo no registrado. Intenta de nuevo.',
        profileLoadErrorTitle: 'Error al cargar perfil',
        profileLoadErrorMessage: 'Sesión iniciada, pero no se pudo cargar el perfil. Intenta de nuevo.',
        loginFailedTitle: 'Error',
        loginFailedMessage: 'No se pudo iniciar sesión. Intenta de nuevo.',
        guestModeTitle: 'Modo no disponible',
        guestModeMessage: 'El modo invitado ya no está disponible. Por favor inicia sesión con tu cuenta.',
        imageTooBigTitle: 'Imagen muy grande',
        imageTooBigMessage: 'La imagen no puede superar los 2MB.',
        pillVideoMissingTitle: 'Sin enlace de video',
        pillVideoMissingMessage: 'Próximamente se subirá la pill',
        pillExperienceDefaultDesc:
            'Aquí puedes abrir el video o el material de la pill, o pasar al reto de preguntas cuando estés listo.',
        ratingLoginTitle: 'Inicia sesión',
        ratingLoginMessage: 'Debes iniciar sesión para calificar una pill.',
        ratingSaveErrorTitle: 'No se pudo calificar',
        ratingSaveErrorMessage: 'No fue posible guardar tu voto en este momento.',
        noConnectionTitle: 'Sin conexión',
        noConnectionMessage: 'Supabase no está disponible.',
        pillLoadErrorTitle: 'Error al cargar',
        pillLoadErrorMessage: 'No se pudieron leer las preguntas de la pill.',
        pillNoQuestionsTitle: 'Sin preguntas',
        pillNoQuestionsMessage: 'No hay preguntas activas (true/false) en pills/{id}/questions.',
        pillQuizErrorMessage: 'No se pudo iniciar el quiz de la pill.',
        pillsChooseAreaTitle: 'Modo Pills',
        pillsChooseAreaMessage: 'Elige un área en la lista de Pills y usa «Contestar preguntas».',
        evaluationBlockedTitle: 'Evaluación bloqueada',
        evaluationBlockedMessage: 'La prueba fue bloqueada por conductas no permitidas.',
        noQuestionsTitle: 'Sin preguntas disponibles',
        noQuestionsEvaluationMessage:
            'No hay preguntas de UI Design o UX Research / UX Researcher que coincidan con tu nivel para armar la evaluación UX/UI.',
        noQuestionsEvalRanking:
            'No hay preguntas que coincidan con tu seniority y especialidad registradas en ranking_user (y los campos Seniority / Cat en preguntas_evaluacion).',
        noQuestionsPracticeMode:
            'No se encontraron preguntas para las categorías seleccionadas en este modo.',
        confirmStayPractice: 'Continuar prueba',
        confirmStayTest: 'Seguir en prueba',
        abandonSessionTitle: 'Abandonar sesión',
        abandonSessionMessage: '¿Seguro que quieres abandonar la sesión actual?',
        exitTestTitle: 'Salir de la prueba',
        exitTestMessage: '¿Seguro que quieres abandonar la sesión actual y volver al menú?',
        clipboardErrorTitle: 'Error al copiar',
        clipboardErrorMessage: 'No se pudo copiar al portapapeles.',
        leaderboardConnectionTitle: 'Error de conexión:',
        leaderboardConnectionHint: 'Verifica la conexión con Supabase.',
        supabaseConfigError: 'Error: Configura Supabase en el código',
    },

    profile: {
        pointsPills: 'Pts. Pills',
        rankCalculating: 'Calculando ranking de práctica...',
        talentsEmpty: `
            <div class="bento-empty-state">
                <i class="fas fa-puzzle-piece"></i>
                <p>Aún no tienes habilidades asignadas</p>
            </div>`,
        rankUnavailable: 'Ranking de práctica no disponible',
        rankEmpty: 'Aún no hay ranking de práctica',
        rankNoPosition: 'Aún sin posición en ranking de práctica',
        rankPosition: (n) => `Puesto #${n} en ranking de práctica`,
        rankLoadError: 'No se pudo cargar tu ranking de práctica',
        sealsEmpty: `
            <div class="bento-empty-state">
                <i class="fas fa-award"></i>
                <p>Aún no tienes sellos. ¡Sigue practicando!</p>
            </div>`,
        topicToReview: 'Tema a reforzar',
        explorador: 'Explorador',
        sinRegistrar: 'Sin registrar',
        noSeniorityLabel: 'No definido',
    },

    dashboard: {
        modePractice: 'Modo Práctica',
        modeEvaluation: 'Modo Evaluación',
        modePills: 'Modo Pills',
    },

    pills: {
        emptyGrid: `
            <div class="evaluation-brief-card pills-empty-state">
                <p class="pills-construction-text">No hay documentos en la colección <strong>pills</strong>. Crea una pill en Supabase.</p>
            </div>`,
        metaFallback: 'Preguntas en la subcolección questions',
        ratePill: 'Califica la pill',
        starLabel: (i) => `Calificar con ${i} estrella${i > 1 ? 's' : ''}`,
        averagePrefix: 'Promedio: ',
        viewPill: 'Ver pill',
        noLinkYet: 'Esta pill aún no tiene enlace disponible',
        answerQuestions: 'Contestar preguntas',
        pillPreviewNoActive: 'No hay preguntas activas en esta pill todavía.',
        pillPreviewFair: (n) =>
            `Esta pill incluye ${n} pregunta(s) tipo verdadero/falso. No mostramos el texto de las preguntas aquí para que el reto sea justo.`,
        materialLinkPrefix: 'Enlace al material: ',
        noVotes: 'Sin votos',
        resultsTitle: 'Resultado de la pill',
        scoreOf: (total) => `de ${total}`,
        stickerAltResult: 'Resultado de la pill',
        stickerAltExtra: 'Intento adicional',
        stickerAltWin: '¡Ganaste el premio de la pill!',
        stickerAltLose: 'Sin premio en el primer intento',
        stickerHtmlNeutral: 'Sigue participando en las pills y podrás ganar stickers.',
        stickerHtmlWin:
            '¡Aprobado en primer intento! Has ganado el <strong>sticker</strong> de esta pill.',
        stickerHtmlLose:
            'Por el número de errores no obtienes el sticker de esta pill. Repasa el material y vuelve a intentarlo.',
    },

    feedback: {
        true: 'Verdadero',
        false: 'Falso',
        correct: '¡Correcto!',
        incorrect: 'Respuesta incorrecta',
        incorrectTitle: 'Respuesta Incorrecta',
        timeUpTitle: 'Tiempo agotado',
        next: 'SIGUIENTE',
        nextQuestion: 'IR A LA SIGUIENTE PREGUNTA',
        whyLabel: 'Por qué:',
        answerYour: 'Tu respuesta:',
        answerCorrect: 'Correcta:',
        recommendation: 'Recomendación:',
        timeUpMessage: (correctAnswerHtml, explanationHtml) =>
            `Se acabó el tiempo para responder.<br><strong class="feedback-correct-answer">Respuesta correcta: ${correctAnswerHtml}</strong>${explanationHtml}`,
        wrongMessage: (correctAnswerHtml, explanationHtml) =>
            `<strong class="feedback-correct-answer">Respuesta correcta: ${correctAnswerHtml}</strong>${explanationHtml}`,
    },

    quiz: {
        streakSeguidas: (n) => `${n} seguidas`,
        timerSeconds: (s) => `${s}s`,
    },

    evaluation: {
        blockedInline:
            'Tu evaluacion fue bloqueada por salir de la prueba 3 veces. El boton de inicio queda deshabilitado. Si necesitas ayuda, contacta al equipo Ops.',
        violation1Title: 'Cambiaste de pestaña 😬',
        violation1Message:
            'Tu evaluación se cerró porque cambiaste de pestaña. Manténte en una sola ventana para continuar con tu evaluación.',
        violation2Title: '¡Detente, UiXer! ✋',
        violation2Message:
            'Tu evaluación se cerró porque saliste de la pestaña. Si esto vuelve a pasar, tu evaluación será bloqueada.',
        violation3Title: '¡UiXer, lo hiciste otra vez! 😱',
        violation3Message:
            'Tu evaluación se bloqueó porque cambiaste de pestañas tres veces. Para continuar, por favor, contacta al equipo Ops.',
        noPool: (userLabel, espLabel) =>
            `Nivel «${userLabel}», especialidad «${espLabel}». No hay preguntas que cumplan seniority + área (Cat). Revisa ranking_user y preguntas_evaluacion.`,
        withPool: (userLabel, espLabel, n, detail) =>
            `Nivel «${userLabel}», especialidad «${espLabel}». Hay ${n} pregunta(s) disponibles para tu evaluación.${detail} Pulsa «Iniciar evaluación» cuando estés listo.`,
        detailUxUi: (uiN, uxN) =>
            ` Especialidad UX/UI: hasta ${EVALUATION_SESSION_LENGTH_UX_UI} preguntas mezclando UI Design (${uiN} en pool) y UX Research / UX Researcher (${uxN} en pool), lo más equilibrado posible.`,
        detailUxOnly: ` Especialidad UX: hasta ${EVALUATION_SESSION_LENGTH_UX_ONLY} preguntas.`,
        detailEspecialidad: (espLabel) =>
            ` Especialidad «${espLabel}»: solo preguntas cuyo Cat coincide con tu registro.`,
        detailNoEspecialidad:
            ' Sin especialidad en ranking_user: se filtra solo por seniority (todas las áreas que coincidan).',
        btnBlocked: 'EVALUACION BLOQUEADA',
        btnStart: 'INICIAR EVALUACION',
    },

    results: {
        pill: 'Resultado de la pill',
        evaluation: 'Resultado de Evaluación',
        levelUxUi: 'Tu Nivel UX/UI',
        correctLabel: (n) => `Correctas: ${n}`,
        incorrectLabel: (n) => `Incorrectas: ${n}`,
    },

    leaderboard: {
        loading: '<div class="leaderboard-loading"><i class="fas fa-circle-notch animate-spin"></i> Cargando...</div>',
        top10Title: '<i class="fas fa-trophy" style="color: #eab308;"></i> Top 10 Global',
        pillCurrent: 'Pill actual',
        firstTrySuffix: '(1.er intento)',
        noFirstTries: 'Aún no hay primeros intentos registrados para la pill actual.',
        pts: (n) => `${n} pts`,
        tiebreaker: (timeLine) => `${timeLine} · desempate`,
        rankingByPoints: 'Ranking por puntos',
        evaluationTime: (sec) => `${sec}s`,
    },

    labels: {
        seniority: {
            junior: 'Junior',
            medium: 'Medium',
            senior: 'Senior',
            product_designer: 'Product Designer',
            customer_experience: 'Customer Experience',
        },
    },

    fmt: {
        navGreeting: (firstName) => `Hola, ${firstName}`,
        loginWelcome: (firstName) => (firstName ? `Hola, ${firstName}` : 'Ingresa tu contraseña'),
        pillPreviewInactive: (desc) =>
            `${desc}\n\nAún no hay preguntas activas (true/false) en la subcolección questions.`,
        pillPreviewHead: (head, body) => (head ? `${head}\n\n${body}` : body),
        leaderboardPillTitle: (pillLabel) =>
            `<i class="fas fa-trophy" style="color: #eab308;"></i> ${pillLabel} <span style="font-size:0.72em;font-weight:700;opacity:0.85">(1.er intento)</span>`,
    },
};
