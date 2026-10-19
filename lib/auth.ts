import { useState, useEffect } from 'react';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';
import type { Session, User } from '@supabase/supabase-js';

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};

let globalSession: Session | null = null;
let globalUser: User | null = null;
// Start as loading: the app must not decide "signed out" until we have checked
// the persisted session, otherwise the login screen flashes on every launch.
let globalLoading = true;
let listeners: Set<() => void> = new Set();
let initialized = false;

function notify() {
  listeners.forEach((l) => l());
}

export function setAuth(session: Session | null) {
  globalSession = session;
  globalUser = session?.user ?? null;
  globalLoading = false;
  notify();
}

export function useAuth(): AuthState {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  return {
    session: globalSession,
    user: globalUser,
    loading: globalLoading,
  };
}

/**
 * Restores the persisted session on app start and keeps the in-memory state in
 * sync with Supabase (sign in, sign out, token refresh, deep-link verification).
 * Safe to call more than once — it only wires up once per app run.
 */
export async function initializeAuth() {
  if (initialized) return;
  initialized = true;

  // React to future auth changes (login, logout, token refresh, etc.).
  supabase.auth.onAuthStateChange((_event, session) => {
    setAuth(session);
  });

  // Restore the session saved on the device, if any.
  const { data } = await supabase.auth.getSession();
  setAuth(data.session);
}

export async function getCurrentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export type SignUpProfile = {
  full_name: string;
  role: 'student' | 'teacher';
};

export async function signUp(
  email: string,
  password: string,
  profile?: SignUpProfile
) {
  const redirectTo = Linking.createURL('/auth/callback');

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: redirectTo,
      // Stored on the auth user immediately, even before email confirmation,
      // so we can apply it once a real session exists (see syncProfileFromMetadata).
      data: profile ? { full_name: profile.full_name, role: profile.role } : undefined,
    },
  });

  if (!error && data.session) {
    setAuth(data.session);
    // If confirmation is off, a session exists right away — apply immediately.
    await syncProfileFromMetadata(data.session.user);
  }

  return { data, error };
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error && data.session) {
    setAuth(data.session);
    // Confirmation is on in this project, so this is where the role/name
    // chosen at signup actually gets applied for the first time.
    await syncProfileFromMetadata(data.session.user);
  }
  return { data, error };
}

// Applies the full_name/role chosen at signup (stored as auth user metadata)
// to the profiles row, but only once — it won't clobber a name/role the user
// has since edited on the Profile screen.
async function syncProfileFromMetadata(user: User) {
  const meta = user.user_metadata as { full_name?: string; role?: 'student' | 'teacher' } | null;
  if (!meta?.role && !meta?.full_name) return;

  const { data: existing } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!existing) return;

  // Only fill in what's still at the trigger's default/empty state.
  const updates: { full_name?: string; role?: 'student' | 'teacher' } = {};
  if (meta.full_name && !existing.full_name) updates.full_name = meta.full_name;
  if (meta.role && meta.role !== 'student' && existing.role === 'student') {
    updates.role = meta.role;
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from('profiles').update(updates).eq('id', user.id);
  }
}

export async function signOut() {
  setAuth(null);
  supabase.auth.signOut().catch(() => {});
  return { error: null };
}

/** Sends a password reset email that returns to the app's callback route. */
export async function resetPassword(email: string) {
  const redirectTo = Linking.createURL('/auth/callback');
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });
  return { data, error };
}
