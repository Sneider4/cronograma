import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { environment, isSupabaseConfigured } from '../../environments/environment';

/**
 * Cliente unico. Con credenciales sin configurar createClient lanzaria al
 * cargar el modulo y la app no alcanzaria a mostrar el aviso.
 */
// La URL va sin ruta: si se pega la del endpoint REST (/rest/v1/), el cliente
// la duplica y todo responde 404.
const baseUrl = environment.supabaseUrl.replace(/\/(rest|auth)\/v1\/?$/, '').replace(/\/+$/, '');

export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured() ? baseUrl : 'https://placeholder.supabase.co',
  isSupabaseConfigured() ? environment.supabaseAnonKey : 'placeholder-anon-key',
);

/** Los errores de las funciones de Postgres llegan como texto crudo. */
const KNOWN_ERRORS: Record<string, string> = {
  SIN_SESION: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  CODIGO_INVALIDO: 'Ese código de invitación no existe.',
  SOLO_DUENO: 'Solo el dueño del proyecto puede hacer eso.',
  ULTIMO_DUENO: 'Eres el único dueño: asigna otro dueño o elimina el proyecto.',
  NO_ERES_MIEMBRO: 'No perteneces a este proyecto.',
  'Invalid login credentials': 'Correo o contraseña incorrectos.',
  'User already registered': 'Ya existe una cuenta con ese correo.',
  'Email not confirmed': 'Confirma tu correo antes de entrar (revisa tu bandeja).',
  'New password should be different': 'La nueva contraseña debe ser distinta de la anterior.',
  'For security purposes': 'Por seguridad, espera unos segundos antes de pedir otro enlace.',
  'rate limit': 'Se alcanzó el límite de correos por hora. Intenta de nuevo más tarde.',
  'Auth session missing': 'El enlace venció o ya se usó. Pide uno nuevo.',
};

export function friendlyError(err: unknown): string {
  const msg =
    typeof err === 'string'
      ? err
      : ((err as { message?: string } | null)?.message ?? 'Error desconocido');
  for (const [key, text] of Object.entries(KNOWN_ERRORS)) {
    if (msg.includes(key)) return text;
  }
  if (msg.includes('objectives_code')) return 'Ya existe un objetivo con ese código.';
  if (msg.includes('Password should be')) return 'La contraseña debe tener al menos 6 caracteres.';
  return msg;
}
