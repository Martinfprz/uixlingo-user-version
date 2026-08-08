-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 1 — RPCs que sustituyen los SELECT anónimos sobre `ranking_user`
--
-- Es puramente ADITIVA: no quita ningún permiso, así que se puede aplicar en
-- producción sin coordinar con los despliegues. Deja listas las dos funciones
-- que los clientes necesitan ANTES de que la fase 2 cierre el acceso anon.
--
-- Contexto del problema que resuelve:
--   `ranking_user` tiene hoy 3 políticas SELECT con `USING (true)` abiertas al
--   rol `anon`. Como la anon key viaja en el bundle público, cualquiera puede
--   leer las 117 filas completas: email, nombre, emp_id e `initial_password`.
--   El único flujo que realmente necesita acceso sin sesión es el "¿existe este
--   correo?" de la pantalla de login (user-version y uix-space).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Check de correo pre-login ─────────────────────────────────────────────
-- Sustituye a `.from('ranking_user').select('nombre, email').eq('email', ...)`.
-- SECURITY DEFINER para que pueda leer la tabla con las políticas ya cerradas.
-- Devuelve SOLO el nombre: es lo que la UI usa para el saludo ("Hola, Martín").
-- No devuelve email, emp_id ni initial_password, y al recibir el correo exacto
-- no permite enumerar la plantilla.
create or replace function public.check_email_registered(p_email text)
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select r.nombre
  from public.ranking_user r
  where lower(r.email) = lower(btrim(p_email))
  limit 1;
$$;

comment on function public.check_email_registered(text) is
  'Pre-login: confirma que el correo pertenece a la plantilla y devuelve el nombre para el saludo. Reemplaza el SELECT anon sobre ranking_user.';

revoke all on function public.check_email_registered(text) from public;
grant execute on function public.check_email_registered(text) to anon, authenticated;


-- ── 2. Detección de primer login ─────────────────────────────────────────────
-- Sustituye a `.select('nombre, initial_password')`, que enviaba la contraseña
-- inicial al navegador. Se llama YA autenticado (justo después de que
-- signInWithPassword resolvió), así que se ancla a `auth.uid()` y sólo puede
-- responder sobre la fila de quien la invoca: nunca sobre la de un tercero.
-- Devuelve un booleano; la contraseña nunca sale de la base.
create or replace function public.is_initial_password(p_password text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select btrim(coalesce(r.initial_password, '')) <> ''
            and r.initial_password = p_password
     from public.ranking_user r
     where r.user_id = auth.uid()
     limit 1),
    false);
$$;

comment on function public.is_initial_password(text) is
  'Post-login: indica si la contraseña usada es todavía la inicial asignada por admin, para forzar el cambio. Nunca expone el valor.';

revoke all on function public.is_initial_password(text) from public;
grant execute on function public.is_initial_password(text) to authenticated;


-- ── 3. Limpieza de la contraseña inicial ─────────────────────────────────────
-- Hoy el cliente hace `.update({ initial_password: null }).eq('email', ...)`.
-- Con la fase 2 el rol pierde el privilegio de columna, así que el borrado pasa
-- por aquí. Anclado a auth.uid() por la misma razón que arriba.
create or replace function public.clear_initial_password()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.ranking_user
  set initial_password = null
  where user_id = auth.uid();
$$;

comment on function public.clear_initial_password() is
  'Borra la contraseña inicial de quien invoca, tras completar el cambio de contraseña.';

revoke all on function public.clear_initial_password() from public;
grant execute on function public.clear_initial_password() to authenticated;
