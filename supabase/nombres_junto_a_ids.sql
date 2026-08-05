-- UiX-lingo: nombre legible al lado de cada ID
-- Objetivo: poder verificar los datos de un vistazo en el SQL/Table Editor, sin
-- tener que cruzar UUIDs contra ranking_user, pills, sellos o habilidades.
-- YA APLICADO en el proyecto pmezmoobuwwbirwzensj el 2026-08-05 (migración
-- `nombres_junto_a_ids`). Queda aquí como referencia y para rehacerlo si hace falta.
-- Es idempotente: se puede correr varias veces sin romper nada.
--
-- QUÉ QUEDÓ AL RELLENAR LO HISTÓRICO
--   respuestas_evaluar_formador  1551/1551 con nombre, email y pregunta_texto
--   user_pill_scores               225/225 · pill_ratings 82/82 · speaker_awards 6/6
--   publicacion_destinatarios      135/135 · pill_questions 36/36 · exclusiones 13/13
--   user_pill_badges               252/267 con nombre  (15 user_id que ya no están en ranking_user)
--   user_scores                     96/106 con nombre  (10 igual, sin fila en ranking_user)
--   user_habilidades                79/83  con habilidad_1_nombre (4 filas sin habilidades elegidas)
--   user_sellos y sellos            0 filas: hoy los sellos viven en user_pill_badges.
--                                   Las columnas y el trigger quedan listos por si se retoman.
--
-- CÓMO SE MANTIENEN LLENAS
-- Las columnas se resuelven con un trigger BEFORE INSERT OR UPDATE, no desde el
-- front. Así se llenan igual si el insert viene de user-version, de admin-version,
-- del importador o de un INSERT a mano en el dashboard, y no hay que tocar las tres
-- apps ni arriesgar que una se olvide de mandar el nombre.
-- Regla única de cada trigger: gana el nombre de la tabla origen; si no lo encuentra
-- (p. ej. alguien que ya no está en ranking_user), respeta lo que venga en el insert.
-- Al refrescarse también en UPDATE, un cambio de nombre en ranking_user se propaga
-- la próxima vez que se toque la fila.
--
-- SOBRE `email`
-- Solo se agrega en respuestas_evaluar_formador, que está protegida por RLS (cada
-- quien ve sus filas y los admins todas). En user_scores va solo `nombre` a propósito:
-- esa tabla tiene una policy de SELECT abierta ("Dashboard lee user_scores", USING true),
-- así que meterle correos ampliaría lo que puede leer un anónimo.
--
-- feedback_reports NO aparece aquí: ya guarda user_name y user_email.
-- user_habilidades.habilidad_id tampoco: está vacía en las 83 filas (columna legacy);
-- los datos vivos son habilidad_id_1..5.

-- ─── PASO 1: columnas de nombre ────────────────────────────────────────────
ALTER TABLE public.respuestas_evaluar_formador
  ADD COLUMN IF NOT EXISTS nombre         text,  -- quién contesta (user_id)
  ADD COLUMN IF NOT EXISTS email          text,
  ADD COLUMN IF NOT EXISTS pregunta_texto text;  -- texto de la pregunta (pregunta_id)

ALTER TABLE public.user_scores
  ADD COLUMN IF NOT EXISTS nombre                 text,
  ADD COLUMN IF NOT EXISTS pills_rank_pill_nombre text;

ALTER TABLE public.user_pill_scores
  ADD COLUMN IF NOT EXISTS nombre      text,
  ADD COLUMN IF NOT EXISTS pill_nombre text;

ALTER TABLE public.user_pill_badges
  ADD COLUMN IF NOT EXISTS nombre      text,
  ADD COLUMN IF NOT EXISTS pill_nombre text;

ALTER TABLE public.pill_ratings
  ADD COLUMN IF NOT EXISTS nombre      text,
  ADD COLUMN IF NOT EXISTS pill_nombre text;

ALTER TABLE public.user_sellos
  ADD COLUMN IF NOT EXISTS nombre       text,
  ADD COLUMN IF NOT EXISTS sello_nombre text;

ALTER TABLE public.user_habilidades
  ADD COLUMN IF NOT EXISTS nombre             text,
  ADD COLUMN IF NOT EXISTS habilidad_1_nombre text,
  ADD COLUMN IF NOT EXISTS habilidad_2_nombre text,
  ADD COLUMN IF NOT EXISTS habilidad_3_nombre text,
  ADD COLUMN IF NOT EXISTS habilidad_4_nombre text,
  ADD COLUMN IF NOT EXISTS habilidad_5_nombre text;

