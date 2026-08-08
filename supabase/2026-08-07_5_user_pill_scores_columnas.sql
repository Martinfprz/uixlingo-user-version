-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 5 — `user_pill_scores`: las dos columnas que el código llevaba esperando
--
-- Hallado probando el paso B: el cliente lleva tiempo intentando escribir
-- `errors` y `sticker_granted`, fallando, y cayendo en un fallback legado que
-- sólo guarda score/total. Consecuencia: **el sello nunca se persistió** — se
-- recalculaba en el navegador en cada carga a partir de `total - score`.
--
-- Con el scoring en servidor el sello pasa a ser un hecho decidido y guardado por
-- la Edge Function, que además valida la ventana de 7 días con el reloj del
-- servidor y no con el del navegador.
--
-- ✅ Aditiva. El relleno histórico aplica exactamente la misma regla que usaba el
--    cliente (sello con 0 o 1 error), así que ningún sello ya mostrado cambia.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.user_pill_scores
  add column if not exists errors integer,
  add column if not exists sticker_granted boolean not null default false;

update public.user_pill_scores
set errors = greatest(coalesce(total, 0) - coalesce(score, 0), 0)
where errors is null;

update public.user_pill_scores
set sticker_granted = (coalesce(total, 0) > 0 and coalesce(errors, 0) <= 1)
where sticker_granted = false;
