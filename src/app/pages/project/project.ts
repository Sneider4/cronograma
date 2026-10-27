import { Component, ElementRef, HostListener, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { CalendarView } from '../../components/calendar';
import { Gantt } from '../../components/gantt';
import { Icon, IconName } from '../../components/icon';
import { ImportDialog } from '../../components/import-dialog';
import { Kanban } from '../../components/kanban';
import { SettingsDialog } from '../../components/settings-dialog';
import { TaskDialog } from '../../components/task-dialog';
import { TaskList } from '../../components/task-list';
import { Topbar } from '../../components/topbar';
import { AuthService } from '../../core/auth.service';
import { BoardService, Filters } from '../../core/board.service';
import { ExcelService, ImportResult } from '../../core/excel.service';
import { diffDays, formatDate, todayISO } from '../../core/dates';
import { NO_OBJECTIVE_COLOR, STATUSES } from '../../core/models';
import { CountUp, firstVisit } from '../../core/motion';
import { loadPref, savePref } from '../../core/prefs';
import { friendlyError } from '../../core/supabase';
import { ToastService } from '../../core/toast.service';

type View = 'gantt' | 'calendario' | 'kanban' | 'lista';

@Component({
  selector: 'app-project',
  imports: [RouterLink, Topbar, Icon, Gantt, CalendarView, Kanban, TaskList, TaskDialog, ImportDialog, SettingsDialog, CountUp],
  providers: [BoardService],
  templateUrl: './project.html',
  styleUrl: './project.scss',
})
export class ProjectPage {
  protected readonly board = inject(BoardService);
  protected readonly auth = inject(AuthService);
  private readonly excel = inject(ExcelService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  /** Viene de la ruta p/:id (withComponentInputBinding). */
  readonly id = input.required<string>();

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('file');

  protected readonly statuses = STATUSES;
  protected readonly views: { value: View; label: string; icon: IconName }[] = [
    { value: 'gantt', label: 'Gantt', icon: 'gantt' },
    { value: 'calendario', label: 'Calendario', icon: 'calendar' },
    { value: 'kanban', label: 'Kanban', icon: 'kanban' },
    { value: 'lista', label: 'Lista', icon: 'list' },
  ];
  protected readonly view = signal<View>(loadPref('view', 'gantt') as View);
  protected readonly excelMenu = signal(false);
  protected readonly excelBusy = signal(false);
  protected readonly importResult = signal<ImportResult | null>(null);
  protected readonly importFile = signal('');
  protected readonly settingsTab = signal<'general' | 'objetivos' | 'equipo' | null>(null);

  /** Animacion de entrada solo la primera vez por sesion en cada proyecto. */
  protected readonly intro = signal(false);

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.intro.set(firstVisit(`project.${id}`));
        void this.board.open(id);
      });
    });
    effect(() => {
      if (this.board.removed()) {
        this.toast.error('Ya no eres miembro de este proyecto.');
        void this.router.navigateByUrl('/');
      }
    });
  }

  protected readonly today = todayISO();
  protected readonly filtersOpen = signal(false);
  /** Cuantos filtros (sin contar la busqueda) estan activos, para el boton de movil. */
  protected readonly activeFilters = computed(() => {
    const f = this.board.filters();
    return [f.objective, f.status, f.assignee].filter((v) => v !== 'all').length;
  });
  // En movil el resumen arranca oculto para que la vista quede a la mano.
  protected readonly showSummary = signal(
    loadPref('project.summary', window.innerWidth < 640 ? '0' : '1') === '1',
  );

  /** Avance de cada objetivo (sobre todas las actividades, sin filtros). */
  protected readonly objectiveProgress = computed(() => {
    const tasks = this.board.tasks();
    const rows = this.board.objectives().map((o) => ({ key: o.id, code: o.code, name: o.name, color: o.color }));
    const orphan = tasks.some((t) => !t.objective_id);
    if (orphan && rows.length) rows.push({ key: 'none', code: '—', name: 'Sin objetivo', color: NO_OBJECTIVE_COLOR });
    return rows.map((r) => {
      const list = tasks.filter((t) => (r.key === 'none' ? !t.objective_id : t.objective_id === r.key));
      const done = list.filter((t) => t.status === 'completada').length;
      return { ...r, total: list.length, done, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
    });
  });

  /** Actividades sin completar ordenadas por fecha de fin (las vencidas primero). */
  protected readonly upcoming = computed(() =>
    this.board
      .tasks()
      .filter((t) => t.status !== 'completada')
      .sort((a, b) => a.end_date.localeCompare(b.end_date))
      .slice(0, 6),
  );

  protected toggleSummary() {
    this.showSummary.update((v) => !v);
    savePref('project.summary', this.showSummary() ? '1' : '0');
  }

  protected toggleObjective(key: string) {
    this.filter('objective', this.board.filters().objective === key ? 'all' : key);
  }

  /** "Hoy", "Mañana", "En 5 d", "Hace 2 d" o la fecha si es lejana. */
  protected rel(iso: string) {
    const d = diffDays(this.today, iso);
    if (d === 0) return 'Hoy';
    if (d === 1) return 'Mañana';
    if (d === -1) return 'Ayer';
    if (d < 0) return `Hace ${-d} d`;
    if (d <= 14) return `En ${d} d`;
    return formatDate(iso, false);
  }

  protected setView(v: View) {
    this.view.set(v);
    savePref('view', v);
  }

  protected filter<K extends keyof Filters>(key: K, value: Filters[K]) {
    this.board.patchFilters({ [key]: value } as Partial<Filters>);
  }

  // ---------- Excel ----------

  @HostListener('document:click')
  closeMenus() {
    this.excelMenu.set(false);
  }

  protected toggleExcel(ev: Event) {
    ev.stopPropagation();
    this.excelMenu.update((v) => !v);
  }

  protected async exportExcel() {
    const p = this.board.project();
    if (!p) return;
    if (!this.board.tasks().length) {
      this.toast.show('El proyecto aún no tiene actividades. Te descargo la plantilla.', 'info');
      return this.downloadTemplate();
    }
    await this.withExcel(() => this.excel.exportProject(p, this.board.objectives(), this.board.sortedTasks()));
  }

  protected async downloadTemplate() {
    const p = this.board.project();
    if (!p) return;
    await this.withExcel(() => this.excel.downloadTemplate(p, this.board.objectives()));
  }

  protected pickFile() {
    this.fileInput()?.nativeElement.click();
  }

  protected async onFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      this.toast.error('Sube un archivo .xlsx (Excel). Si es .xls o .csv, ábrelo en Excel y guárdalo como .xlsx.');
      return;
    }
    await this.withExcel(async () => {
      this.importResult.set(await this.excel.parse(file, this.board.objectives()));
      this.importFile.set(file.name);
    });
  }

  private async withExcel(fn: () => Promise<unknown>) {
    this.excelMenu.set(false);
    this.excelBusy.set(true);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      this.toast.error(
        e instanceof Error && /zip|central directory|signature/i.test(e.message)
          ? 'No se pudo leer el archivo. ¿Es un Excel .xlsx válido?'
          : friendlyError(e),
      );
    } finally {
      this.excelBusy.set(false);
    }
  }
}
