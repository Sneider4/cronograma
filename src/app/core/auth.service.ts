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
  /** Clave del avatar (copia en los metadatos de la sesion para no consultar la tabla). */
  readonly avatar = computed(() => (this.user()?.user_metadata?.['avatar'] as string | undefined) ?? '');

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

  /**
   * Nombre y avatar. Se guardan en la tabla profiles (la que ve el equipo)
   * y en los metadatos de la sesion (los que lee la barra superior).
   */
  async updateProfile(fullName: string, avatar: string) {
    const id = this.user()?.id;
    if (!id) throw new Error('SIN_SESION');
    const { error } = await supabase.from('profiles').update({ full_name: fullName, avatar }).eq('id', id);
    if (error) throw error;
    const { error: e2 } = await supabase.auth.updateUser({ data: { full_name: fullName, avatar } });
    if (e2) throw e2;
  }

  /** Pide la contrasena actual antes de cambiarla, por si alguien usa la sesion abierta. */
  async changePassword(current: string, next: string) {
    const email = this.user()?.email;
    if (!email) throw new Error('SIN_SESION');
    const { error } = await supabase.auth.signInWithPassword({ email, password: current });
    if (error) throw new Error('CONTRASENA_ACTUAL');
    await this.updatePassword(next);
  }

  async signOut() {
    await supabase.auth.signOut();
  }
}
