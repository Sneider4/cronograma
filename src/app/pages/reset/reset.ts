import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { friendlyError } from '../../core/supabase';
import { ToastService } from '../../core/toast.service';

type State = 'checking' | 'form' | 'invalid';

/**
 * Destino del enlace "restablecer contraseña". Supabase lee el token de la URL
 * al iniciar y deja una sesion temporal; con ella se cambia la contrasena.
 */
@Component({
  selector: 'app-reset',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="wrap">
      <a class="brand" routerLink="/entrar">
        <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
          <rect width="20" height="20" rx="6" fill="currentColor" />
          <path d="M5 6.5h6M7.5 10h7M10 13.5h5" stroke="var(--surface)" stroke-width="2" stroke-linecap="round" />
        </svg>
        <span>Cronograma</span>
      </a>

      <section class="card">
        @switch (state()) {
          @case ('checking') {
            <p class="muted">Verificando el enlace…</p>
          }

          @case ('invalid') {
            <span class="tag">Enlace vencido</span>
            <h1>Este enlace <span class="tone">ya no sirve</span></h1>
            <p class="muted">
              Los enlaces de recuperación vencen en una hora y solo se pueden usar una vez. Pide uno nuevo desde el inicio de sesión.
            </p>
            <a class="submit" routerLink="/entrar" [queryParams]="{ modo: 'recuperar' }">
              <span>Pedir otro enlace</span>
              <span class="go"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
            </a>
          }

          @case ('form') {
            <form (ngSubmit)="save()">
              <span class="tag">Nueva contraseña</span>
              <h1>Crea una contraseña <span class="tone">nueva</span></h1>
              <p class="muted">Para <b>{{ email() }}</b>. Al guardarla entrarás de una vez.</p>

              <div class="fld">
                <label for="p1">Nueva contraseña</label>
                <div class="pass">
                  <input id="p1" [type]="show() ? 'text' : 'password'" name="p1" [(ngModel)]="p1" minlength="6"
                         autocomplete="new-password" placeholder="Mínimo 6 caracteres" required autofocus />
                  <button type="button" class="eye" (click)="show.set(!show())" [attr.aria-label]="show() ? 'Ocultar' : 'Mostrar'">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
                      <circle cx="12" cy="12" r="3" />
                      @if (show()) {
                        <path d="M4 4l16 16" />
                      }
                    </svg>
                  </button>
                </div>
              </div>
              <div class="fld">
                <label for="p2">Repite la contraseña</label>
                <input id="p2" [type]="show() ? 'text' : 'password'" name="p2" [(ngModel)]="p2" autocomplete="new-password" required />
              </div>

              @if (error()) {
                <div class="msg error">{{ error() }}</div>
              }

              <button class="submit" type="submit" [disabled]="busy()">
                <span>{{ busy() ? 'Guardando…' : 'Guardar y entrar' }}</span>
                <span class="go"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              </button>
            </form>
          }
        }
      </section>
    </main>
  `,
  styles: `
    .wrap {
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px;
      min-height: 100dvh; padding: 24px 16px;
    }
    .brand {
      display: flex; align-items: center; gap: 10px; color: var(--text); text-decoration: none;
      font-size: 22px; font-weight: 500; letter-spacing: -0.05em;
      .mark { width: 26px; height: 26px; }
    }
    .card {
      width: 100%; max-width: 440px; padding: 30px 28px; border-radius: 28px;
      background: var(--surface); border: 1px solid var(--border);
    }
    form { display: flex; flex-direction: column; gap: 16px; }
    .tag { margin-bottom: 4px; }
    h1 { margin: 12px 0 8px; font-size: 36px; line-height: 1; letter-spacing: -0.055em; }
    form h1 { margin: 0; }
    p { margin: 0 0 20px; }
    form p { margin: 0 0 4px; }
    .fld { display: flex; flex-direction: column; gap: 7px; label { font-size: 13px; font-weight: 500; } }
    input {
      width: 100%; height: 50px; padding: 0 18px; border: 1px solid transparent; border-radius: 16px;
      background: var(--surface-3); color: var(--text); font: inherit; font-size: 16px;
      &:focus { outline: none; background: var(--surface); border-color: var(--copper); box-shadow: 0 0 0 4px var(--focus); }
    }
    .pass { position: relative; input { padding-right: 52px; } }
    .eye {
      position: absolute; top: 50%; right: 8px; display: grid; place-items: center; width: 36px; height: 36px;
      transform: translateY(-50%); border: 0; border-radius: 50%; background: none; color: var(--text-3); cursor: pointer;
    }
    .msg { padding: 12px 16px; border-radius: 16px; font-size: 13.5px; &.error { background: var(--danger-soft); color: var(--danger); } }
    .submit {
      display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 6px 0 24px;
      border: 0; border-radius: 999px; background: var(--accent); color: var(--on-accent);
      font: inherit; font-size: 15.5px; font-weight: 500; text-decoration: none; cursor: pointer;
      .go {
        display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%;
        background: var(--on-accent); color: var(--accent); transition: transform 0.25s;
      }
      &:hover .go { transform: rotate(-45deg); }
      &:disabled { opacity: 0.6; cursor: wait; }
    }
    @media (max-width: 480px) {
      .card { padding: 24px 20px; border-radius: 24px; }
      h1 { font-size: 32px; }
    }
  `,
})
export class ResetPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<State>('checking');
  protected readonly email = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly show = signal(false);
  protected p1 = '';
  protected p2 = '';

  async ngOnInit() {
    // Si el enlace vencio, Supabase devuelve el error en la URL (#error=...&error_code=otp_expired).
    const failed = /error(_code|_description)?=/.test(location.hash + location.search);
    await this.auth.ready;
    const user = this.auth.user();
    if (failed || !user) {
      this.state.set('invalid');
      return;
    }
    this.email.set(user.email ?? '');
    this.state.set('form');
    // Quita el token de la barra de direcciones.
    history.replaceState(null, '', '/restablecer');
  }

  protected async save() {
    this.error.set('');
    if (this.p1.length < 6) return this.error.set('La contraseña debe tener al menos 6 caracteres.');
    if (this.p1 !== this.p2) return this.error.set('Las dos contraseñas no coinciden.');
    this.busy.set(true);
    try {
      await this.auth.updatePassword(this.p1);
      this.toast.show('Contraseña actualizada');
      await this.router.navigateByUrl('/');
    } catch (e) {
      this.error.set(friendlyError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
