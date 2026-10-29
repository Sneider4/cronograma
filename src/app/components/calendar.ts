import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { Calendar, EventDropArg, EventInput } from '@fullcalendar/core';
import esLocale from '@fullcalendar/core/locales/es';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { EventResizeDoneArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';

import { BoardService } from '../core/board.service';
import { addDays } from '../core/dates';
import { Task, statusLabel, textOn } from '../core/models';
import { loadPref, savePref } from '../core/prefs';

@Component({
  selector: 'app-calendar',
  template: `<div class="card wrap"><div #host></div></div>`,
  styles: `
    .wrap { padding: 14px 16px 16px; }
    @media (max-width: 640px) { .wrap { padding: 12px 10px; border-radius: 20px; } }
  `,
})
export class CalendarView implements AfterViewInit, OnDestroy {
  private readonly board = inject(BoardService);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private calendar: Calendar | null = null;

  constructor() {
    // Cada cambio en las tareas filtradas (propio o de otro usuario) se
    // refleja en el calendario sin recrearlo.
    effect(() => {
      const events = this.board.filteredTasks().map((t) => this.toEvent(t));
      this.board.objectives(); // los colores dependen de los objetivos
      if (!this.calendar) return;
      this.calendar.batchRendering(() => {
        this.calendar!.removeAllEventSources();
        this.calendar!.addEventSource(events);
      });
    });
    // Solo el dueno mueve fechas o crea actividades desde el calendario.
    effect(() => {
      const owner = this.board.canEditAll();
      this.calendar?.setOption('editable', owner);
      this.calendar?.setOption('selectable', owner);
    });
  }

  ngAfterViewInit() {
    const narrow = window.innerWidth < 640;
    this.calendar = new Calendar(this.host().nativeElement, {
      plugins: [dayGridPlugin, listPlugin, interactionPlugin],
      locale: esLocale,
      // En movil: lista por semana (la del mes repite cada actividad todos los dias) y el mes.
      initialView: narrow
        ? loadPref('calendar.view.m', 'listWeek')
        : loadPref('calendar.view', 'dayGridMonth'),
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: narrow ? 'dayGridMonth,listWeek' : 'dayGridMonth,dayGridWeek,listMonth',
      },
      buttonText: { today: 'Hoy', month: 'Mes', week: 'Semana', list: 'Lista' },
      height: 'auto',
      firstDay: 1,
      dayMaxEvents: 4,
      editable: this.board.canEditAll(),
      selectable: this.board.canEditAll(),
      eventDisplay: 'block',
      events: this.board.filteredTasks().map((t) => this.toEvent(t)),
      datesSet: (arg) => savePref(narrow ? 'calendar.view.m' : 'calendar.view', arg.view.type),
      eventClick: (arg) => {
        const task = this.board.tasks().find((t) => t.id === arg.event.id);
        if (task) this.board.edit(task);
      },
      // FullCalendar usa fin exclusivo; las tareas, inclusivo.
      select: (arg) => this.board.newTask(arg.startStr, addDays(arg.endStr, -1)),
      eventDrop: (arg) => this.persist(arg),
      eventResize: (arg) => this.persist(arg),
    });
    this.calendar.render();
  }

  ngOnDestroy() {
    this.calendar?.destroy();
  }

  private toEvent(t: Task): EventInput {
    const color = this.board.colorOf(t);
    const obj = this.board.objectiveOf(t);
    return {
      id: t.id,
      title: `${obj ? obj.code + ' · ' : ''}${t.name}`,
      start: t.start_date,
      end: addDays(t.end_date, 1),
      allDay: true,
      backgroundColor: color,
      borderColor: color,
      textColor: textOn(color),
      classNames: t.status === 'completada' ? ['is-done'] : [],
      extendedProps: { status: statusLabel(t.status) },
    };
  }

  private async persist(arg: EventDropArg | EventResizeDoneArg) {
    const start = arg.event.startStr.slice(0, 10);
    const endExcl = arg.event.endStr ? arg.event.endStr.slice(0, 10) : addDays(start, 1);
    try {
      await this.board.updateTask(arg.event.id, { start_date: start, end_date: addDays(endExcl, -1) });
    } catch {
      arg.revert();
    }
  }
}
