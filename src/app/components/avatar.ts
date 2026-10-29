import { Component, computed, input } from '@angular/core';

import { avatarUrl, initialsOf } from '../core/avatars';

/** Avatar redondo: el animal elegido o, si no hay, las iniciales. */
@Component({
  selector: 'app-avatar',
  template: `
    @if (url(); as src) {
      <img [src]="src" alt="" [width]="size()" [height]="size()" />
    } @else {
      <span class="ini" [class.ghost]="ghost()">{{ initials() }}</span>
    }
  `,
  host: {
    '[style.--s.px]': 'size()',
    '[attr.title]': 'name() || null',
    role: 'img',
    '[attr.aria-label]': 'name() || "Sin nombre"',
  },
  styles: `
    :host {
      display: inline-grid; flex: none; width: var(--s); height: var(--s);
      border-radius: 50%; overflow: hidden; vertical-align: middle;
    }
    img { width: 100%; height: 100%; display: block; }
    .ini {
      display: grid; place-items: center; width: 100%; height: 100%;
      background: var(--copper-grad); color: #fff;
      font-size: calc(var(--s) * 0.36); font-weight: 600; letter-spacing: -0.02em;
    }
    /* Otra persona (sin cuenta): gris para distinguirla del equipo. */
    .ghost { background: var(--surface-3); color: var(--text-2); }
  `,
})
export class Avatar {
  readonly avatar = input<string | null | undefined>('');
  readonly name = input<string | null | undefined>('');
  readonly size = input(32);
  /** true para responsables que no son del equipo. */
  readonly ghost = input(false);

  protected readonly url = computed(() => avatarUrl(this.avatar()));
  protected readonly initials = computed(() => initialsOf(this.name()));
}
