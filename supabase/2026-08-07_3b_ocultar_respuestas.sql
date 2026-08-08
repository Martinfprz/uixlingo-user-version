-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 3b — Sacar las respuestas correctas del alcance del cliente
--
-- ⚠️  NO APLICAR hasta que user-version lea evaluación y pills desde las vistas
--     `_publico` y muestre el feedback al final de la sesión (con los `errors`
--     que devuelve `submit-quiz`) en vez de pregunta por pregunta.
--     Si se aplica antes, evaluación y pills dejan de cargar preguntas.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── B. Sacar las respuestas correctas del alcance del cliente ───────────────
-- Sólo evaluación y pills: son los dos modos que alimentan el ranking oficial y
-- se juegan a un intento. Práctica (`banco_preguntas`) se queda como está: tiene
-- reintentos ilimitados y feedback inmediato, así que esconder la respuesta no
-- protegería nada y sí rompería la herramienta de estudio.
--
-- `expl` / `explanation` también salen: la explicación casi siempre delata cuál
-- era la correcta. El feedback las recibe de vuelta en la respuesta de
-- `submit-quiz`, ya terminada la sesión.

create or replace view public.preguntas_evaluacion_publico as
  select id, q, a, b, c, cat, tag, seniority, active
  from public.preguntas_evaluacion;

create or replace view public.pill_questions_publico as
  select id, pill_id, question, category, type, active, pill_nombre
  from public.pill_questions;

comment on view public.preguntas_evaluacion_publico is
  'Banco de evaluación sin `correcta` ni `expl`. Es lo que consume el cliente; la calificación la hace la Edge Function submit-quiz.';
comment on view public.pill_questions_publico is
  'Preguntas de pills sin `correct_answer` ni `explanation`. Ver preguntas_evaluacion_publico.';

-- Las vistas se ejecutan con los permisos de su dueño (security_invoker = off,
-- el default), así que siguen leyendo la tabla base aunque el rol ya no pueda.
grant select on public.preguntas_evaluacion_publico to authenticated;
grant select on public.pill_questions_publico       to authenticated;

revoke all on public.preguntas_evaluacion from authenticated, anon;
revoke all on public.pill_questions       from authenticated, anon;

commit;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (no debe devolver filas)
-- ─────────────────────────────────────────────────────────────────────────────
-- select grantee, table_name from information_schema.role_table_grants
-- where table_schema='public' and grantee in ('anon','authenticated')
--   and table_name in ('preguntas_evaluacion','pill_questions');

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
-- ─────────────────────────────────────────────────────────────────────────────
-- begin;
--   grant select on public.preguntas_evaluacion to authenticated;
--   grant select on public.pill_questions       to authenticated;
-- commit;
