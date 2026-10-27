import { Injectable, computed, signal } from '@angular/core';
import { Session } from '@supabase/supabase-js';

import { isSupabaseConfigured } from '../../environments/environment';
import { supabase } from './supabase';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly session = signal<Session | null>(null);
  readonly user = computed(() => this.session()?.user ?? null);
  readonly displayName = computed(() => {
    const u = this.user();
    return (u?.user_metadata?.['full_name'] as string | undefined) || u?.email || '';
  });

  /** Se resuelve cuando ya se sabe si hay sesion guardada. */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = isSupabaseConfigured()
      ? supabase.auth.getSession().then(({ data }) => this.session.set(data.session))
      : Promise.resolve();

    supabase.auth.onAuthStateChange((_event, session) => this.session.set(session));
  }

  async signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  /** Devuelve true si la cuenta queda lista; false si falta confirmar el correo. */
  async signUp(fullName: string, email: string, password: string): Promise<boolean> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName }, emailRedirectTo: location.origin },
    });
    if (error) throw error;
    return !!data.session;
  }

  /** Envia el correo de recuperacion. El enlace vuelve a /restablecer con una sesion temporal. */
  async resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/restablecer`,
    });
    if (error) throw error;
  }

  /** Cambia la contrasena del usuario con sesion (la del enlace de recuperacion). */
  async updatePassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  }

  async signOut() {
    await supabase.auth.signOut();
  }
}
