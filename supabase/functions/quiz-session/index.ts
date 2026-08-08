// ─────────────────────────────────────────────────────────────────────────────
// quiz-session — sesión de evaluación / pill con estado en servidor.
//
// Por qué existe:
//   Para esconder las respuestas correctas sin perder el feedback inmediato ni la
//   racha. El cliente nunca recibe `correcta`; la pide pregunta a pregunta, y sólo
//   DESPUÉS de haber contestado.
//
//   Lo que hace que no se pueda hacer trampa: una respuesta se registra UNA sola
//   vez (`start` fija las preguntas, `answer` no sobrescribe). Un segundo intento
//   sobre la misma pregunta devuelve el veredicto ya guardado, así que sondear el
//   endpoint no revela nada. Y `finish` califica desde lo que guardó el SERVIDOR,
//   ignorando cualquier cosa que mande el cliente.
//
//   Práctica no usa esto: tiene reintentos ilimitados y su banco sigue abierto,
//   así que va por `submit-quiz` y conserva el feedback local.
//
// Contrato:
//   POST { action: "start",  mode, pillId?, candidateIds[], limit }
//     → { ok, sessionId, questions }              (preguntas SIN respuesta)
//   POST { action: "answer", sessionId, questionId, answer }
//     → { ok, correct, correctText, explanation, studyTag, alreadyAnswered }
//   POST { action: "finish", sessionId, timeSeconds }
//     → { ok, score, total, persisted, sealGranted, errors }
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Mismo criterio que `PILLS_SEAL_WINDOW_HOURS` en js/constants.js.
const PILLS_SEAL_WINDOW_HOURS = 168;
// Tope duro de preguntas por sesión, por si el cliente manda un `limit` absurdo.
const MAX_QUESTIONS = 100;

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

async function requireCaller(req: Request, admin: SupabaseClient) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("Falta el token de sesión");
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) throw new Error("Sesión inválida");
  return data.user;
}

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();
const isEval = (mode: string) => mode === "evaluation";

