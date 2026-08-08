-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 2d — `anon` deja de poder listar la plantilla        [APLICADA 2026-08-07]
--
-- Tras la 2a y la 2c ya no había credenciales expuestas. Lo que quedaba es que
-- sin sesión se podían descargar las 117 filas con nombre, correo corporativo,
-- emp_id, seniority, especialidad, formador y proyectos: la plantilla entera de
-- la empresa servida por internet a quien tuviera la anon key (que va en el
-- bundle público de varias apps).
--
-- Consumidores verificados uno por uno antes de aplicar:
--
--   user-version   RPC `check_email_registered` (anon, devuelve UNA fila y sólo
--                  el nombre). Es el único acceso sin sesión que queda.
--   uix-space      Igual — mismo RPC en su pantalla de login.
--   admin-version  Edge Functions con `service_role`; los grants de anon y
--                  authenticated no le afectan.
--   Pao chatbot    Login real de Supabase (`signInWithPassword`), así que sus
--                  lecturas van como `authenticated`.
--   Dam 1.1        Cliente autenticado sobre ESTE proyecto. Sus dos lecturas
--                  están detrás de `if (supabaseUser?.email)` y
--                  `enabled: !!user?.name`: nunca corren sin sesión.
--                  (Su segundo cliente, `supabaseData`, apunta a otro proyecto.)
--   Milo           Recibe el perfil completo por `postMessage` (`MILO_USER`:
--                  email, nombre, emp_id, proyectos, seniority, especialidad) y
--                  lo usa directamente, sin consultar la tabla. Ese es su camino
--                  principal y el que ejercita UiX-Lingo al abrir el iframe.
--
-- ⚠️  Único resto conocido: Milo tiene un camino de respaldo que, con `milo_email`
--     ya cacheado en sessionStorage y sin sesión establecida, sí consulta
--     `ranking_user` de forma anónima (`sx()` → `dA()`). Con esta migración esa
--     consulta falla y el perfil degrada a mostrar el correo en vez del nombre.
--     No rompe la app ni pierde datos.
--
--     Arreglo pendiente, del lado de Milo: escuchar el mensaje `SUPABASE_SESSION`
--     que UiX-Lingo YA le envía (js/app-main.js:3912, con access_token y
--     refresh_token) y llamar a `setSession` en su cliente de este proyecto.
--     Milo ya implementa esa ruta para tokens que llegan por query param
--     (`sso_at`/`sso_rt`); sólo le falta aceptarlos también por postMessage.
--     Con eso su respaldo pasaría a leer autenticado y el resto desaparece.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "Anon email check"           on public.ranking_user;
drop policy if exists "ru_select_public"           on public.ranking_user;
drop policy if exists "Dashboard lee ranking_user" on public.ranking_user;

revoke all on public.ranking_user from anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN — no debe devolver filas:
-- select grantee, privilege_type from information_schema.role_table_grants
-- where table_schema='public' and table_name='ranking_user' and grantee='anon';
--
-- Y el login debe seguir resolviendo:
-- select public.check_email_registered('alguien@elektra.com.mx');
-- ─────────────────────────────────────────────────────────────────────────────

-- ROLLBACK:
-- grant select on public.ranking_user to anon;
-- create policy "ru_select_public" on public.ranking_user
--   for select to anon, authenticated using (true);
