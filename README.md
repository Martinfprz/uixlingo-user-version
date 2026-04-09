# UiX-lingo

Plataforma de aprendizaje de UX/UI en formato quiz interactivo. Los usuarios practican conceptos de diseño respondiendo preguntas de opción múltiple y verdadero/falso, organizadas en modos de práctica, evaluación y pills temáticas.

## Tecnologías

- HTML5 / CSS3 / JavaScript (vanilla, ES Modules)
- [Supabase](https://supabase.com/) — autenticación y base de datos
- [GSAP](https://gsap.com/) — animaciones
- [canvas-confetti](https://github.com/catdad/canvas-confetti) — efectos visuales
- [Font Awesome 6](https://fontawesome.com/) — iconografía
- Vercel — hosting

## Estructura

```
├── index.html        # App principal (SPA)
├── styles.css        # Estilos globales
├── app.js            # Lógica de la aplicación
├── theme-init.js     # Inicialización de tema (dark/light)
├── vercel.json       # Headers de seguridad para Vercel
└── _headers          # Headers de seguridad para Cloudflare Pages
```

## Modos de uso

| Modo | Descripción |
|------|-------------|
| Práctica | Preguntas aleatorias del banco general |
| Evaluación | Sesión filtrada por seniority y especialidad del usuario |
| Pills | Cuestionarios temáticos cortos con ranking por primer intento |

## Requisitos para correr en local

No requiere instalación. Abre `index.html` en un servidor local (p. ej. Live Server en VS Code) o despliega directamente en Vercel.

> Las funcionalidades de autenticación, ranking y carga de preguntas requieren conexión al proyecto Supabase configurado.

## Deploy en Vercel

1. Sube el repositorio a GitHub.
2. Importa el repositorio en [vercel.com](https://vercel.com).
3. Framework Preset: **Other** (sitio estático, sin build step).
4. Publish directory: `.` (raíz).
5. Haz clic en **Deploy**.

Los headers de seguridad se aplican automáticamente desde `vercel.json`.
