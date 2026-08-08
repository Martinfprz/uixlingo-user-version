// ─────────────────────────────────────────────────────────────────────────────
// submit-quiz — califica y persiste el resultado de un quiz en el servidor.
//
// Por qué existe:
//   Hasta ahora el navegador calificaba y hacía `upsert` directo a `user_scores`
//   y `ranking_user`. Con RLS `USING (auth.uid() = user_id)` eso significa que
//   cualquiera con DevTools podía escribirse el puntaje que quisiera. Esta
//   función es ahora la ÚNICA vía de escritura: usa service_role, recalifica
//   contra las respuestas guardadas en la base y aplica las reglas de negocio.
//
// El cliente manda QUÉ contestó, nunca CUÁNTO sacó.
//
// Contrato:
//   POST { mode, pillId?, answers: [{ id, answer }], timeSeconds }
//   200  { ok, score, total, persisted, sealGranted, errors: [...] }
//
// `errors` trae la explicación y la respuesta correcta de cada fallo. Es lo que
// alimenta el feedback diferido de evaluación y pills, cuyos bancos ya no
// exponen la columna `correcta` al cliente.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type Mode = "practice" | "evaluation" | "pills";
type Answer = { id?: string; answer?: string | boolean };
type SubmitRequest = { mode?: Mode; pillId?: string; answers?: Answer[]; timeSeconds?: number };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Mismo criterio que `PILLS_SEAL_WINDOW_HOURS` en js/constants.js. Si cambia allá,
// tiene que cambiar aquí: es la regla que decide si el sello todavía se puede ganar.
const PILLS_SEAL_WINDOW_HOURS = 168;

// Orígenes permitidos. `ALLOWED_ORIGINS` (coma-separado) permite añadir dominios
// sin redesplegar código; el fallback cubre producción y desarrollo local.
// Mismo valor que PUBLIC_APP_ORIGIN en js/constants.js.
const DEFAULT_ORIGINS = ["https://uixlingo-user-version.vercel.app"];
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",").map((o) => o.trim()).filter(Boolean);
const ORIGINS = ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : DEFAULT_ORIGINS;

function getCorsHeaders(origin: string): Record<string, string> {
  const allowed =
    ORIGINS.includes(origin) ||
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

/** Resuelve al usuario a partir del JWT. Sin sesión válida no se escribe nada. */
async function requireCaller(req: Request, admin: SupabaseClient) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("Falta el token de sesión");
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) throw new Error("Sesión inválida");
  return data.user;
}

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

// ── Calificación ─────────────────────────────────────────────────────────────

type Graded = {
  score: number;
  total: number;
  errors: Array<{ id: string; question: string; correct: string; explanation: string; studyTag: string }>;
};

/**
 * Opción múltiple (`banco_preguntas` / `preguntas_evaluacion`): `correcta` guarda
 * la letra A/B/C y el cliente manda la letra de la opción que eligió. Comparar
 * letras y no textos evita que un cambio de copy invalide respuestas históricas.
 */
async function gradeMultipleChoice(
  admin: SupabaseClient, table: string, answers: Answer[],
): Promise<Graded> {
  const ids = answers.map((a) => String(a.id || "")).filter(Boolean);
  if (!ids.length) return { score: 0, total: 0, errors: [] };

  const { data, error } = await admin
    .from(table)
    .select("id, q, a, b, c, correcta, expl, tag")
    .in("id", ids);
  if (error) throw new Error(`No se pudo leer ${table}: ${error.message}`);

  const byId = new Map((data || []).map((row) => [String(row.id), row]));
  const errors: Graded["errors"] = [];
  let score = 0;
  let total = 0;

  for (const a of answers) {
    const row = byId.get(String(a.id || ""));
    // Una pregunta que el cliente inventó (id inexistente) no suma ni resta:
    // simplemente no cuenta para el total.
    if (!row) continue;
    total++;

    const correcta = norm(row.correcta);
    if (norm(a.answer) === correcta) {
      score++;
    } else {
      const textoCorrecto = correcta === "A" ? row.a : correcta === "B" ? row.b : row.c;
      errors.push({
        id: String(row.id),
        question: String(row.q || ""),
        correct: String(textoCorrecto || ""),
        explanation: String(row.expl || ""),
        studyTag: String(row.tag || ""),
      });
    }
  }
  return { score, total, errors };
}

