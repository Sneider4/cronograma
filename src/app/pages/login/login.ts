import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { Icon, IconName } from '../../components/icon';
import { AuthService } from '../../core/auth.service';
import { friendlyError } from '../../core/supabase';

/** Diapositivas del widget del panel (rotan solas). */
const SLIDES: { icon: IconName; title: string; tone: string }[] = [
  { icon: 'gantt', title: 'Gantt en', tone: 'tiempo real.' },
  { icon: 'calendar', title: 'Calendario', tone: 'compartido.' },
  { icon: 'kanban', title: 'Kanban por', tone: 'estados.' },
  { icon: 'sheet', title: 'Excel de ida', tone: 'y vuelta.' },
];
const SLIDE_MS = 3200;

type Mode = 'in' | 'up' | 'forgot';

@Component({
  selector: 'app-login',
  imports: [FormsModule, Icon],
  template: `
    <main class="split motion">
      <section class="side-form">
        <div class="brand">
          <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
            <rect width="20" height="20" rx="6" fill="currentColor" />
            <path class="draw" pathLength="1" d="M5 6.5h6M7.5 10h7M10 13.5h5" stroke="var(--surface)" stroke-width="2" stroke-linecap="round" />
          </svg>
          <span>Cronograma</span>
        </div>

        <form class="form" (ngSubmit)="submit()">
          <header>
            <span class="tag">{{ mode() === 'in' ? 'Acceso' : mode() === 'up' ? 'Registro' : 'Recuperación' }}</span>
            @switch (mode()) {
              @case ('in') {
                <h1>
                  <span class="rv"><span style="--i: 0">Bienvenido</span></span>&ngsp;
                  <span class="tone reveal-loop"><span class="rv"><span style="--i: 2">de</span></span>&ngsp;<span class="rv"><span style="--i: 3">nuevo</span></span></span>
                </h1>
                <p>Ingresa tus datos para continuar con tu equipo.</p>
              }
              @case ('up') {
                <h1>
                  <span class="rv"><span style="--i: 0">Crea</span></span>&ngsp;<span class="rv"><span style="--i: 1">tu</span></span>&ngsp;
                  <span class="tone reveal-loop"><span class="rv"><span style="--i: 3">cuenta</span></span></span>
                </h1>
                <p>Empieza a planear tus proyectos en minutos.</p>
              }
              @case ('forgot') {
                <h1>
                  <span class="rv"><span style="--i: 0">Recupera</span></span>&ngsp;<span class="rv"><span style="--i: 1">tu</span></span>&ngsp;
                  <span class="tone reveal-loop"><span class="rv"><span style="--i: 3">contraseña</span></span></span>
                </h1>
                <p>Escribe tu correo y te enviaremos un enlace para crear una nueva.</p>
              }
            }
          </header>

          @if (mode() === 'up') {
            <div class="fld">
              <label for="name">Nombre completo</label>
              <input id="name" name="name" [(ngModel)]="name" required autocomplete="name" placeholder="Tu nombre" />
            </div>
          }
          <div class="fld">
            <label for="email">Correo electrónico</label>
            <input id="email" type="email" name="email" [(ngModel)]="email" required autocomplete="email" placeholder="nombre@correo.com" />
          </div>
          @if (mode() !== 'forgot') {
          <div class="fld">
            <div class="lbl-row">
              <label for="pass">Contraseña</label>
              @if (mode() === 'in') {
                <button type="button" class="forgot" (click)="switchMode('forgot')">¿La olvidaste?</button>
              }
            </div>
            <div class="pass">
              <input
                id="pass"
                [type]="showPass() ? 'text' : 'password'"
                name="password"
                [(ngModel)]="password"
                required
                minlength="6"
                placeholder="••••••••"
                [autocomplete]="mode() === 'in' ? 'current-password' : 'new-password'"
              />
              <button type="button" class="eye" (click)="showPass.set(!showPass())"
                      [attr.aria-label]="showPass() ? 'Ocultar contraseña' : 'Mostrar contraseña'">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
                  <circle cx="12" cy="12" r="3" />
                  @if (showPass()) {
                    <path d="M4 4l16 16" />
                  }
                </svg>
              </button>
            </div>
            @if (mode() === 'up') {
              <span class="hint">Mínimo 6 caracteres.</span>
            }
          </div>
          }

          @if (message()) {
            <div class="msg" [class.error]="isError()">{{ message() }}</div>
          }

          <button class="submit" type="submit" [disabled]="busy()">
            <span>{{ busy() ? 'Un momento…' : mode() === 'in' ? 'Entrar' : mode() === 'up' ? 'Crear cuenta' : 'Enviar enlace' }}</span>
            <span class="go">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </button>

          <p class="switch">
            @if (mode() === 'in') {
              ¿No tienes cuenta? <button type="button" (click)="switchMode('up')">Regístrate</button>
            } @else if (mode() === 'up') {
              ¿Ya tienes cuenta? <button type="button" (click)="switchMode('in')">Inicia sesión</button>
            } @else {
              ¿La recordaste? <button type="button" (click)="switchMode('in')">Volver a entrar</button>
            }
          </p>
        </form>

        <footer>
          © {{ year }} Cronograma · <a class="credit" href="https://github.com/Sneider4" target="_blank" rel="noopener">por Richard Malagón</a>
        </footer>
      </section>

      <section class="side-art" aria-hidden="true">
        <div class="top">
          <span class="lbl">Gestión de proyectos en equipo</span>
          <span class="m-brand">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <rect width="20" height="20" rx="6" fill="currentColor" />
              <path class="draw" pathLength="1" d="M5 6.5h6M7.5 10h7M10 13.5h5" stroke="#e6e8ec" stroke-width="2" stroke-linecap="round" />
            </svg>
            Cronograma
          </span>

          <!-- Widget que rota entre las vistas, como la tarjeta "Design to explore" -->
          <div class="widget">
            <div class="tile">
              @for (s of slides; track s.icon; let i = $index) {
                <app-icon [name]="s.icon" [size]="34" [class.on]="i === slide()" />
              }
            </div>
            <div class="info">
              <span class="n">0{{ slide() + 1 }}</span>
              @for (s of slides; track s.icon; let i = $index) {
                @if (i === slide()) {
                  <p class="t">{{ s.title }}<br />{{ s.tone }}</p>
                }
              }
              <div class="ctrl">
                <!-- Se recrea en cada diapositiva para reiniciar la animacion de la barra -->
                <span class="bar">
                  @for (k of [slide()]; track k) {
                    <i [style.animation-duration.ms]="slideMs"></i>
                  }
                </span>
                <span class="dots">
                  @for (s of slides; track s.icon; let i = $index) {
                    <b [class.on]="i === slide()"></b>
                  }
                </span>
              </div>
            </div>
          </div>
        </div>

        <h2 class="float" style="--d: 450ms">
          <span class="rv" style="--w: 0"><span style="--i: 0">Planea</span></span>&ngsp;<span class="rv" style="--w: 1"><span style="--i: 1">desde</span></span>&ngsp;<span class="rv" style="--w: 2"><span style="--i: 2">cero,</span></span><br />
          <span class="rv" style="--w: 3"><span style="--i: 3">entregando</span></span>&ngsp;<span class="rv" style="--w: 4"><span style="--i: 4">solo</span></span><br />
          <span class="tone"><span class="rv" style="--w: 5"><span style="--i: 6">lo</span></span>&ngsp;<span class="rv" style="--w: 6"><span style="--i: 7">que</span></span>&ngsp;<span class="rv" style="--w: 7"><span style="--i: 8">importa.</span></span></span>
        </h2>

        <div class="giant">
          @for (l of giant; track $index) {
            <span [style.--i]="$index">{{ l }}</span>
          }
        </div>
        <div class="strip">
          <span>• Tiempo real</span>
          <span>• Hecho para equipos</span>
          <span>• Excel incluido</span>
        </div>
      </section>
    </main>
  `,
  styles: `
    :host { display: block; }
    .split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
      min-height: 100vh;
      background: var(--surface);
    }

    /* ---------- Formulario ---------- */
    .side-form {
      display: flex;
      flex-direction: column;
      padding: 32px clamp(24px, 6vw, 72px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 22px;
      font-weight: 500;
      letter-spacing: -0.05em;
      .mark { width: 26px; height: 26px; color: var(--text); }
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: 18px;
      width: 100%;
      max-width: 400px;
      margin: auto;
      padding: 48px 0;
    }
    header {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 14px;
      margin-bottom: 6px;
      h1 { font-size: clamp(38px, 3.6vw, 48px); line-height: 1; letter-spacing: -0.055em; }
      p { margin: 0; color: var(--text-2); font-size: 15px; }
    }
    .fld {
      display: flex;
      flex-direction: column;
      gap: 7px;
      label { font-size: 13px; font-weight: 500; }
      .hint { font-size: 12px; color: var(--text-3); }
    }
    input {
      width: 100%;
      height: 50px;
      padding: 0 18px;
      border: 1px solid transparent;
      border-radius: 16px;
      background: var(--surface-3);
      color: var(--text);
      font: inherit;
      font-size: 15px;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
      &::placeholder { color: var(--text-3); }
      &:hover { border-color: var(--border-strong); }
      &:focus {
        outline: none;
        background: var(--surface);
        border-color: var(--copper);
        box-shadow: 0 0 0 4px var(--focus);
      }
    }
    .lbl-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .forgot {
      padding: 0; border: 0; background: none; color: var(--text-2);
      font: inherit; font-size: 13px; cursor: pointer;
      text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--border-strong);
      &:hover { color: var(--copper); text-decoration-color: currentColor; }
    }
    .pass {
      position: relative;
      input { padding-right: 52px; }
    }
    .eye {
      position: absolute;
      top: 50%;
      right: 8px;
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      transform: translateY(-50%);
      border: 0;
      border-radius: 50%;
      background: none;
      color: var(--text-3);
      cursor: pointer;
      &:hover { color: var(--text); background: var(--surface-2); }
    }
    .msg {
      padding: 12px 16px;
      border-radius: 16px;
      background: var(--surface-3);
      font-size: 13.5px;
      color: var(--text-2);
      &.error { background: var(--danger-soft); color: var(--danger); }
    }
    .submit {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 56px;
      margin-top: 6px;
      padding: 0 6px 0 24px;
      border: 0;
      border-radius: 999px;
      background: var(--accent);
      color: var(--on-accent);
      font: inherit;
      font-size: 15.5px;
      font-weight: 500;
      cursor: pointer;
      transition: transform 0.15s, background 0.2s;
      .go {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: var(--on-accent);
        color: var(--accent);
        transition: transform 0.25s, background 0.25s, color 0.25s;
      }
      &:hover:not(:disabled) .go {
        transform: rotate(-45deg);
        background: var(--copper-grad);
        color: #fff;
      }
      &:active:not(:disabled) { transform: scale(0.99); }
      &:disabled { opacity: 0.6; cursor: wait; }
      &:focus-visible { outline: none; box-shadow: 0 0 0 4px var(--focus); }
    }
    .switch {
      margin: 4px 0 0;
      font-size: 14px;
      color: var(--text-2);
      text-align: center;
      button {
        padding: 0;
        border: 0;
        background: none;
        color: var(--copper);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 3px;
        text-decoration-color: transparent;
        transition: text-decoration-color 0.15s;
        &:hover { text-decoration-color: currentColor; }
      }
    }
    footer { font-size: 12.5px; color: var(--text-3); }
    .credit { color: inherit; text-decoration: none; transition: color 0.15s; &:hover { color: var(--text-2); } }

    /* ---------- Panel ---------- */
    .side-art {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 34px;
      min-height: 640px;
      margin: 12px;
      padding: clamp(28px, 4vw, 52px);
      padding-bottom: 0;
      border-radius: 28px;
      overflow: hidden;
      background:
        radial-gradient(70% 55% at 70% 18%, rgba(255, 255, 255, 0.75), transparent 70%),
        linear-gradient(180deg, #e6e8ec 0%, #d5d8dd 100%);
      color: #0b0b0c;
    }
    .top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
    }
    .lbl {
      padding-left: 9px;
      border-left: 1.5px solid #0b0b0c;
      font-size: 13px;
      line-height: 1.1;
      animation: up 0.7s ease-out both;
    }

    .widget {
      display: flex;
      gap: 14px;
      width: min(310px, 52%);
      padding: 8px 14px 8px 8px;
      border-radius: 26px;
      background: rgba(120, 124, 133, 0.55);
      border: 1px solid rgba(255, 255, 255, 0.55);
      backdrop-filter: blur(10px);
      animation: up 0.8s ease-out 0.15s both;
    }
    .tile {
      position: relative;
      flex: none;
      display: grid;
      place-items: center;
      width: 116px;
      height: 116px;
      border-radius: 20px;
      background: #0b0b0c;
      color: #fff;
      app-icon {
        position: absolute;
        opacity: 0;
        transform: translateY(10px) scale(0.9);
        transition: opacity 0.45s, transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
        &.on { opacity: 1; transform: none; }
      }
    }
    .info {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
      padding-top: 6px;
      color: #fff;
      .n { font-size: 10.5px; opacity: 0.7; }
      .t {
        margin: 4px 0 0;
        font-size: 19px;
        font-weight: 500;
        line-height: 1.05;
        letter-spacing: -0.045em;
        animation: up 0.45s ease-out both;
      }
    }
    .ctrl {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: auto;
      padding-bottom: 6px;
    }
    .bar {
      flex: 1;
      height: 2px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.35);
      overflow: hidden;
      i {
        display: block;
        height: 100%;
        background: #fff;
        transform-origin: left;
        animation: fill linear both;
      }
    }
    .dots {
      display: flex;
      gap: 4px;
      b {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.45);
        transition: background 0.3s, width 0.3s;
        &.on { width: 16px; border-radius: 3px; background: #fff; }
      }
    }

    h2 {
      font-size: clamp(38px, 4.4vw, 64px);
      font-weight: 500;
      line-height: 0.98;
      letter-spacing: -0.06em;
      .tone { color: #8d9097; }
    }

    .pills {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      animation: up 0.8s ease-out 0.4s both;
    }
    .p {
      display: grid;
      place-items: center;
      height: clamp(62px, 6vw, 84px);
      margin-right: -10px;
      border-radius: 999px;
      font-size: clamp(18px, 1.9vw, 28px);
      font-weight: 500;
      letter-spacing: -0.05em;
      &.light { background: #f3f3f4; position: relative; z-index: 4; }
      &.copper {
        position: relative;
        z-index: 3;
        overflow: hidden;
        background: linear-gradient(120deg, #d98a4a 0%, #b45a23 55%, #6e3012 100%);
        &::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(100deg, transparent 30%, rgba(255, 255, 255, 0.35) 50%, transparent 70%);
          transform: translateX(-120%);
          animation: sheen 3.6s ease-in-out 1.2s infinite;
        }
      }
      &.ink {
        position: relative;
        z-index: 2;
        background: #0b0b0c;
        color: #fff;
        svg { animation: nudge 1.8s ease-in-out infinite; }
      }
      &.fade { background: #d0d3d9; color: #b3b6bd; margin-right: 0; }
    }
    .copper-ink { color: #ffc48e; position: relative; z-index: 1; }

    .giant {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 80px;
      text-align: center;
      font-size: clamp(54px, 7.4vw, 136px);
      font-weight: 600;
      line-height: 1;
      letter-spacing: -0.07em;
      white-space: nowrap;
      pointer-events: none;
      animation: rise-big 1.1s cubic-bezier(0.2, 0.8, 0.2, 1) 0.3s both;
      /* Cada letra lleva el mismo degradado de antes y sube y baja en ola, una tras otra */
      span {
        display: inline-block;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(11, 11, 12, 0.85) 75%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        animation: wave 5s ease-in-out calc(1.6s + var(--i) * 90ms) infinite both;
      }
    }
    .strip {
      position: absolute;
      left: 16px;
      right: 16px;
      bottom: 16px;
      display: flex;
      justify-content: space-between;
      padding: 12px 22px;
      border-radius: 999px;
      background: rgba(11, 11, 12, 0.62);
      border: 1px solid rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(12px);
      color: #fff;
      font-size: 12.5px;
      animation: up 0.8s ease-out 0.6s both;
    }

    @keyframes up { from { opacity: 0; transform: translateY(16px); } }
    @keyframes rise-big { from { opacity: 0; transform: translateY(40%); } }
    /* Ola: la letra sube un poco y vuelve; el resto del ciclo descansa */
    /* Logo: las tres barras se dibujan como un mini Gantt y se borran */
    @keyframes draw {
      0% { stroke-dashoffset: 1; }
      35%, 75% { stroke-dashoffset: 0; }
      100% { stroke-dashoffset: -1; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .draw { stroke-dasharray: 1; animation: draw 5s cubic-bezier(0.6, 0, 0.3, 1) 1s infinite both; }
    }
    @keyframes wave {
      0%, 22%, 100% { transform: none; }
      11% { transform: translateY(-9%); }
    }
    @keyframes fill { from { transform: scaleX(0); } }
    @keyframes sheen { 0% { transform: translateX(-120%); } 55%, 100% { transform: translateX(120%); } }
    @keyframes nudge { 0%, 100% { transform: translateX(-4px); } 50% { transform: translateX(6px); } }
    @media (prefers-reduced-motion: reduce) {
      .side-art *, .side-art *::after { animation: none !important; transition: none !important; }
    }

    .m-brand { display: none; }

    /* Movil/tablet: el panel pasa arriba en version compacta (marca, titular y pildoras) */
    @media (max-width: 900px) {
      .split { grid-template-columns: 1fr; grid-template-rows: auto 1fr; min-height: 100dvh; }
      .side-art {
        order: -1;
        min-height: 0;
        gap: 18px;
        margin: 10px 10px 0;
        padding: 20px 20px 22px;
        border-radius: 26px;
      }
      .top { align-items: center; }
      .lbl, .widget, .giant, .strip { display: none; }
      .m-brand {
        display: flex; align-items: center; gap: 8px;
        font-size: 19px; font-weight: 500; letter-spacing: -0.045em;
        svg { width: 22px; height: 22px; color: #0b0b0c; }
      }
      h2 { font-size: clamp(30px, 8.6vw, 44px); }
      .p { height: clamp(44px, 12vw, 60px); margin-right: -8px; font-size: clamp(14px, 3.9vw, 20px); }
      .p.ink svg { width: 34px; }

      .side-form { padding: 6px 22px 24px; }
      .side-form > .brand { display: none; }
      .form { padding: 22px 0 28px; margin: 0 auto; }
      header h1 { font-size: 36px; }
      footer { text-align: center; }
    }
  `,
})
export class LoginPage implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly slides = SLIDES;
  protected readonly giant = [...'CRONOGRAMA'];
  protected readonly slideMs = SLIDE_MS;
  protected readonly slide = signal(0);
  private timer: ReturnType<typeof setInterval> | undefined;
  protected readonly year = new Date().getFullYear();

  protected readonly mode = signal<Mode>('in');
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly isError = signal(false);
  protected readonly showPass = signal(false);

  protected name = '';
  protected email = '';
  protected password = '';

  ngOnInit() {
    // Viene de un enlace de recuperacion vencido: abre directo en "Recuperar".
    if (new URLSearchParams(location.search).get('modo') === 'recuperar') this.mode.set('forgot');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.timer = setInterval(() => this.slide.update((i) => (i + 1) % SLIDES.length), SLIDE_MS);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  async submit() {
    if (this.mode() === 'forgot') return this.sendReset();
    if (!this.email || !this.password || (this.mode() === 'up' && !this.name.trim())) {
      this.show('Completa todos los campos.', true);
      return;
    }
    this.busy.set(true);
    this.message.set('');
    try {
      if (this.mode() === 'in') {
        await this.auth.signIn(this.email.trim(), this.password);
        await this.router.navigateByUrl('/');
      } else {
        const ready = await this.auth.signUp(this.name.trim(), this.email.trim(), this.password);
        if (ready) await this.router.navigateByUrl('/');
        else {
          this.show('Cuenta creada. Revisa tu correo para confirmarla y luego entra.', false);
          this.mode.set('in');
        }
      }
    } catch (e) {
      this.show(friendlyError(e), true);
    } finally {
      this.busy.set(false);
    }
  }

  private async sendReset() {
    const email = this.email.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      this.show('Escribe el correo con el que creaste tu cuenta.', true);
      return;
    }
    this.busy.set(true);
    this.message.set('');
    try {
      await this.auth.resetPassword(email);
      // Mismo mensaje exista o no la cuenta, para no revelar que correos estan registrados.
      this.show(`Si hay una cuenta con ${email}, te llegará un enlace en unos minutos. Revisa también la carpeta de spam.`, false);
    } catch (e) {
      this.show(friendlyError(e), true);
    } finally {
      this.busy.set(false);
    }
  }

  protected switchMode(mode: Mode) {
    this.mode.set(mode);
    this.message.set('');
  }

  private show(text: string, error: boolean) {
    this.message.set(text);
    this.isError.set(error);
  }
}
