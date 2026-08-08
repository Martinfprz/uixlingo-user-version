-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 4 — Sesiones de quiz en servidor
--
-- Permite esconder las respuestas correctas SIN perder el feedback inmediato ni
-- la mecánica de racha. El servidor recuerda qué preguntas tocaron y qué se
-- contestó, así que puede calificar pregunta por pregunta sin que el cliente
-- llegue a tener nunca la respuesta antes de contestar.
--
-- La propiedad que lo sostiene: una respuesta se registra UNA sola vez. Un
-- segundo intento sobre la misma pregunta devuelve el veredicto ya guardado, así
-- que no se puede sondear el endpoint para descubrir la correcta.
--
-- ✅ Aditiva: crea una tabla nueva que nadie usa todavía. No toca nada existente.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.quiz_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  mode          text not null check (mode in ('evaluation', 'pills')),
  pill_id       uuid,
  -- Orden fijado al arrancar: el cliente ya no puede cambiar el set de preguntas
  -- a mitad de sesión ni reordenarlo para repetir las que ya vio.
  question_ids  uuid[] not null,
  -- { "<question_id>": { "a": "B", "ok": false } }
  answers       jsonb not null default '{}'::jsonb,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  score         integer
);

create index if not exists quiz_sessions_user_idx
  on public.quiz_sessions (user_id, mode, started_at desc);

-- Sólo la Edge Function (service_role) entra aquí. Si el cliente pudiera leer
-- esta tabla vería `answers.ok`, que es justo lo que estamos escondiendo.
alter table public.quiz_sessions enable row level security;
revoke all on public.quiz_sessions from anon, authenticated;

comment on table public.quiz_sessions is
  'Estado server-side de una sesión de evaluación o pill. Sólo accesible vía la Edge Function quiz-session con service_role.';


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN — no debe devolver filas:
-- select grantee, privilege_type from information_schema.role_table_grants
-- where table_schema='public' and table_name='quiz_sessions'
--   and grantee in ('anon','authenticated');
-- ─────────────────────────────────────────────────────────────────────────────
