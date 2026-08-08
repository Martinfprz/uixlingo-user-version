-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 6 — Devuelve al panel de admin lo que los cierres de hoy le quitaron
--
-- El panel corre en el navegador con la anon key y un login normal: el admin es
-- un `authenticated` con `app_metadata.role = 'admin'`, y se apoya en RLS
-- (`is_admin()`). Los grants, en cambio, son POR ROL y no distinguen admin de
-- usuario, así que al revocarlos para cerrar fugas se llevaron por delante al
-- panel. Esto lo repara sin reabrir nada.
--
-- Dos mecanismos según el caso:
--   · Donde basta filtrar FILAS  → RLS (grant de vuelta + política is_admin()).
--   · Donde hay que filtrar COLUMNAS (initial_password) o el grant no puede
--     distinguir → RPC SECURITY DEFINER con guardia de admin.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── A. Bancos de preguntas: el admin lee la tabla, el resto la vista ─────────
-- `Admin full` (ALL, is_admin()) ya existía. Sobraban dos políticas SELECT con
-- `USING (true)` que dejaban leer las respuestas a cualquier persona logueada:
-- eran justo lo que cerró la fase 3b. Se van, y con el grant de vuelta el
-- admin pasa por `Admin full` mientras el usuario normal no encuentra política
-- que le aplique y recibe cero filas.
-- Las vistas `_publico` no se ven afectadas: se ejecutan con los permisos de su
-- dueño, así que siguen sirviendo al cliente.
drop policy if exists "Auth read"      on public.preguntas_evaluacion;
drop policy if exists "pe_select_auth" on public.preguntas_evaluacion;
drop policy if exists "Auth read"      on public.pill_questions;
drop policy if exists "pq_select_auth" on public.pill_questions;

grant select on public.preguntas_evaluacion to authenticated;
grant select on public.pill_questions       to authenticated;


-- ── B. ranking_user: RPCs de admin ──────────────────────────────────────────
-- El panel necesita leer la fila COMPLETA (incluida `initial_password`, que es
-- lo que reparte al dar de alta) y escribir columnas que el usuario normal no
-- debe poder tocar (`formador`, `especialidad`, `seniority`, `emp_id`). Como el
-- grant de columna no sabe quién es admin, va por función.

create or replace function public.admin_ranking_user_rows(p_email text default null)
returns setof public.ranking_user
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return query
    select * from public.ranking_user r
    where p_email is null or lower(r.email) = lower(btrim(p_email));
end;
$$;

comment on function public.admin_ranking_user_rows(text) is
  'Panel de admin: fila(s) completas de ranking_user, incluida initial_password. Sin p_email devuelve todas.';


create or replace function public.admin_ranking_user_upsert(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  afectadas integer;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  -- `id` y `user_id` son NOT NULL, y Postgres los valida ANTES de resolver el
  -- ON CONFLICT: un upsert parcial sobre una fila existente reventaba. Por eso
  -- se recuperan de la fila actual cuando el JSON no los trae.
  with entrada as (
    select jsonb_populate_record(null::public.ranking_user, valor) as fila
    from jsonb_array_elements(p_rows) as valor
  ),
  resuelta as (
    select
      e.fila,
      lower(btrim((e.fila).email)) as correo,
      (select r2.id      from public.ranking_user r2
        where lower(r2.email) = lower(btrim((e.fila).email))) as id_existente,
      (select r2.user_id from public.ranking_user r2
        where lower(r2.email) = lower(btrim((e.fila).email))) as user_id_existente
    from entrada e
    where (e.fila).email is not null and btrim((e.fila).email) <> ''
  )
  insert into public.ranking_user (
    id, user_id, email, nombre, seniority, especialidad, emp_id, formador,
    proyecto, proyecto_2, proyecto_3, proyecto_4, foto_url, nickname
  )
  select
    coalesce((fila).id, id_existente, gen_random_uuid()),
    coalesce((fila).user_id, user_id_existente),
    correo,
    (fila).nombre, (fila).seniority, (fila).especialidad, (fila).emp_id,
    (fila).formador, (fila).proyecto, (fila).proyecto_2, (fila).proyecto_3,
    (fila).proyecto_4, (fila).foto_url, (fila).nickname
  from resuelta
  on conflict (email) do update set
    nombre       = coalesce(excluded.nombre,       public.ranking_user.nombre),
    seniority    = coalesce(excluded.seniority,    public.ranking_user.seniority),
    especialidad = coalesce(excluded.especialidad, public.ranking_user.especialidad),
    emp_id       = coalesce(excluded.emp_id,       public.ranking_user.emp_id),
    formador     = coalesce(excluded.formador,     public.ranking_user.formador),
    proyecto     = coalesce(excluded.proyecto,     public.ranking_user.proyecto),
    proyecto_2   = coalesce(excluded.proyecto_2,   public.ranking_user.proyecto_2),
    proyecto_3   = coalesce(excluded.proyecto_3,   public.ranking_user.proyecto_3),
    proyecto_4   = coalesce(excluded.proyecto_4,   public.ranking_user.proyecto_4),
    nickname     = coalesce(excluded.nickname,     public.ranking_user.nickname),
    foto_url     = coalesce(excluded.foto_url,     public.ranking_user.foto_url),
    user_id      = coalesce(excluded.user_id,      public.ranking_user.user_id);

  get diagnostics afectadas = row_count;
  return afectadas;
end;
$$;

comment on function public.admin_ranking_user_upsert(jsonb) is
  'Panel de admin: alta/actualización por email. Las claves ausentes en el JSON conservan su valor actual.';


create or replace function public.admin_ranking_user_update(p_email text, p_patch jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  afectadas integer;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  update public.ranking_user r set
    nombre       = coalesce(p_patch->>'nombre',       r.nombre),
    seniority    = coalesce(p_patch->>'seniority',    r.seniority),
    especialidad = coalesce(p_patch->>'especialidad', r.especialidad),
    emp_id       = coalesce(p_patch->>'emp_id',       r.emp_id),
    formador     = coalesce(p_patch->>'formador',     r.formador),
    proyecto     = coalesce(p_patch->>'proyecto',     r.proyecto),
    proyecto_2   = coalesce(p_patch->>'proyecto_2',   r.proyecto_2),
    proyecto_3   = coalesce(p_patch->>'proyecto_3',   r.proyecto_3),
    proyecto_4   = coalesce(p_patch->>'proyecto_4',   r.proyecto_4),
    nickname     = coalesce(p_patch->>'nickname',     r.nickname),
    foto_url     = coalesce(p_patch->>'foto_url',     r.foto_url)
  where lower(r.email) = lower(btrim(p_email));

  get diagnostics afectadas = row_count;
  return afectadas;
end;
$$;

comment on function public.admin_ranking_user_update(text, jsonb) is
  'Panel de admin: actualización parcial por email. No toca initial_password.';


revoke all on function public.admin_ranking_user_rows(text)          from public;
revoke all on function public.admin_ranking_user_upsert(jsonb)       from public;
revoke all on function public.admin_ranking_user_update(text, jsonb) from public;
grant execute on function public.admin_ranking_user_rows(text)          to authenticated;
grant execute on function public.admin_ranking_user_upsert(jsonb)       to authenticated;
grant execute on function public.admin_ranking_user_update(text, jsonb) to authenticated;

commit;
