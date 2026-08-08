-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 2b — Cierra la lectura anónima de puntajes y colapsa políticas duplicadas
--
-- ✅ NO REQUIERE DESPLEGAR NADA. Verificado el 2026-08-07:
--    · Las tablas de puntajes sólo las lee uix-space (TeamSection, LevelWidget),
--      siempre con sesión iniciada. Milo, Dam y Pao no las tocan.
--    · Las políticas que se borran tienen cada una un duplicado exacto que se
--      queda vivo, y ninguna de ellas alcanza al rol `anon`.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── A. Puntajes: fuera el rol anon ──────────────────────────────────────────
-- Hoy cualquiera sin sesión puede descargar el ranking completo del equipo.
drop policy if exists "Dashboard lee user_scores"      on public.user_scores;
drop policy if exists "Dashboard lee user_pill_scores" on public.user_pill_scores;
drop policy if exists "Lectura publica para dashboard" on public.user_pill_badges;

revoke all on public.user_scores      from anon;
revoke all on public.user_pill_scores from anon;
revoke all on public.user_pill_badges from anon;

-- ── B. Duplicados exactos ───────────────────────────────────────────────────
-- Postgres evalúa TODAS las políticas en cada fila: son coste por query y ruido
-- para auditar. Entre paréntesis, la que se queda cubriendo el mismo caso.
drop policy if exists "Insert own" on public.ranking_user;                          -- (ru_insert_own)
drop policy if exists "Update own" on public.ranking_user;                          -- (ru_update_own)
drop policy if exists "Autenticados leen todos los perfiles" on public.ranking_user; -- ("Read all")
drop policy if exists "Autenticados leen todos los scores"  on public.user_scores;  -- ("Lectura autenticada de scores")
drop policy if exists "Own scores" on public.user_pill_scores;                      -- (ups_own_all)

commit;

-- VERIFICACIÓN — no debe devolver filas:
-- select tablename, policyname from pg_policies
-- where schemaname='public' and roles::text like '%anon%'
--   and tablename in ('user_scores','user_pill_scores','user_pill_badges');
