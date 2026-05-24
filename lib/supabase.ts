import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (__DEV__ && (!SUPABASE_URL || !SUPABASE_ANON_KEY)) {
  console.error(
    '[Blyve] Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env (same values as VITE_* for web).',
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Types (loose — matches vary by backend / migrations)
export interface Profile {
  id: string;
  email?: string;
  name?: string | null;
  display_name?: string | null;
  username?: string | null;
  age?: number | null;
  bio?: string | null;
  images?: string[];
  avatar_url?: string | null;
  is_premium?: boolean;
  is_boosted?: boolean;
  created_at?: string;
  updated_at?: string;
}
