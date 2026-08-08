-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 2c — `initial_password` deja de ser legible también con sesión
--
-- La 2a se la quitó a `anon` (el caso grave: sin login). Falta el caso interno:
-- hoy cualquiera de las 117 personas, ya autenticada, puede leer la contraseña
-- inicial de cualquier otra. Las 31 que no la han cambiado siguen expuestas.
--
-- ⚠️  REQUIERE DESPLEGAR user-version primero. La versión en producción todavía
--     hace `.select('nombre, initial_password')` en el login; sin la columna, la
--     detección de primer login deja de funcionar EN SILENCIO (el login sigue
--     entrando, pero ya no fuerza el cambio de contraseña).
--     La versión en el working tree ya usa el RPC `is_initial_password`.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

revoke select, insert, update, delete, references, trigger
  on public.ranking_user from authenticated;

grant select (
  id, user_id, email, nombre, seniority, especialidad, emp_id,
  formador, proyecto, proyecto_2, proyecto_3, proyecto_4,
  foto_url, nickname, welcome_seen_at
) on public.ranking_user to authenticated;

grant update (
  nombre, nickname, foto_url, welcome_seen_at,
  proyecto, proyecto_2, proyecto_3, proyecto_4
) on public.ranking_user to authenticated;

grant insert on public.ranking_user to authenticated;

-- El único acceso que queda a la columna es vía los RPCs SECURITY DEFINER de la
-- fase 1 (is_initial_password / clear_initial_password), anclados a auth.uid().
-- `service_role` no se toca: la Edge Function admin-upsert-users sigue igual.

commit;

-- VERIFICACIÓN — no debe devolver filas:
-- select grantee from information_schema.column_privileges
-- where table_schema='public' and table_name='ranking_user'
--   and column_name='initial_password' and grantee in ('anon','authenticated');

-- ROLLBACK:
-- grant select, insert, update, delete on public.ranking_user to authenticated;