/** Pills: `correct_answer` es booleano (verdadero/falso). */
async function gradePills(
  admin: SupabaseClient, pillId: string, answers: Answer[],
): Promise<Graded> {
  const ids = answers.map((a) => String(a.id || "")).filter(Boolean);
  if (!ids.length) return { score: 0, total: 0, errors: [] };

  const { data, error } = await admin
    .from("pill_questions")
    .select("id, pill_id, question, correct_answer, explanation")
    .eq("pill_id", pillId)
    .in("id", ids);
  if (error) throw new Error(`No se pudo leer pill_questions: ${error.message}`);

  const byId = new Map((data || []).map((row) => [String(row.id), row]));
  const errors: Graded["errors"] = [];
  let score = 0;
  let total = 0;

  for (const a of answers) {
    const row = byId.get(String(a.id || ""));
    if (!row) continue;
    total++;

    // El cliente puede mandar booleano o "V"/"F"; se normaliza a booleano.
    const elegida = typeof a.answer === "boolean" ? a.answer : ["V", "TRUE", "VERDADERO"].includes(norm(a.answer));
    if (elegida === Boolean(row.correct_answer)) {
      score++;
    } else {
      errors.push({
        id: String(row.id),
        question: String(row.question || ""),
        correct: row.correct_answer ? "Verdadero" : "Falso",
        explanation: String(row.explanation || ""),
        studyTag: "",
      });
    }
  }
  return { score, total, errors };
}

