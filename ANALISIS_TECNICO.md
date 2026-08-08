# Análisis técnico — UiX-lingo (user-version NC)

## Descripción del proyecto

**UiX-lingo** es una plataforma interna de capacitación y evaluación en UX/UI construida como una SPA estática (HTML + CSS + JavaScript vanilla) con **Supabase** como backend (auth, base de datos, storage) y **Vercel** como hosting.

Ofrece cuatro modos de interacción principales:

- **Práctica**: 20 preguntas aleatorias de opción múltiple del banco general.
- **Evaluación**: sesión filtrada por seniority y especialidad del usuario, con timer por pregunta y detección anti-fraude (pérdida de foco, cambio de pestaña).
- **Pills**: cuestionarios cortos V/F con ranking por primer intento y **sellos descargables** que solo se pueden ganar durante los primeros 7 días.
- **Evaluación 360 al formador**: cada colaborador califica a su líder por competencias, filtrado por especialidad (UX, UI, UX/UI, Writer).

Complementa con **dashboard** de progreso, ranking trimestral (Q1/Q2), vista de talentos/skills y sistema de temas claro/oscuro.

---

## Reseña de lo que vimos

A nivel visual y de usabilidad, el proyecto es **muy bueno y llamativo** — refleja vida, movimiento y detalle. Sin embargo, **no es un proyecto que se pueda considerar sobresaliente o innovador en lo técnico**: es una construcción muy artesanal en JS/HTML/CSS "a la antigua", con integración directa a Supabase.

Es un producto **funcionalmente rico y con detalles cuidados** en seguridad, copy y gamificación, pero **con deuda técnica clásica de un proyecto que creció rápido** sin infraestructura moderna que lo sostenga (sin bundler, sin tests, sin CI, sin router, monolito de 7.097 líneas en un solo archivo). Para su público interno actual funciona perfectamente, pero escalarlo va a requerir refactor.

Se detectó además **participación de una herramienta de IA** en algún tramo intermedio del desarrollo — evidenciado por el corte abrupto en el estilo de commits (de "prueba", "v1.0", "tracking 3" a *conventional commits* perfectos en imperativo), la consistencia extrema de nombres y JSDoc, y el manejo de edge cases inusualmente fino en flujos como recuperación de contraseña.

---

## Puntos fuertes de la app

- **Excelente calidad visual y de experiencia** — diseño llamativo, tema claro/oscuro con transiciones suaves, animaciones GSAP, glassmorphism en el login, confetti en logros.
- **Gamificación bien pensada**:
  - Sellos con **ventana temporal de 7 días** → crea urgencia real de participación.
  - **Ranking por primer intento** en pills → desincentiva farmear reintentos.
  - Acumulación de puntos por trimestre (Q1/Q2).
- **Evaluación 360 al líder integrada** en la misma plataforma — poco común en herramientas de quiz.
- **Copy 100% centralizado** en `js/copy.js` (347 líneas), listo para i18n futuro y con mensajes de error diferenciados por caso (rate limit, SMTP caído, redirect_url mal configurado, user not found, etc.).
- **JSDoc extensivo** — aunque el archivo es monolítico, los comentarios permiten entender la parte del controlador o de la vista que se quiera editar sin leer todo.
- **Manejo excelente de edge cases de auth y tokens**:
  - Captura de tokens de recovery en URL **fragment** (no query) para que no queden en logs.
  - Deshabilita `detectSessionInUrl` para que Supabase no strippee el token antes de tiempo.
  - Confirmación adicional antes de cambiar contraseña (anti-phishing).
- **Sanitización XSS explícita** con helpers propios: `esc()`, `safeHttpUrl()`, `safeTalentImageUrl()`, `safeIconClass()` en `js/utils.js`.
- **Rate-limiting suave en login** (`_loginGuard` con 5 intentos y 30s de cooldown en `js/constants.js:34-38`).
- **`fetchpriority="high"` en assets críticos** (logo del splash) para acelerar el primer paint.
- **Respeta `prefers-reduced-motion`** para accesibilidad (`css/base.css:115-130`).
- **Test Mode**: los admins autorizados pueden previsualizar la app como cualquier perfil sin cambiar de cuenta.

---

## Puntos que cumple (buenas prácticas presentes)

- **Seguridad correcta desde el día 1**:
  - **CSP** (Content Security Policy) restringe orígenes de scripts, estilos, imágenes y conexiones.
  - **HSTS** (`max-age=63072000; includeSubDomains; preload`) — fuerza HTTPS.
  - **X-Frame-Options: DENY** — bloquea clickjacking.
  - **Permissions-Policy** — niega cámara, micro, geolocalización, USB, bluetooth.
  - **Referrer-Policy: strict-origin-when-cross-origin**.
  - **X-Content-Type-Options: nosniff**.
- **Modularización CSS por dominio** — 21 archivos separados (auth, quiz, pills, profile, modals, responsive, etc.) con tokens y tema light/dark override.
- **Debugging técnico muy fino en los commits** — mensajes de fix que diagnostican el bug preciso (ej: `fix: analytics.js borraba el token_hash de la URL al arrancar`, `fix: disable detectSessionInUrl to prevent SDK from hijacking URL before recovery flow`).
- **Rewrite en Vercel de `/reset-password` a `/`** para que el SPA maneje la ruta sin 404.
- **Accesibilidad básica**: `aria-label`, `aria-live`, `role`, `sr-only`, focus visible global, transiciones respetuosas con reduced-motion.
- **Analytics anónimo** (Umami) con sesión de 30 min, sin cookies de tracking.