ALTER TABLE public.speaker_awards
  ADD COLUMN IF NOT EXISTS nombre text;

ALTER TABLE public.publicacion_destinatarios
  ADD COLUMN IF NOT EXISTS nombre             text,  -- persona del email
  ADD COLUMN IF NOT EXISTS publicacion_titulo text;

ALTER TABLE public.sellos
  ADD COLUMN IF NOT EXISTS pill_nombre text;

ALTER TABLE public.pill_questions
  ADD COLUMN IF NOT EXISTS pill_nombre text;

ALTER TABLE public.evaluacion_exclusiones
  ADD COLUMN IF NOT EXISTS nombre text;  -- persona del emp_id

-- ─── PASO 2: triggers que las llenan ──────────────────────────────────────
-- Devuelven `trigger`, así que PostgREST no las expone como RPC: no se agrega
-- superficie nueva al API. Sin SECURITY DEFINER: corren con los permisos de quien
-- inserta, y todas las tablas origen ya son legibles por `authenticated`.

CREATE OR REPLACE FUNCTION public.tg_respuestas_evaluar_formador_nombres()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.nombre := coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = new.user_id), new.nombre);
  new.email  := coalesce((SELECT r.email  FROM public.ranking_user r WHERE r.user_id = new.user_id), new.email);
  new.evaluado_nombre := coalesce(
    (SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = new.evaluado_user_id), new.evaluado_nombre);
  new.pregunta_texto := coalesce(
    (SELECT b.pregunta FROM public.banco_evaluar_formador b WHERE b.id = new.pregunta_id), new.pregunta_texto);
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_respuestas_evaluar_formador_nombres ON public.respuestas_evaluar_formador;
CREATE TRIGGER trg_respuestas_evaluar_formador_nombres
  BEFORE INSERT OR UPDATE ON public.respuestas_evaluar_formador
  FOR EACH ROW EXECUTE FUNCTION public.tg_respuestas_evaluar_formador_nombres();

CREATE OR REPLACE FUNCTION public.tg_user_scores_nombres()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.nombre := coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = new.user_id), new.nombre);
  -- pills_rank_pill_id es text pero guarda un uuid de pills.
  new.pills_rank_pill_nombre := coalesce(
    (SELECT p.name FROM public.pills p WHERE p.id::text = new.pills_rank_pill_id), new.pills_rank_pill_nombre);
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_user_scores_nombres ON public.user_scores;
CREATE TRIGGER trg_user_scores_nombres
  BEFORE INSERT OR UPDATE ON public.user_scores
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_scores_nombres();

CREATE OR REPLACE FUNCTION public.tg_user_pill_scores_nombres()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.nombre      := coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = new.user_id), new.nombre);
  new.pill_nombre := coalesce((SELECT p.name   FROM public.pills p        WHERE p.id      = new.pill_id), new.pill_nombre);
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_user_pill_scores_nombres ON public.user_pill_scores;
CREATE TRIGGER trg_user_pill_scores_nombres
  BEFORE INSERT OR UPDATE ON public.user_pill_scores
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_pill_scores_nombres();

CREATE OR REPLACE FUNCTION public.tg_user_pill_badges_nombres()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.nombre      := coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = new.user_id), new.nombre);
  new.pill_nombre := coalesce((SELECT p.name   FROM public.pills p        WHERE p.id      = new.pill_id), new.pill_nombre);
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_user_pill_badges_nombres ON public.user_pill_badges;
CREATE TRIGGER trg_user_pill_badges_nombres
  BEFORE INSERT OR UPDATE ON public.user_pill_badges
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_pill_badges_nombres();

CREATE OR REPLACE FUNCTION public.tg_pill_ratings_nombres()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.nombre      := coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = new.user_id), new.nombre);
  new.pill_nombre := coalesce((SELECT p.name   FROM public.pills p        WHERE p.id      = new.pill_id), new.pill_nombre);
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_pill_ratings_nombres ON public.pill_ratings;
CREATE TRIGGER trg_pill_ratings_nombres
  BEFORE INSERT OR UPDATE ON public.pill_ratings
  FOR EACH ROW EXECUTE FUNCTION public.tg_pill_ratings_nombres();

