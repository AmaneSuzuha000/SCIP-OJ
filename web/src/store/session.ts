import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { Profile } from '@/lib/supabase';

export type AccessState = 'unknown' | 'checking' | 'granted' | 'denied';

interface SessionStore {
  session: Session | null;
  profile: Profile | null;
  access: AccessState;
  /** Non-null when the app cannot reach its backend at all (usually config). */
  bootError: string | null;
  setSession: (session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
  setAccess: (access: AccessState) => void;
  setBootError: (message: string | null) => void;
  reset: () => void;
}

export const useSession = create<SessionStore>((set) => ({
  session: null,
  profile: null,
  access: 'unknown',
  bootError: null,
  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile }),
  setAccess: (access) => set({ access }),
  setBootError: (bootError) => set({ bootError }),
  reset: () => set({ session: null, profile: null, access: 'unknown' }),
}));
