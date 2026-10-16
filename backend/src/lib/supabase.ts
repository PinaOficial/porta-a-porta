import { createClient, type SupabaseClientOptions } from "@supabase/supabase-js";
import WebSocket from "ws";
import { env } from "../config/env.js";

type TransporteSupabase = NonNullable<SupabaseClientOptions<"public">["realtime"]>["transport"];

// Cliente de servidor. Nunca envie SUPABASE_SECRET_KEY ao frontend.
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  {
    // A versão instalada do SDK inicializa Realtime mesmo quando usamos só Storage.
    // Node 20 precisa de transporte explícito; isto não abre uma conexão Realtime.
    // Os tipos de eventos de ws e os tipos DOM do SDK divergem, embora a API seja compatível.
    realtime: { transport: WebSocket as unknown as TransporteSupabase },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);
