import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './constants.js';

export let supabase = null;

/** Crea el cliente una sola vez. Llamar desde app.js antes de cargar la lógica principal. */
export function initSupabaseClient() {
    if (supabase) return;
    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (_) {
        /* Error silencioso en producción */
    }
}

/** Ejecutar al cargar el módulo para que app-main.js reciba cliente ya inicializado. */
initSupabaseClient();
