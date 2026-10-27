/**
 * Credenciales de Supabase.
 *
 * La anon (publishable) key es publica por diseno: viaja en el bundle del
 * navegador y quien protege los datos es RLS. NUNCA pongas aqui la
 * service_role key.
 *
 * Donde sacarlas: Supabase -> tu proyecto -> Project Settings -> API
 */
export const environment = {
  supabaseUrl: 'https://tzwxuhxavuvylodjcirg.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6d3h1aHhhdnV2eWxvZGpjaXJnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwMjcyNzUsImV4cCI6MjEwODYwMzI3NX0.eI58-kiriiWZyjQ-Bs0PxRz4zGz1gfiLVbiAEe5iFEE',
};

export const isSupabaseConfigured = () =>
  !environment.supabaseUrl.startsWith('PEGA_AQUI') &&
  !environment.supabaseAnonKey.startsWith('PEGA_AQUI');