/** Baraja en el servidor: el cliente no elige qué preguntas le tocan. */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Carga una sesión y comprueba que sea de quien la pide. */
async function loadSession(admin: SupabaseClient, sessionId: string, userId: string) {
  const { data, error } = await admin
    .from("quiz_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) throw new Error(`quiz_sessions: ${error.message}`);
  if (!data) throw new Error("Sesión de quiz no encontrada");
  // Comparar contra el JWT y no contra el cuerpo: es lo que impide contestar la
  // sesión de otra persona conociendo su id.
  if (String(data.user_id) !== userId) throw new Error("Esa sesión no es tuya");
  return data;
}

// ── Acciones ─────────────────────────────────────────────────────────────────

async function actionStart(admin: SupabaseClient, userId: string, body: Record<string, unknown>) {
  const mode = String(body.mode || "");
  if (mode !== "evaluation" && mode !== "pills") throw new Error("Modo no soportado");

  const pillId = String(body.pillId || "").trim() || null;
  if (mode === "pills" && !pillId) throw new Error("Falta pillId");

  const candidateIds = Array.isArray(body.candidateIds)
    ? body.candidateIds.map((v) => String(v)).filter(Boolean)
    : [];
  if (!candidateIds.length) throw new Error("Sin preguntas candidatas");

  const limit = Math.min(Math.max(1, Number(body.limit || candidateIds.length)), MAX_QUESTIONS);

  // El cliente propone el universo (ya filtrado por seniority/especialidad, que es
  // lógica de producto suya); el servidor decide el orden y el recorte, y lo fija.
  const chosen = shuffle(candidateIds).slice(0, limit);

  const { data: rows, error } = isEval(mode)
    ? await admin.from("preguntas_evaluacion")
        .select("id, q, a, b, c, cat, tag, seniority").in("id", chosen)
    : await admin.from("pill_questions")
        .select("id, question, category, type").in("id", chosen).eq("pill_id", pillId);
  if (error) throw new Error(`banco: ${error.message}`);

  // Respetar el orden que fijó el servidor, no el que devolvió Postgres.
  const byId = new Map((rows || []).map((r) => [String(r.id), r]));
  const questions = chosen.map((id) => byId.get(id)).filter(Boolean);
  if (!questions.length) throw new Error("Ninguna pregunta válida");

  const { data: sesion, error: insErr } = await admin
    .from("quiz_sessions")
    .insert({ user_id: userId, mode, pill_id: pillId, question_ids: questions.map((q) => q!.id) })
    .select("id").single();
  if (insErr) throw new Error(`quiz_sessions insert: ${insErr.message}`);

  // `questions` no lleva `correcta`/`correct_answer` ni la explicación: es
  // literalmente lo único que el navegador va a conocer de cada pregunta.
  return { sessionId: sesion.id, questions };
}

async function actionAnswer(admin: SupabaseClient, userId: string, body: Record<string, unknown>) {
  const sessionId = String(body.sessionId || "");
  const questionId = String(body.questionId || "");
  if (!sessionId || !questionId) throw new Error("Faltan sessionId o questionId");

  const sesion = await loadSession(admin, sessionId, userId);
  if (sesion.finished_at) throw new Error("Esa sesión ya terminó");
  if (!(sesion.question_ids || []).map(String).includes(questionId)) {
    throw new Error("Esa pregunta no es de esta sesión");
  }

  const answers = (sesion.answers || {}) as Record<string, { a: unknown; ok: boolean }>;
  const previa = answers[questionId];

  // Cargar la verdad. Se hace siempre porque también hace falta para devolver la
  // explicación cuando la respuesta ya estaba registrada.
  const { data: row, error } = isEval(sesion.mode)
    ? await admin.from("preguntas_evaluacion")
        .select("id, a, b, c, correcta, expl, tag").eq("id", questionId).maybeSingle()
    : await admin.from("pill_questions")
        .select("id, correct_answer, explanation").eq("id", questionId).maybeSingle();
  if (error) throw new Error(`banco: ${error.message}`);
  if (!row) throw new Error("Pregunta no encontrada");

  let ok: boolean;
  let correctText: string;
  let explanation: string;
  let studyTag = "";

  if (isEval(sesion.mode)) {
    const correcta = norm(row.correcta);
    correctText = String((correcta === "A" ? row.a : correcta === "B" ? row.b : row.c) || "");
    explanation = String(row.expl || "");
    studyTag = String(row.tag || "");
    ok = norm(body.answer) === correcta;
  } else {
    const esperado = Boolean(row.correct_answer);
    correctText = esperado ? "Verdadero" : "Falso";
    explanation = String(row.explanation || "");
    ok = (typeof body.answer === "boolean"
      ? body.answer
      : ["V", "TRUE", "VERDADERO"].includes(norm(body.answer))) === esperado;
  }

  // El registro es de una sola vez. Si ya había respuesta se devuelve el veredicto
  // guardado y no se toca nada: por eso repetir la llamada no sirve para sondear
  // cuál era la correcta — para cuando la sabes, tu respuesta ya está sellada.
  if (previa) {
    return {
      correct: Boolean(previa.ok), correctText, explanation, studyTag, alreadyAnswered: true,
    };
  }

  answers[questionId] = { a: body.answer ?? null, ok };
  const { error: updErr } = await admin
    .from("quiz_sessions").update({ answers }).eq("id", sessionId);
  if (updErr) throw new Error(`quiz_sessions update: ${updErr.message}`);

  return { correct: ok, correctText, explanation, studyTag, alreadyAnswered: false };
}

async function actionFinish(admin: SupabaseClient, userId: string, body: Record<string, unknown>) {
  const sessionId = String(body.sessionId || "");
  if (!sessionId) throw new Error("Falta sessionId");
  const timeSeconds = Math.max(0, Number(body.timeSeconds || 0));

  const sesion = await loadSession(admin, sessionId, userId);
  const mode = String(sesion.mode);
  const pillId = sesion.pill_id ? String(sesion.pill_id) : "";

  // Calificar desde lo que guardó el servidor. Nada de lo que mande el cliente en
  // esta llamada influye en el puntaje.
  const answers = (sesion.answers || {}) as Record<string, { a: unknown; ok: boolean }>;
  const questionIds = (sesion.question_ids || []).map(String);
  const total = questionIds.length;
  const score = questionIds.filter((id) => answers[id]?.ok === true).length;
  const falladas = questionIds.filter((id) => answers[id] && answers[id].ok !== true);

  // Reentrada (doble clic, reintento de red): no se vuelve a persistir.
  if (sesion.finished_at) {
    return { score: Number(sesion.score ?? score), total, persisted: false, sealGranted: false, errors: [] };
  }

  // Detalle de los errores para la pantalla de resultados.
  let errors: Array<Record<string, string>> = [];
  if (falladas.length) {
    const { data: rows } = isEval(mode)
      ? await admin.from("preguntas_evaluacion")
          .select("id, q, a, b, c, correcta, expl, tag").in("id", falladas)
      : await admin.from("pill_questions")
          .select("id, question, correct_answer, explanation").in("id", falladas);
    errors = (rows || []).map((r) => {
      if (isEval(mode)) {
        const c = norm(r.correcta);
        return {
          id: String(r.id), question: String(r.q || ""),
          correct: String((c === "A" ? r.a : c === "B" ? r.b : r.c) || ""),
          explanation: String(r.expl || ""), studyTag: String(r.tag || ""),
        };
      }
      return {
        id: String(r.id), question: String(r.question || ""),
        correct: r.correct_answer ? "Verdadero" : "Falso",
        explanation: String(r.explanation || ""), studyTag: "",
      };
    });
  }

  // ── Persistencia: mismas reglas de negocio que `submit-quiz` ───────────────
  const [{ data: rankingRow }, { data: scoresRow }] = await Promise.all([
    admin.from("ranking_user").select("nombre, email").eq("user_id", userId).maybeSingle(),
    admin.from("user_scores")
      .select("tests_points_q2, pills_points, pills_rank_pill_id").eq("user_id", userId).maybeSingle(),
  ]);
  const existing = scoresRow || {};
  const scoresMerge: Record<string, unknown> = { user_id: userId, fecha: new Date().toISOString() };
  let persisted = false;
  let sealGranted = false;

  if (isEval(mode)) {
    // Un solo intento: sólo cuenta si nunca se registró uno.
    if (existing.tests_points_q2 == null) {
      scoresMerge.tests_points_q2 = score;
      scoresMerge.puntos = score;
      scoresMerge.tiempo = timeSeconds;
      persisted = true;
    }
  } else {
    const [{ data: pill }, { data: latestRows }, { data: prevAttempt }] = await Promise.all([
      admin.from("pills").select("id, published_at").eq("id", pillId).maybeSingle(),
      admin.from("pills").select("id").order("published_at", { ascending: false }).limit(1),
      admin.from("user_pill_scores").select("pill_id")
        .eq("user_id", userId).eq("pill_id", pillId).maybeSingle(),
    ]);

    const isLatestPill = String(latestRows?.[0]?.id || "") === pillId;
    const isFirstAttempt = !prevAttempt;
    const qualifies = score > 0;
    const rankingLocked =
      isLatestPill && Number(existing.pills_points || 0) > 0 &&
      String(existing.pills_rank_pill_id || "") === pillId;

    if (isLatestPill && !rankingLocked && qualifies && isFirstAttempt) {
      scoresMerge.pills_points = score;
      scoresMerge.pills_rank_pill_id = pillId;
      scoresMerge.pills_rank_tiempo = timeSeconds;
      persisted = true;
    }

    if (isFirstAttempt && qualifies) {
      // Ventana de 7 días evaluada con el reloj del servidor, no el del navegador.
      const publishedAtMs = pill?.published_at ? Date.parse(String(pill.published_at)) : 0;
      const dentroDeVentana =
        !publishedAtMs || Date.now() <= publishedAtMs + PILLS_SEAL_WINDOW_HOURS * 3600 * 1000;
      const errCount = Math.max(total - score, 0);
      sealGranted = total > 0 && errCount <= 1 && dentroDeVentana;

      const { error: pillErr } = await admin.from("user_pill_scores").upsert({
        user_id: userId, pill_id: pillId, score, total,
        errors: errCount, sticker_granted: sealGranted,
      }, { onConflict: "user_id,pill_id" });
      if (pillErr) throw new Error(`user_pill_scores: ${pillErr.message}`);
    }
  }

  if (persisted) {
    const { error: scoreErr } = await admin
      .from("user_scores").upsert(scoresMerge, { onConflict: "user_id" });
    if (scoreErr) throw new Error(`user_scores: ${scoreErr.message}`);

    const { error: profErr } = await admin.from("user_profiles").upsert({
      id: userId,
      [isEval(mode) ? "tests_points" : "pills_points"]: score,
      nombre: String(rankingRow?.nombre || "").trim(),
      email: String(rankingRow?.email || "").trim(),
    }, { onConflict: "id" });
    if (profErr) console.warn("[quiz-session] espejo user_profiles falló:", profErr.message);
  }

  // Cerrar la sesión al final: si algo de arriba revienta, sigue reintentable.
  await admin.from("quiz_sessions")
    .update({ finished_at: new Date().toISOString(), score }).eq("id", sessionId);

  return { score, total, persisted, sealGranted, errors };
}

// ── Router ───────────────────────────────────────────────────────────────────

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "Body inválido" });
  }

  try {
    const action = String(body.action || "");
    if (action === "start")  return json(200, { ok: true, ...(await actionStart(admin, user.id, body)) });
    if (action === "answer") return json(200, { ok: true, ...(await actionAnswer(admin, user.id, body)) });
    if (action === "finish") return json(200, { ok: true, ...(await actionFinish(admin, user.id, body)) });
    return json(400, { ok: false, error: "Acción desconocida" });
  } catch (e) {
    console.error("[quiz-session]", e);
    return json(400, { ok: false, error: (e as Error).message });
  }
});