---

## Áreas de oportunidad / mejora

### Arquitectura y código

- **Monolito grande**: `js/app-main.js` = **7.097 líneas / 272 KB** sin minificar. Mezcla auth, quiz, pills, perfil, formador y talentos en un solo archivo.
- **HTML también monolítico**: `index.html` = **1.009 líneas / 64 KB** con las 11 pantallas dentro, todas en el DOM desde el arranque (solo ocultas con `.hidden` / `display: none`).
- **Sin router real**: la navegación es una función `switchSection(targetId)` (`js/app-main.js:3811`) que agrega/quita la clase `.hidden` sobre un **array de 6 IDs hardcodeado**. Cada nueva vista requiere editar esa lista.
- **Sin deep-linking ni URLs por sección** → un formador no puede compartir el link "resultado del quiz X"; el botón "atrás" del navegador no funciona como se espera.
- **Sin bundler** → cada `import` de módulo ES es un round-trip HTTP; sin minificación, sin tree-shaking, sin source maps, sin code-splitting. Cache-busting manual con `?v=19`.
- **Sin TypeScript ni linter** — errores de tipo solo se detectan en runtime.
- **Cero tests** (unit, integración, E2E). Refactorear el monolito es a ciegas.
- **Sin CI/CD** — no hay GitHub Actions ni validación pre-deploy.
- **Dependencia total de CDNs externos** (Supabase, GSAP, canvas-confetti, Font Awesome, Umami) sin fallback local.

### Performance

- **Todo el JS/CSS se descarga en la carga inicial**, incluso si el usuario solo va a hacer login.
- **21 archivos CSS = 16.675 líneas totales** servidos sin minificar (`profile.css` 2.622, `theme-light.css` 1.161, `modals.css` 778).
- **`backdrop-filter: blur(24px)`** en la tarjeta de login se ve lindo pero es **caro en GPU**, especialmente en móviles de gama baja.
- **Sin virtualización de listas** — leaderboards y listas de talentos se renderizan completos.
- **Sin paginación en las queries de Supabase** — si el banco de preguntas crece a 10k filas, se traen todas.
- **Sin caché declarada en cliente** más allá de lo que hace el SDK de Supabase.

### Backend / Supabase

- **RLS incompleta**: la tabla `user_pill_badges` no tiene política aplicada — el propio README lo advierte (`SELECT` devuelve 0 filas aunque haya datos).
- **Edge Functions de scoring pendientes** (declarado en `spec.md:7`): el otorgamiento de sellos se decide en cliente. Cualquier usuario con DevTools puede manipular puntajes o forzar un sello.
- **Sin validación server-side** de respuestas antes de guardar scores.
- **Índices no verificados** en tablas críticas (`ranking_user.email` se consulta en cada login).

### Higiene del repo

- Archivos sueltos: `env.local.` (vacío, 0 bytes), CSV de empleados versionado, `35_talentos_mini_cards.md` en la raíz, `_admin-tools/` en el repo público.
- Sin `.env.example` que documente qué variables se esperan.
- Commits iniciales muy amateurs (`prueba`, `prueba 2`, `v1`, `tracking 3`) mezclados con conventional commits perfectos posteriores — sugiere falta de estándar del equipo antes de que entrara asistencia de IA.

### Escalabilidad — techo estimado

| Escala | Comportamiento esperado |
|--------|-------------------------|
| ≤ 100 usuarios concurrentes | Funciona perfectamente. |
| 100 – 500 concurrentes | Latencia notable en primer paint por el JS monolítico; móviles viejos laguean por `backdrop-filter`. |
| > 500 concurrentes | Límites de Supabase (rate limits, bandwidth de storage) se vuelven el cuello. |
| > 20 pantallas o > 10k líneas de JS | Refactor a bundler + router real deja de ser opcional. |

### Recomendaciones priorizadas

1. **Cerrar los gaps de seguridad server-side**: política RLS en `user_pill_badges` + Edge Function que valide respuestas y otorgue sellos con `service_role`. **(Bloqueador si escala.)**
2. **Bundler mínimo** (Vite): minificación, tree-shaking, code-splitting por vista. Casi gratis, gran ganancia.
3. **Router real** (`page.js` o `navigo`, ~2 KB) para tener URLs por sección, back del navegador y deep-linking.
4. **Separar `app-main.js`** en módulos por dominio (auth, quiz, pills, formador, profile). No hace falta framework para eso.
5. **Tests E2E del quiz core** (Playwright) — smoke test del flujo principal antes de cada deploy.
6. **CI/CD en GitHub Actions**: lint + tests + deploy preview.
7. **CDN dedicado de imágenes** (Cloudflare Images o similar) para no depender del bandwidth de Supabase Storage.
8. **Paginación** en queries de preguntas y leaderboards.
9. **Limpieza de repo**: mover `_admin-tools/`, CSV de empleados y archivos sueltos fuera de la raíz o del repo público.

---

## Conclusión

UiX-lingo es un **producto interno bien logrado a nivel de experiencia y con base sólida de seguridad**, pero construido con arquitectura de baja evolución. Para su uso actual funciona muy bien; para escalar a más equipos o abrirlo a más carga concurrente, hay que cerrar primero los gaps de RLS + Edge Functions, y después atacar el monolito con bundler + router + separación por dominio.

Es un caso típico donde la calidad de la **superficie** (UX, copy, seguridad de headers) supera a la calidad de la **estructura** (arquitectura, tests, escalabilidad). La buena noticia es que la deuda es identificable, acotada y sin bloqueadores de fondo.
