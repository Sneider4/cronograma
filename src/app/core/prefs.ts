/** Preferencias de vista por navegador (zoom, vista elegida). Nunca datos. */
export function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem('cronograma.' + key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: string) {
  try {
    localStorage.setItem('cronograma.' + key, value);
  } catch {
    /* modo privado o almacenamiento bloqueado: se ignora */
  }
}
