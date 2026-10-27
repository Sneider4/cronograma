import { DestroyRef, Directive, ElementRef, effect, inject, input } from '@angular/core';

/** El usuario pidio menos movimiento en su sistema. */
export function reducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * True solo la primera vez por sesion para esa clave, para que las animaciones
 * de entrada no cansen al ir y venir entre paginas.
 */
export function firstVisit(key: string): boolean {
  if (reducedMotion()) return false;
  try {
    const k = `intro.${key}`;
    if (sessionStorage.getItem(k)) return false;
    sessionStorage.setItem(k, '1');
  } catch {
    // Sin almacenamiento: se anima siempre.
  }
  return true;
}

const COUNT_MS = 900;
/** Ventana tras crearse en la que un cambio de valor todavia se anima (datos que llegan tarde). */
const WINDOW_MS = 2500;

/**
 * Numero que cuenta desde 0 hasta su valor. El elemento debe ir vacio:
 * `<span [countUp]="total" [countUpAnimate]="intro"></span>`.
 * Pasada la entrada, los cambios (p. ej. en tiempo real) se pintan directo.
 */
@Directive({ selector: '[countUp]' })
export class CountUp {
  readonly countUp = input.required<number>();
  readonly countUpAnimate = input(true);

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly born = performance.now();
  private shown = 0;
  private raf = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.raf));
    effect(() => {
      const to = Math.round(this.countUp() ?? 0);
      const animate = this.countUpAnimate() && !reducedMotion() && performance.now() - this.born < WINDOW_MS;
      cancelAnimationFrame(this.raf);
      if (!animate || to === this.shown) return this.paint(to);

      const from = this.shown;
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / COUNT_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        this.paint(Math.round(from + (to - from) * eased));
        if (t < 1) this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    });
  }

  private paint(n: number) {
    this.shown = n;
    this.el.textContent = String(n);
  }
}
