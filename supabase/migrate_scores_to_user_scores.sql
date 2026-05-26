-- UiX-lingo: migración de columnas de scores
-- De: public.ranking_user  →  public.user_scores
-- Ejecutar en Supabase → SQL Editor en 2 bloques (PASO 1-3 primero, PASO 4 después de verificar)

-- ─── PASO 1: Crear tabla user_scores ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_scores (
  user_id            uuid PRIMARY KEY,
  quest_points       numeric,
  tests_points       numeric,
  pills_points       numeric,
  pills_rank_pill_id text,
  pills_rank_tiempo  numeric,
  puntos             numeric,
  tiempo             numeric,
  fecha              text
);

-- ─── PASO 2: Copiar datos desde ranking_user ──────────────────────────────
INSERT INTO public.user_scores (
  user_id,
  quest_points,
  tests_points,
  pills_points,
  pills_rank_pill_id,
  pills_rank_tiempo,
  puntos,
  tiempo,
  fecha
)
SELECT
  user_id,
  quest_points,
  tests_points,
  pills_points,
  pills_rank_pill_id,
  pills_rank_tiempo,
  puntos,
  tiempo,
  fecha
FROM public.ranking_user
WHERE user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- ─── PASO 3: Verificar que los números coinciden ───────────────────────────
-- Ambas columnas deben mostrar el mismo número antes de continuar.
SELECT
  (SELECT COUNT(*) FROM public.ranking_user WHERE user_id IS NOT NULL) AS usuarios_en_ranking,
  (SELECT COUNT(*) FROM public.user_scores)                             AS filas_en_user_scores;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ⚠  DETENTE AQUÍ — ejecuta el bloque de arriba primero.
--    Solo corre el PASO 4 cuando el PASO 3 muestre los mismos números.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ─── PASO 4: Eliminar columnas de ranking_user ────────────────────────────
ALTER TABLE public.ranking_user
  DROP COLUMN IF EXISTS quest_points,
  DROP COLUMN IF EXISTS tests_points,
  DROP COLUMN IF EXISTS pills_points,
  DROP COLUMN IF EXISTS pills_rank_pill_id,
  DROP COLUMN IF EXISTS pills_rank_tiempo,
  DROP COLUMN IF EXISTS puntos,
  DROP COLUMN IF EXISTS tiempo,
  DROP COLUMN IF EXISTS fecha;

-- ─── PASO 5: RLS básico para user_scores ──────────────────────────────────
-- Cada usuario solo lee/escribe su propia fila.
ALTER TABLE public.user_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios leen sus propios scores"
  ON public.user_scores FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Usuarios actualizan sus propios scores"
  ON public.user_scores FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Usuarios insertan sus propios scores"
  ON public.user_scores FOR INSERT
  WITH CHECK (auth.uid() = user_id);