CREATE OR REPLACE FUNCTION public.tg_user_sellos_nombres()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.nombre       := coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = new.user_id), new.nombre);
  new.sello_nombre := coalesce((SELECT s.nombre FROM public.sellos s       WHERE s.id      = new.sello_id), new.sello_nombre);
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_user_sellos_nombres ON public.user_sellos;
CREATE TRIGGER trg_user_sellos_nombres
  BEFORE INSERT OR UPDATE ON public.user_sellos
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_sellos_nombres();

CREATE OR REPLACE FUNCTION public.tg_user_habilidades_nombres()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.nombre := coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = new.user_id), new.nombre);
  new.habilidad_1_nombre := coalesce((SELECT h.nombre FROM public.habilidades h WHERE h.id = new.habilidad_id_1), new.habilidad_1_nombre);
  new.habilidad_2_nombre := coalesce((SELECT h.nombre FROM public.habilidades h WHERE h.id = new.habilidad_id_2), new.habilidad_2_nombre);
  new.habilidad_3_nombre := coalesce((SELECT h.nombre FROM public.habilidades h WHERE h.id = new.habilidad_id_3), new.habilidad_3_nombre);
  new.habilidad_4_nombre := coalesce((SELECT h.nombre FROM public.habilidades h WHERE h.id = new.habilidad_id_4), new.habilidad_4_nombre);
  new.habilidad_5_nombre := coalesce((SELECT h.nombre FROM public.habilidades h WHERE h.id = new.habilidad_id_5), new.habilidad_5_nombre);
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_user_habilidades_nombres ON public.user_habilidades;
CREATE TRIGGER trg_user_habilidades_nombres
  BEFORE INSERT OR UPDATE ON public.user_habilidades
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_habilidades_nombres();

CREATE OR REPLACE FUNCTION public.tg_speaker_awards_nombres()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.nombre := coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = new.user_id), new.nombre);
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_speaker_awards_nombres ON public.speaker_awards;
CREATE TRIGGER trg_speaker_awards_nombres
  BEFORE INSERT OR UPDATE ON public.speaker_awards
  FOR EACH ROW EXECUTE FUNCTION public.tg_speaker_awards_nombres();

CREATE OR REPLACE FUNCTION public.tg_publicacion_destinatarios_nombres()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.nombre := coalesce(
    (SELECT r.nombre FROM public.ranking_user r WHERE lower(r.email) = lower(new.email)), new.nombre);
  new.publicacion_titulo := coalesce(
    (SELECT p.title FROM public.publicaciones p WHERE p.id = new.publicacion_id), new.publicacion_titulo);
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_publicacion_destinatarios_nombres ON public.publicacion_destinatarios;
CREATE TRIGGER trg_publicacion_destinatarios_nombres
  BEFORE INSERT OR UPDATE ON public.publicacion_destinatarios
  FOR EACH ROW EXECUTE FUNCTION public.tg_publicacion_destinatarios_nombres();

CREATE OR REPLACE FUNCTION public.tg_sellos_nombres()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.pill_nombre := coalesce((SELECT p.name FROM public.pills p WHERE p.id = new.pill_id), new.pill_nombre);
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_sellos_nombres ON public.sellos;
CREATE TRIGGER trg_sellos_nombres
  BEFORE INSERT OR UPDATE ON public.sellos
  FOR EACH ROW EXECUTE FUNCTION public.tg_sellos_nombres();

CREATE OR REPLACE FUNCTION public.tg_pill_questions_nombres()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.pill_nombre := coalesce((SELECT p.name FROM public.pills p WHERE p.id = new.pill_id), new.pill_nombre);
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_pill_questions_nombres ON public.pill_questions;
CREATE TRIGGER trg_pill_questions_nombres
  BEFORE INSERT OR UPDATE ON public.pill_questions
  FOR EACH ROW EXECUTE FUNCTION public.tg_pill_questions_nombres();

CREATE OR REPLACE FUNCTION public.tg_evaluacion_exclusiones_nombres()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.nombre := coalesce(
    (SELECT r.nombre FROM public.ranking_user r WHERE r.emp_id = new.emp_id), new.nombre);
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_evaluacion_exclusiones_nombres ON public.evaluacion_exclusiones;
CREATE TRIGGER trg_evaluacion_exclusiones_nombres
  BEFORE INSERT OR UPDATE ON public.evaluacion_exclusiones
  FOR EACH ROW EXECUTE FUNCTION public.tg_evaluacion_exclusiones_nombres();

