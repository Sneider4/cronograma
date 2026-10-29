/** Avatares disponibles. Los SVG viven en public/avatars/<key>.svg. */
export const AVATARS = [
  { key: 'zorro', label: 'Zorro' },
  { key: 'gato', label: 'Gato' },
  { key: 'oso', label: 'Oso' },
  { key: 'buho', label: 'Búho' },
  { key: 'panda', label: 'Panda' },
  { key: 'conejo', label: 'Conejo' },
  { key: 'pinguino', label: 'Pingüino' },
  { key: 'perro', label: 'Perro' },
  { key: 'raton', label: 'Ratón' },
  { key: 'mapache', label: 'Mapache' },
  { key: 'koala', label: 'Koala' },
  { key: 'leon', label: 'León' },
] as const;

const KEYS = new Set<string>(AVATARS.map((a) => a.key));

/** Ruta del avatar, o null si la clave no existe (se muestran iniciales). */
export function avatarUrl(key: string | null | undefined): string | null {
  return key && KEYS.has(key) ? `/avatars/${key}.svg` : null;
}

export function initialsOf(name: string | null | undefined): string {
  return (
    (name ?? '')
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  );
}
