-- UiX-lingo: habilitar evaluaciones del Q2
-- Tabla: public.user_scores
-- Objetivo: conservar las calificaciones del Q1 (columna tests_points) y crear
--           una columna nueva tests_points_q2 en NULL para rehabilitar a TODOS
--           los usuarios en el nuevo periodo.
-- Ejecutar en Supabase → SQL Editor (proyecto pmezmoobuwwbirwzensj).

-- ─── PASO 1: Crear la columna del nuevo periodo (todo NULL) ────────────────
-- IF NOT EXISTS = idempotente: se puede correr más de una vez sin error.
-- No lleva DEFAULT, así que todas las filas quedan en NULL → la app vuelve a
-- mostrar la evaluación disponible (evalCompleted = tests_points_q2 != null).
ALTER TABLE public.user_scores
  ADD COLUMN IF NOT EXISTS tests_points_q2 numeric;

-- ─── PASO 2: Verificar el resultado ───────────────────────────────────────
-- tests_points (Q1) debe seguir con sus valores; tests_points_q2 todo en NULL.
SELECT
  COUNT(*)                       AS total_usuarios,
  COUNT(tests_points)            AS q1_con_calificacion,
  COUNT(tests_points_q2)         AS q2_con_calificacion   -- debe dar 0 tras la migración
FROM public.user_scores;
