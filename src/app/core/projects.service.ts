import { Injectable, computed, signal } from '@angular/core';

import { addDays, todayISO } from './dates';
import { Project, Status } from './models';
import { supabase } from './supabase';

/** Version liviana de una actividad para el tablero de inicio. */
export interface TaskLite {
  id: string;
  name: string;
  status: Status;
  start_date: string;
  end_date: string;
  assignee: string;
  assignee_id: string | null;
}

export interface ProjectSummary extends Project {
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
  overdue: number;
  members: number;
  /** Proxima actividad sin completar por fecha de fin. */
  next: TaskLite | null;
  tasks: TaskLite[];
}

export interface AgendaItem {
  task: TaskLite;
  project: ProjectSummary;
}

/** Listado de "mis proyectos" y resumen general de la pantalla de inicio. */
@Injectable({ providedIn: 'root' })
export class ProjectsService {
  readonly projects = signal<ProjectSummary[]>([]);
  readonly loading = signal(false);

  /** Totales sumando todos los proyectos. */
  readonly totals = computed(() => {
    const ps = this.projects();
    const sum = (k: 'total' | 'done' | 'inProgress' | 'blocked' | 'overdue') => ps.reduce((n, p) => n + p[k], 0);
    const total = sum('total');
    const done = sum('done');
    return {
      projects: ps.length,
      total,
      done,
      inProgress: sum('inProgress'),
      blocked: sum('blocked'),
      overdue: sum('overdue'),
      pending: total - done - sum('inProgress') - sum('blocked'),
      progress: total ? Math.round((done / total) * 100) : 0,
    };
  });

  /** Actividades sin completar: vencidas, de esta semana y de las dos siguientes. */
  readonly agenda = computed(() => {
    const today = todayISO();
    const week = addDays(today, 7);
    const limit = addDays(today, 21);
    const overdue: AgendaItem[] = [];
    const thisWeek: AgendaItem[] = [];
    const later: AgendaItem[] = [];
    for (const project of this.projects()) {
      for (const task of project.tasks) {
        if (task.status === 'completada') continue;
        const item = { task, project };
        if (task.end_date < today) overdue.push(item);
        else if (task.end_date <= week) thisWeek.push(item);
        else if (task.end_date <= limit) later.push(item);
      }
    }
    const byEnd = (a: AgendaItem, b: AgendaItem) => a.task.end_date.localeCompare(b.task.end_date);
    return { overdue: overdue.sort(byEnd), thisWeek: thisWeek.sort(byEnd), later: later.sort(byEnd) };
  });

  async load() {
    this.loading.set(true);
    try {
      // RLS ya filtra: solo llegan los proyectos de los que soy miembro, y de los que no soy
      // dueno, solo mis actividades.
      const { data, error } = await supabase
        .from('projects')
        .select('*, tasks(id, name, status, start_date, end_date, assignee, assignee_id), project_members(count)')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const today = todayISO();
      this.projects.set(
        (data ?? []).map((p) => {
          const { tasks, project_members, ...rest } = p as Project & {
            tasks: TaskLite[];
            project_members: { count: number }[];
          };
          const open = tasks
            .filter((t) => t.status !== 'completada')
            .sort((a, b) => a.end_date.localeCompare(b.end_date));
          return {
            ...rest,
            tasks,
            total: tasks.length,
            done: tasks.length - open.length,
            inProgress: open.filter((t) => t.status === 'en_proceso').length,
            blocked: open.filter((t) => t.status === 'bloqueada').length,
            overdue: open.filter((t) => t.end_date < today).length,
            members: project_members?.[0]?.count ?? 1,
            next: open.find((t) => t.end_date >= today) ?? null,
          };
        }),
      );
    } finally {
      this.loading.set(false);
    }
  }

  async create(name: string, description: string, color: string): Promise<string> {
    const { data, error } = await supabase.rpc('create_project', {
      p_name: name,
      p_description: description,
      p_color: color,
    });
    if (error) throw error;
    return data as string;
  }

  async join(code: string): Promise<string> {
    const { data, error } = await supabase.rpc('join_project', { p_code: code });
    if (error) throw error;
    return data as string;
  }
}