-- ─── PASO 3: rellenar lo histórico ────────────────────────────────────────
-- Misma resolución que los triggers, pero con subconsultas correlacionadas: así
-- las filas sin match en la tabla origen se quedan como están en vez de perderse.
-- Lo que quede en NULL es gente o contenido que ya no existe (p. ej. filas de
-- user_scores cuyo user_id ya no está en ranking_user).

UPDATE public.respuestas_evaluar_formador t SET
  nombre          = coalesce((SELECT r.nombre   FROM public.ranking_user r            WHERE r.user_id = t.user_id),          t.nombre),
  email           = coalesce((SELECT r.email    FROM public.ranking_user r            WHERE r.user_id = t.user_id),          t.email),
  evaluado_nombre = coalesce((SELECT e.nombre   FROM public.ranking_user e            WHERE e.user_id = t.evaluado_user_id), t.evaluado_nombre),
  pregunta_texto  = coalesce((SELECT b.pregunta FROM public.banco_evaluar_formador b  WHERE b.id      = t.pregunta_id),      t.pregunta_texto);

UPDATE public.user_scores t SET
  nombre                 = coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id  = t.user_id),                t.nombre),
  pills_rank_pill_nombre = coalesce((SELECT p.name   FROM public.pills p        WHERE p.id::text = t.pills_rank_pill_id),     t.pills_rank_pill_nombre);

UPDATE public.user_pill_scores t SET
  nombre      = coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = t.user_id), t.nombre),
  pill_nombre = coalesce((SELECT p.name   FROM public.pills p        WHERE p.id      = t.pill_id), t.pill_nombre);

UPDATE public.user_pill_badges t SET
  nombre      = coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = t.user_id), t.nombre),
  pill_nombre = coalesce((SELECT p.name   FROM public.pills p        WHERE p.id      = t.pill_id), t.pill_nombre);

UPDATE public.pill_ratings t SET
  nombre      = coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = t.user_id), t.nombre),
  pill_nombre = coalesce((SELECT p.name   FROM public.pills p        WHERE p.id      = t.pill_id), t.pill_nombre);

UPDATE public.user_sellos t SET
  nombre       = coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = t.user_id),  t.nombre),
  sello_nombre = coalesce((SELECT s.nombre FROM public.sellos s       WHERE s.id      = t.sello_id), t.sello_nombre);

UPDATE public.user_habilidades t SET
  nombre             = coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = t.user_id),         t.nombre),
  habilidad_1_nombre = coalesce((SELECT h.nombre FROM public.habilidades h  WHERE h.id      = t.habilidad_id_1),  t.habilidad_1_nombre),
  habilidad_2_nombre = coalesce((SELECT h.nombre FROM public.habilidades h  WHERE h.id      = t.habilidad_id_2),  t.habilidad_2_nombre),
  habilidad_3_nombre = coalesce((SELECT h.nombre FROM public.habilidades h  WHERE h.id      = t.habilidad_id_3),  t.habilidad_3_nombre),
  habilidad_4_nombre = coalesce((SELECT h.nombre FROM public.habilidades h  WHERE h.id      = t.habilidad_id_4),  t.habilidad_4_nombre),
  habilidad_5_nombre = coalesce((SELECT h.nombre FROM public.habilidades h  WHERE h.id      = t.habilidad_id_5),  t.habilidad_5_nombre);

UPDATE public.speaker_awards t SET
  nombre = coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = t.user_id), t.nombre);

UPDATE public.publicacion_destinatarios t SET
  nombre             = coalesce((SELECT r.nombre FROM public.ranking_user r  WHERE lower(r.email) = lower(t.email)), t.nombre),
  publicacion_titulo = coalesce((SELECT p.title  FROM public.publicaciones p WHERE p.id = t.publicacion_id),          t.publicacion_titulo);

UPDATE public.sellos t SET
  pill_nombre = coalesce((SELECT p.name FROM public.pills p WHERE p.id = t.pill_id), t.pill_nombre);

UPDATE public.pill_questions t SET
  pill_nombre = coalesce((SELECT p.name FROM public.pills p WHERE p.id = t.pill_id), t.pill_nombre);

UPDATE public.evaluacion_exclusiones t SET
  nombre = coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.emp_id = t.emp_id), t.nombre);
