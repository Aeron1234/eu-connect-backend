import { createStorageFetch } from "./storageFetch.js";
import { createClient } from "@supabase/supabase-js";

// Server-side storage client using private environment configuration and a bounded fetch.
// Controllers must authorize files before using it; never expose this key to the frontend.
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { global: { fetch: createStorageFetch() } },
);
