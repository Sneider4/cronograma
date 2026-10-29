import { Component, HostListener, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../core/auth.service';
import { AVATARS } from '../core/avatars';
import { friendlyError } from '../core/supabase';
import { ToastService } from '../core/toast.service';
import { Avatar } from './avatar';
import { Icon } from './icon';

/** Mi perfil: avatar, nombre y contrasena. */
@Component({
  selector: 'app-profile-dialog',
  imports: [FormsModule, Avatar, Icon],
  template: `
    <div class="backdrop" (mousedown)="closed.emit()">
      <div class="dialog" (mousedown)="$event.stopPropagation()">
        <header>
          <h3>Mi perfil</h3>
          <button type="button" class="btn ghost icon" (click)="closed.emit()" aria-label="Cerrar"><app-icon name="x" /></button>
        </header>

        <div class="body">
          <div class="me">
            <app-avatar [avatar]="avatar()" [name]="name || auth.displayName()" [size]="56" />
            <div class="who">
              <b>{{ name.trim() || auth.displayName() }}</b>
              <span class="small faint">{{ auth.user()?.email }}</span>
            </div>
          </div>

          <form class="section" (ngSubmit)="saveProfile()">
            <span class="label">Elige tu avatar</span>
            <div class="avatars" role="radiogroup" aria-label="Avatar">
              @for (a of avatars; track a.key) {
                <button type="button" class="pick" role="radio" [class.on]="avatar() === a.key"
                        [attr.aria-checked]="avatar() === a.key" [title]="a.label" [attr.aria-label]="a.label"
                        (click)="avatar.set(a.key)">
                  <img [src]="'/avatars/' + a.key + '.svg'" alt="" width="56" height="56" />
                </button>
              }
            </div>

            <div class="field">
              <label for="p-name">Nombre</label>
              <input id="p-name" class="input" name="name" [(ngModel)]="name" maxlength="80" required autocomplete="name" />
              <span class="hint">Así te ve tu equipo en los proyectos y en las actividades que tienes a cargo.</span>
            </div>
            <div>
              <button type="submit" class="btn primary" [disabled]="busy() || !name.trim()">
                {{ busy() ? 'Guardando…' : 'Guardar perfil' }}
              </button>
            </div>
          </form>

          <form class="section" (ngSubmit)="savePassword()">
            <span class="label">Cambiar contraseña</span>
            <div class="field">
              <label for="p-cur">Contraseña actual</label>
              <input id="p-cur" class="input" [type]="show() ? 'text' : 'password'" name="cur" [(ngModel)]="current"
                     autocomplete="current-password" required />
            </div>
            <div class="grid-2">
              <div class="field">
                <label for="p-new">Nueva contraseña</label>
                <input id="p-new" class="input" [type]="show() ? 'text' : 'password'" name="new" [(ngModel)]="next"
                       minlength="6" autocomplete="new-password" required />
              </div>
              <div class="field">
                <label for="p-rep">Repítela</label>
                <input id="p-rep" class="input" [type]="show() ? 'text' : 'password'" name="rep" [(ngModel)]="repeat"
                       minlength="6" autocomplete="new-password" required />
              </div>
            </div>
            <label class="check small">
              <input type="checkbox" [checked]="show()" (change)="show.set(!show())" /> Mostrar contraseñas
            </label>
            @if (pwError()) {
              <span class="error">{{ pwError() }}</span>
            }
            <div>
              <button type="submit" class="btn" [disabled]="pwBusy() || !current || !next || !repeat">
                {{ pwBusy() ? 'Cambiando…' : 'Cambiar contraseña' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `,
  styles: `
    .me { display: flex; align-items: center; gap: 14px; }
    .who { display: flex; flex-direction: column; min-width: 0; b { font-size: 17px; letter-spacing: -0.02em; } }
    .section {
      display: flex; flex-direction: column; gap: 14px;
      padding-top: 18px; border-top: 1px solid var(--border);
    }
    .label { font-size: 15px; font-weight: 600; letter-spacing: -0.02em; }
    .avatars { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
    .pick {
      padding: 0; border: 0; background: none; cursor: pointer; border-radius: 50%;
      aspect-ratio: 1; transition: transform 0.15s;
      img { width: 100%; height: 100%; display: block; border-radius: 50%; }
      &:hover { transform: translateY(-2px); }
      &.on { outline: 3px solid var(--text); outline-offset: 3px; }
      &:focus-visible { outline: 3px solid var(--copper); outline-offset: 3px; }
    }
    .error { font-size: 12.5px; color: var(--danger); }
    .check { display: inline-flex; align-items: center; gap: 8px; color: var(--text-2); cursor: pointer; }
    .check input { accent-color: var(--text); }
    @media (max-width: 560px) {
      .avatars { grid-template-columns: repeat(4, 1fr); gap: 12px; }
      .grid-2 { grid-template-columns: 1fr; }
    }
  `,
})
export class ProfileDialog {
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly closed = output<void>();

  protected readonly avatars = AVATARS;
  protected readonly avatar = signal(this.auth.avatar());
  protected name = this.auth.user()?.user_metadata?.['full_name'] ?? '';

  protected readonly busy = signal(false);
  protected readonly pwBusy = signal(false);
  protected readonly pwError = signal('');
  protected readonly show = signal(false);
  protected current = '';
  protected next = '';
  protected repeat = '';

  @HostListener('document:keydown.escape')
  onEsc() {
    this.closed.emit();
  }

  protected async saveProfile() {
    const name = this.name.trim();
    if (!name) return;
    this.busy.set(true);
    try {
      await this.auth.updateProfile(name, this.avatar());
      this.toast.show('Perfil actualizado');
    } catch (e) {
      this.toast.error(friendlyError(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async savePassword() {
    this.pwError.set('');
    if (this.next.length < 6) return this.pwError.set('La nueva contraseña debe tener al menos 6 caracteres.');
    if (this.next !== this.repeat) return this.pwError.set('Las contraseñas nuevas no coinciden.');
    if (this.next === this.current) return this.pwError.set('La nueva contraseña debe ser distinta de la actual.');
    this.pwBusy.set(true);
    try {
      await this.auth.changePassword(this.current, this.next);
      this.current = this.next = this.repeat = '';
      this.toast.show('Contraseña cambiada');
    } catch (e) {
      this.pwError.set(friendlyError(e));
    } finally {
      this.pwBusy.set(false);
    }
  }
}
