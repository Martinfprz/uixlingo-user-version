-- UiX-lingo: bloqueos de la evaluación (anti-cheat) con desbloqueo desde la app
-- Ejecutar en Supabase → SQL Editor (proyecto pmezmoobuwwbirwzensj).
-- Idempotente: se puede correr varias veces.
--
-- POR QUÉ EXISTE
-- El contador de violaciones vivía SOLO en el localStorage de cada persona
-- (uix_eval_violations_v1:<user_id>). Eso tenía dos problemas: nadie más podía
-- desbloquear a quien se bloqueó por error (había que meterse a su navegador), y
-- cualquiera se lo quitaba borrando la llave o cambiando de navegador.
-- Ahora la cuenta vive aquí y el localStorage es solo un espejo local.
--
-- LO QUE SIGUE SIENDO CIERTO
-- El anti-cheat no es infalible: el conteo lo manda el cliente, así que alguien
-- con la consola abierta puede no reportar su salida de ventana. Lo que esto sí
-- resuelve es que el bloqueo ya no se limpia solo desde el navegador y que hay
-- un control real para quitarlo (is_admin()).

CREATE TABLE IF NOT EXISTS public.evaluacion_bloqueos (
  user_id          uuid PRIMARY KEY,
  nombre           text,         -- se llena con trigger, como el resto de las tablas
  email            text,
  violaciones      integer NOT NULL DEFAULT 0,
  ultima_razon     text,         -- 'focus_lost', 'visibility_hidden', …
  ultima_violacion timestamptz,
  desbloqueado_at  timestamptz,  -- último desbloqueo manual
  desbloqueado_por text,         -- correo de quien lo desbloqueó
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_bloqueos_violaciones
  ON public.evaluacion_bloqueos (violaciones DESC);

-- ─── RLS ──────────────────────────────────────────────────────────────────
-- Cada quien ve y actualiza su propia fila (el cliente reporta sus violaciones);
-- is_admin() ve todas y es el único que puede bajar el contador o borrar filas.
ALTER TABLE public.evaluacion_bloqueos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ve su bloqueo o admin ve todos"  ON public.evaluacion_bloqueos;
DROP POLICY IF EXISTS "Registra su propio bloqueo"      ON public.evaluacion_bloqueos;
DROP POLICY IF EXISTS "Actualiza su bloqueo o admin"    ON public.evaluacion_bloqueos;
DROP POLICY IF EXISTS "Solo admin borra bloqueos"       ON public.evaluacion_bloqueos;

CREATE POLICY "Ve su bloqueo o admin ve todos" ON public.evaluacion_bloqueos
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR is_admin());

CREATE POLICY "Registra su propio bloqueo" ON public.evaluacion_bloqueos
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR is_admin());

CREATE POLICY "Actualiza su bloqueo o admin" ON public.evaluacion_bloqueos
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR is_admin())
  WITH CHECK (auth.uid() = user_id OR is_admin());

CREATE POLICY "Solo admin borra bloqueos" ON public.evaluacion_bloqueos
  FOR DELETE TO authenticated USING (is_admin());

-- ─── Trigger: nombre/email + el contador solo puede subir ─────────────────
-- La policy de UPDATE deja que cada quien toque su fila (necesario para reportar
-- una violación nueva), así que la integridad del contador se cuida aquí: si el
-- que actualiza no es admin, no puede bajarlo ni marcarse un desbloqueo.
CREATE OR REPLACE FUNCTION public.tg_evaluacion_bloqueos_guard()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  new.nombre := coalesce((SELECT r.nombre FROM public.ranking_user r WHERE r.user_id = new.user_id), new.nombre);
  new.email  := coalesce((SELECT r.email  FROM public.ranking_user r WHERE r.user_id = new.user_id), new.email);

  IF TG_OP = 'UPDATE' AND NOT is_admin() THEN
    IF new.violaciones < old.violaciones THEN
      new.violaciones := old.violaciones;      -- bajarlo es cosa de admin
    END IF;
    new.desbloqueado_at  := old.desbloqueado_at;
    new.desbloqueado_por := old.desbloqueado_por;
  END IF;

  RETURN new;
END $fn$;

DROP TRIGGER IF EXISTS trg_evaluacion_bloqueos_guard ON public.evaluacion_bloqueos;
CREATE TRIGGER trg_evaluacion_bloqueos_guard
  BEFORE INSERT OR UPDATE ON public.evaluacion_bloqueos
  FOR EACH ROW EXECUTE FUNCTION public.tg_evaluacion_bloqueos_guard();
