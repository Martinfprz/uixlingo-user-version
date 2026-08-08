-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 3a — El cliente deja de poder escribir puntajes
--
-- ⚠️  NO APLICAR hasta que esté desplegada la versión de user-version que llama
--     a `submit-quiz`. La Edge Function ya está desplegada. Si se aplica antes,
--     los quiz dejan de guardar puntaje.
--
-- Independiente de las fases 1 y 2.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── A. Sólo `submit-quiz` (service_role) escribe puntajes ────────────────────
-- El navegador conserva SELECT (necesita leer su progreso y los leaderboards),
-- pero pierde INSERT/UPDATE/DELETE. La RLS `auth.uid() = user_id` seguía siendo
-- honesta sobre QUIÉN escribe; nunca pudo validar CUÁNTO.
revoke insert, update, delete on public.user_scores      from authenticated, anon;
revoke insert, update, delete on public.user_pill_scores from authenticated, anon;
revoke insert, update, delete on public.user_profiles    from authenticated, anon;

-- Las políticas de escritura quedan sin efecto al no haber grant, pero se borran
-- para que `pg_policies` refleje la realidad y no confunda en la próxima auditoría.
drop policy if exists "Usuarios insertan sus propios scores"  on public.user_scores;
drop policy if exists "Usuarios actualizan sus propios scores" on public.user_scores;

-- `ups_own_all` es ALL: se reemplaza por SELECT, que es lo único que queda vivo.
drop policy if exists "ups_own_all" on public.user_pill_scores;
create policy "ups_select_own" on public.user_pill_scores
  for select to authenticated using (user_id = auth.uid());


commit;



-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (ninguna debe devolver filas)
-- ─────────────────────────────────────────────────────────────────────────────
-- -- 1. El cliente ya no puede escribir puntajes:
-- select grantee, privilege_type from information_schema.role_table_grants
-- where table_schema='public' and grantee in ('anon','authenticated')
--   and table_name in ('user_scores','user_pill_scores','user_profiles')
--   and privilege_type in ('INSERT','UPDATE','DELETE');
--



-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
-- ─────────────────────────────────────────────────────────────────────────────
-- begin;
--   grant insert, update, delete on public.user_scores      to authenticated;
--   grant insert, update, delete on public.user_pill_scores to authenticated;
--   grant insert, update, delete on public.user_profiles    to authenticated;
--   create policy "Usuarios insertan sus propios scores" on public.user_scores
--     for insert with check (auth.uid() = user_id);
--   create policy "Usuarios actualizan sus propios scores" on public.user_scores
--     for update using (auth.uid() = user_id);
--   drop policy if exists "ups_select_own" on public.user_pill_scores;
--   create policy "ups_own_all" on public.user_pill_scores
--     for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- commit;
