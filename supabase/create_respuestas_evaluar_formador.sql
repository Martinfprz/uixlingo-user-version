-- UiX-lingo: evaluación 360 al formador / equipo (banco_evaluar_formador)
-- Tabla NUEVA para guardar las respuestas del usuario (no hay puntaje, solo se registran).
-- Ejecutar en Supabase → SQL Editor (proyecto pmezmoobuwwbirwzensj).

-- ─── PASO 1: Crear la tabla de respuestas ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.respuestas_evaluar_formador (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  pregunta_id    uuid NOT NULL REFERENCES public.banco_evaluar_formador(id),
  comportamiento text,          -- "Evaluación al formador" | "Evaluación a mi equipo"
  competencia    text,
  puesto         text,          -- puesto del usuario con el que se resolvió el filtro
  opcion_elegida text,          -- 'a' | 'b' | 'c' | 'd'
  respuesta      text,          -- texto de la opción elegida (opcion_x)
  nivel          text,          -- "En desarrollo" | "Satisfactorio" | "Avanzado" | "NA"
  fecha          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ref_user      ON public.respuestas_evaluar_formador (user_id);
CREATE INDEX IF NOT EXISTS idx_ref_pregunta  ON public.respuestas_evaluar_formador (pregunta_id);

-- ─── PASO 2: RLS — cada usuario solo inserta/lee sus propias respuestas ────
ALTER TABLE public.respuestas_evaluar_formador ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios insertan sus propias respuestas"
  ON public.respuestas_evaluar_formador FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuarios leen sus propias respuestas"
  ON public.respuestas_evaluar_formador FOR SELECT
  USING (auth.uid() = user_id);

-- ─── PASO 3: (Opcional) permitir que el banco sea legible tras login ───────
-- El front necesita leer banco_evaluar_formador con el usuario autenticado.
-- Si aún no tiene policy de SELECT para authenticated, descomenta:
-- ALTER TABLE public.banco_evaluar_formador ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Banco formador legible autenticados"
--   ON public.banco_evaluar_formador FOR SELECT
--   TO authenticated USING (true);