// ── Persistencia ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req.headers.get("Origin") || "");
  const json = (s: number, b: unknown) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { ok: false, error: "Missing Supabase environment variables" });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let user;
  try {
    user = await requireCaller(req, admin);
  } catch (e) {
    return json(401, { ok: false, error: (e as Error).message });
  }

  let body: SubmitRequest;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "Body inválido" });
  }

  const mode = body.mode;
  if (mode !== "practice" && mode !== "evaluation" && mode !== "pills") {
    return json(400, { ok: false, error: "Modo desconocido" });
  }
  const answers = Array.isArray(body.answers) ? body.answers : [];
  const timeSeconds = Math.max(0, Number(body.timeSeconds || 0));
  const pillId = String(body.pillId || "").trim();
  if (mode === "pills" && !pillId) return json(400, { ok: false, error: "Falta pillId" });

  const userId = user.id;
  const email = String(user.email || "").trim().toLowerCase();

  try {
    // 1. Calificar contra la verdad del servidor.
    const graded = mode === "pills"
      ? await gradePills(admin, pillId, answers)
      : await gradeMultipleChoice(
          admin, mode === "evaluation" ? "preguntas_evaluacion" : "banco_preguntas", answers,
        );

    // 2. Estado actual — decide si este intento cuenta.
    const [{ data: rankingRow }, { data: scoresRow }] = await Promise.all([
      admin.from("ranking_user").select("user_id, nombre, email").eq("user_id", userId).maybeSingle(),
      admin.from("user_scores")
        .select("quest_points, tests_points_q2, pills_points, pills_rank_pill_id")
        .eq("user_id", userId).maybeSingle(),
    ]);
    const existing = scoresRow || {};
    const nombre = String(rankingRow?.nombre || "").trim();

    const now = new Date().toISOString();
    const scoresMerge: Record<string, unknown> = { user_id: userId, fecha: now };
    let persisted = false;
    let sealGranted = false;

    if (mode === "practice") {
      // Reintentos ilimitados: se conserva el mejor récord.
      const prev = Number(existing.quest_points || 0);
      scoresMerge.quest_points = Math.max(prev, graded.score);
      persisted = graded.score > prev;

    } else if (mode === "evaluation") {
      // Un solo intento: sólo cuenta si nunca se registró uno.
      if (existing.tests_points_q2 == null) {
        scoresMerge.tests_points_q2 = graded.score;
        scoresMerge.puntos = graded.score;
        scoresMerge.tiempo = timeSeconds;
        persisted = true;
      }

    } else {
      // Pills: el ranking lo fija el PRIMER intento de la píldora más reciente.
      const [{ data: pill }, { data: latestRows }, { data: prevAttempt }] = await Promise.all([
        admin.from("pills").select("id, published_at").eq("id", pillId).maybeSingle(),
        admin.from("pills").select("id").order("published_at", { ascending: false }).limit(1),
        admin.from("user_pill_scores").select("pill_id, score, total")
          .eq("user_id", userId).eq("pill_id", pillId).maybeSingle(),
      ]);

      const isLatestPill = String(latestRows?.[0]?.id || "") === pillId;
      const isFirstAttempt = !prevAttempt;
      const qualifies = graded.score > 0;
      // Si el ranking ya quedó tomado por esta misma píldora, no se pisa.
      const rankingLocked =
        isLatestPill &&
        Number(existing.pills_points || 0) > 0 &&
        String(existing.pills_rank_pill_id || "") === pillId;

      if (isLatestPill && !rankingLocked && qualifies && isFirstAttempt) {
        scoresMerge.pills_points = graded.score;
        scoresMerge.pills_rank_pill_id = pillId;
        scoresMerge.pills_rank_tiempo = timeSeconds;
        persisted = true;
      }

      if (isFirstAttempt && qualifies) {
        // Ventana de 7 días: el sello sólo se gana dentro del plazo. Se evalúa
        // aquí y no en el cliente, donde bastaba con mover el reloj del sistema.
        const publishedAtMs = pill?.published_at ? Date.parse(String(pill.published_at)) : 0;
        const dentroDeVentana =
          !publishedAtMs || Date.now() <= publishedAtMs + PILLS_SEAL_WINDOW_HOURS * 3600 * 1000;
        const errCount = Math.max(graded.total - graded.score, 0);
        sealGranted = graded.total > 0 && errCount <= 1 && dentroDeVentana;

        const { error: pillErr } = await admin.from("user_pill_scores").upsert({
          user_id: userId, pill_id: pillId,
          score: graded.score, total: graded.total,
          errors: errCount, sticker_granted: sealGranted,
        }, { onConflict: "user_id,pill_id" });
        if (pillErr) throw new Error(`user_pill_scores: ${pillErr.message}`);
      }
    }

    // 3. Escribir. Sólo se toca `user_scores` si este intento realmente cuenta;
    //    así un reintento no pisa la fecha ni el récord anterior.
    if (persisted) {
      const { error: scoreErr } = await admin
        .from("user_scores").upsert(scoresMerge, { onConflict: "user_id" });
      if (scoreErr) throw new Error(`user_scores: ${scoreErr.message}`);

      // Espejo en `user_profiles` (columnas distintas: evaluación va a `tests_points`).
      const profileColumn =
        mode === "practice" ? "quest_points" : mode === "evaluation" ? "tests_points" : "pills_points";
      const bestForProfile =
        mode === "practice" ? Number(scoresMerge.quest_points || 0) : graded.score;
      // Un fallo aquí no invalida el puntaje: la verdad ya quedó en `user_scores`.
      const { error: profErr } = await admin.from("user_profiles").upsert({
        id: userId, [profileColumn]: bestForProfile, nombre, email,
      }, { onConflict: "id" });
      if (profErr) console.warn("[submit-quiz] espejo user_profiles falló:", profErr.message);
    }

    return json(200, {
      ok: true,
      score: graded.score,
      total: graded.total,
      persisted,
      sealGranted,
      errors: graded.errors,
    });
  } catch (e) {
    console.error("[submit-quiz]", e);
    return json(500, { ok: false, error: (e as Error).message });
  }
});
