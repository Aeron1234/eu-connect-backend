import { createStorageFetch } from "./storageFetch.js";
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { global: { fetch: createStorageFetch() } },
);
