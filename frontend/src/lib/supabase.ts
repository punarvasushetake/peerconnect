import { createClient, Session } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseProjectRef = (() => {
  try {
    return new URL(supabaseUrl).hostname.split('.')[0];
  } catch {
    return null;
  }
})();

const supabaseAuthStorageKey = supabaseProjectRef
  ? `sb-${supabaseProjectRef}-auth-token`
  : null;
let lastReachabilityCheck:
  | { reachable: boolean; checkedAt: number }
  | null = null;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
  },
});

type StoredAuthSession = {
  currentSession?: Pick<Session, 'expires_at'> | null;
  expires_at?: number;
};

export function clearStoredSupabaseSession() {
  if (typeof window === 'undefined') return;

  if (supabaseAuthStorageKey) {
    window.localStorage.removeItem(supabaseAuthStorageKey);
  }

  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith('sb-') && key.endsWith('-auth-token')) {
      window.localStorage.removeItem(key);
    }
  }
}

function readStoredSupabaseSession(): StoredAuthSession | null {
  if (typeof window === 'undefined' || !supabaseAuthStorageKey) return null;

  const rawSession = window.localStorage.getItem(supabaseAuthStorageKey);
  if (!rawSession) return null;

  try {
    return JSON.parse(rawSession) as StoredAuthSession;
  } catch {
    clearStoredSupabaseSession();
    return null;
  }
}

function clearExpiredStoredSession() {
  const storedSession = readStoredSupabaseSession();
  const expiresAt = storedSession?.currentSession?.expires_at ?? storedSession?.expires_at;

  if (!storedSession) return;

  if (!expiresAt || expiresAt <= Math.floor(Date.now() / 1000) + 30) {
    clearStoredSupabaseSession();
  }
}

export async function getCurrentSession(): Promise<Session | null> {
  clearExpiredStoredSession();

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session;
  } catch {
    clearStoredSupabaseSession();
    return null;
  }
}

export function getSupabaseConnectionError() {
  return new Error(
    'Cannot reach the configured Supabase project. Check NEXT_PUBLIC_SUPABASE_URL and your network connection, then restart the dev server.'
  );
}

export async function ensureSupabaseReachable() {
  const now = Date.now();
  if (lastReachabilityCheck && now - lastReachabilityCheck.checkedAt < 30000) {
    if (!lastReachabilityCheck.reachable) throw getSupabaseConnectionError();
    return;
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      cache: 'no-store',
      headers: {
        apikey: supabaseAnonKey,
      },
    });
    lastReachabilityCheck = { reachable: response.ok, checkedAt: now };
  } catch {
    lastReachabilityCheck = { reachable: false, checkedAt: now };
  }

  if (!lastReachabilityCheck.reachable) {
    throw getSupabaseConnectionError();
  }
}
