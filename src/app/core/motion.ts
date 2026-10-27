/**
 * True solo la primera vez por sesion para esa clave, para que las animaciones
 * de entrada no cansen al ir y venir entre paginas.
 */
export function firstVisit(key: string): boolean {
  try {
    const k = `intro.${key}`;
    if (sessionStorage.getItem(k)) return false;
    sessionStorage.setItem(k, '1');
  } catch {
    // Sin almacenamiento: se anima siempre.
  }
  return true;
}
