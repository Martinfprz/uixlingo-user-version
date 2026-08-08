-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 2a — Cierra la fuga de credenciales SIN romper ninguna app
--
-- El problema: `ranking_user` está abierta al rol `anon` con `USING (true)`, y la
-- anon key va en el bundle público de varias apps. Cualquiera puede descargar las
-- 117 filas COMPLETAS — incluida `initial_password`, la contraseña asignada por
-- admin, que 31 personas todavía tienen sin cambiar.
--
-- El fix mínimo NO es cerrar la tabla (eso rompería Milo y quizá Dam, que la leen
-- con la anon key y sin sesión). Es quitarle a `anon` UNA columna: la que tiene
-- credenciales. Todo lo demás sigue exactamente igual.
--
-- ✅ NO REQUIERE DESPLEGAR NINGUNA APP. Verificado el 2026-08-07: en los 6 repos
--    vivos, los únicos que leen `initial_password` son user-version (que ya pasa
--    por los RPCs de la fase 1) y la Edge Function `admin-upsert-users`, que la
--    ESCRIBE con `service_role` y por tanto no la afectan estos grants.
--
--    Lo que siguen leyendo las demás, y que aquí NO se toca:
--      · Milo        → nombre, email, seniority, especialidad, formador, proyecto*
--      · Dam 1.1     → nombre, especialidad, email, formador
--      · Pao chatbot → especialidad, seniority, proyecto
--      · uix-space   → email
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- Los privilegios de Supabase son de tabla completa, así que para excluir una
-- columna hay que revocar la tabla y re-otorgar la lista explícita.
revoke select on public.ranking_user from anon;

grant select (
  id, user_id, email, nombre, seniority, especialidad, emp_id,
  formador, proyecto, proyecto_2, proyecto_3, proyecto_4,
  foto_url, nickname, welcome_seen_at
) on public.ranking_user to anon;

-- Higiene: `anon` tiene grants de escritura que ninguna política permite ejercer,
-- así que quitarlos no cambia ningún comportamiento — sólo deja de ser una bomba
-- armada por si alguien añade una política permisiva sin mirar los grants.
revoke insert, update, delete, truncate, references, trigger
  on public.ranking_user from anon;

commit;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- ─────────────────────────────────────────────────────────────────────────────
-- -- 1. No debe devolver filas (anon ya no ve la columna):
-- select column_name from information_schema.column_privileges
-- where table_schema='public' and table_name='ranking_user'
--   and grantee='anon' and column_name='initial_password';
--
-- -- 2. Debe devolver 15 (todo lo demás sigue legible para anon):
-- select count(*) from information_schema.column_privileges
-- where table_schema='public' and table_name='ranking_user'
--   and grantee='anon' and privilege_type='SELECT';


-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
-- ─────────────────────────────────────────────────────────────────────────────
-- grant select, insert, update, delete on public.ranking_user to anon;
