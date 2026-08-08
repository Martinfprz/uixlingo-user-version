-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 2d — `anon` deja de poder listar la plantilla   (OPCIONAL, la menos urgente)
--
-- Tras la 2a ya no hay credenciales expuestas. Lo que queda es que sin sesión se
-- pueden seguir descargando las 117 filas con nombre, correo corporativo, emp_id,
-- seniority, especialidad, formador y proyectos. No son credenciales, pero es la
-- plantilla entera de la empresa servida por internet.
--
-- ⚠️  REQUIERE MIGRAR ANTES A MILO Y DAM 1.1. Ambos leen `ranking_user` con la
--     anon key y SIN sesión de Supabase:
--       · Milo    → src/lib/supabaseUiXLingo.ts crea un cliente solo con la anon
--                   key; no hay `setSession` en todo el repo. Se rompe en silencio
--                   (el .then() sólo desestructura `data`, no hay rama de error).
--       · Dam 1.1 → artifacts/talent-app: lee por email con auth propia de backend.
--                   SIN CONFIRMAR si su cliente de Supabase lleva JWT — verificar.
--
--     Dos caminos, no excluyentes:
--       1. Migrar Milo a SSO real (`setSession` con los tokens — el "patrón A" de
--          uix-space/SSO-INTEGRACION-PLATAFORMAS.md). Es el fix correcto.
--       2. Crear un RPC `get_perfil_publico(p_email)` SECURITY DEFINER que
--          devuelva sólo los campos que Milo necesita para UN correo, dárselo a
--          `anon`, y apuntar Milo ahí. No requiere tocar su auth, y aun así
--          impide descargarse la plantilla completa.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

drop policy if exists "Anon email check"           on public.ranking_user;
drop policy if exists "ru_select_public"           on public.ranking_user;
drop policy if exists "Dashboard lee ranking_user" on public.ranking_user;

revoke all on public.ranking_user from anon;

commit;

-- VERIFICACIÓN — no debe devolver filas:
-- select grantee, privilege_type from information_schema.role_table_grants
-- where table_schema='public' and table_name='ranking_user' and grantee='anon';

-- ROLLBACK:
-- grant select on public.ranking_user to anon;
-- create policy "ru_select_public" on public.ranking_user
--   for select to anon, authenticated using (true);
