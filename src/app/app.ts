import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { isSupabaseConfigured } from '../environments/environment';
import { ToastService } from './core/toast.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    @if (configured) {
      <router-outlet />
    } @else {
      <main class="setup">
        <div class="card">
          <h2>Falta conectar Supabase</h2>
          <ol>
            <li>Crea un proyecto en <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>.</li>
            <li>En <b>SQL Editor</b> pega y ejecuta <code>supabase/schema.sql</code>.</li>
            <li>
              Copia la URL y la <i>anon key</i> (Project Settings → API) en
              <code>src/environments/environment.ts</code>.
            </li>
          </ol>
        </div>
      </main>
    }

    <div class="toasts" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="t.kind" (click)="toast.dismiss(t.id)">{{ t.text }}</div>
      }
    </div>
  `,
  styles: `
    .setup {
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: 16px;
      .card { max-width: 560px; padding: 28px; }
      ol { padding-left: 20px; line-height: 1.9; }
    }
    .toasts {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 200;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: min(420px, calc(100vw - 32px));
    }
    .toast {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 18px 12px 14px;
      border-radius: 999px;
      background: #0b0b0c;
      color: #fff;
      box-shadow: var(--shadow-lg);
      font-size: 13.5px;
      font-weight: 500;
      cursor: pointer;
      animation: rise 0.2s ease-out;
      &::before {
        content: '';
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #6fbf8c;
      }
      &.info::before { background: var(--copper-light); }
      &.error::before { background: #ea6d60; }
    }
  `,
})
export class App {
  protected readonly configured = isSupabaseConfigured();
  protected readonly toast = inject(ToastService);
}
