import { Injectable, OnDestroy, WritableSignal, computed, inject, signal } from '@angular/core';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

import { AuthService } from './auth.service';
import { todayISO } from './dates';
import {
  Member,
  NO_OBJECTIVE_COLOR,
  Objective,
  PALETTE,
  Project,
  Status,
  Task,
  TaskDraft,
} from './models';
import { friendlyError, supabase } from './supabase';
import { ToastService } from './toast.service';

export interface Filters {
  search: string;
  /** 'all' | 'none' | id del objetivo */
  objective: string;
  status: 'all' | Status | 'vencidas';
  assignee: string;
}

const EMPTY_FILTERS: Filters = { search: '', objective: 'all', status: 'all', assignee: 'all' };

export type ImportRow = Omit<TaskDraft, 'objective_id'> & { objective_code: string };

/**
 * Estado de UN proyecto abierto. Se provee en la pagina del proyecto, asi
 * que vive y muere con ella (y con su canal de Realtime).
 */
@Injectable()
export class BoardService implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private channel: RealtimeChannel | null = null;

  readonly project = signal<Project | null>(null);
  readonly members = signal<Member[]>([]);
  readonly objectives = signal<Objective[]>([]);
  readonly tasks = signal<Task[]>([]);
  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly removed = signal(false);

  readonly filters = signal<Filters>({ ...EMPTY_FILTERS });
  readonly hasFilters = computed(() => {
    const f = this.filters();
    return f.search !== '' || f.objective !== 'all' || f.status !== 'all' || f.assignee !== 'all';
  });

  /** Tarea abierta en el dialogo: null = cerrado; sin id = nueva. */
  readonly editing = signal<(Partial<Task> & { start_date: string; end_date: string }) | null>(null);

  readonly myRole = computed(() => {
    const uid = this.auth.user()?.id;
    return this.members().find((m) => m.user_id === uid)?.role ?? null;
  });
  readonly isOwner = computed(() => this.myRole() === 'owner');

  readonly objectiveMap = computed(() => new Map(this.objectives().map((o) => [o.id, o])));

  readonly sortedTasks = computed(() =>
    [...this.tasks()].sort(
      (a, b) =>
        a.start_date.localeCompare(b.start_date) ||
        a.end_date.localeCompare(b.end_date) ||
        a.name.localeCompare(b.name),
    ),
  );

  /** Responsables conocidos: miembros + lo que ya se haya escrito en tareas. */
  readonly assignees = computed(() => {
    const names = new Set<string>();
    for (const m of this.members()) if (m.profile?.full_name) names.add(m.profile.full_name);
    for (const t of this.tasks()) if (t.assignee.trim()) names.add(t.assignee.trim());
    return [...names].sort((a, b) => a.localeCompare(b));
  });

  readonly filteredTasks = computed(() => {
    const f = this.filters();
    const q = normalize(f.search);
    const today = todayISO();
    return this.sortedTasks().filter((t) => {
      if (f.objective === 'none' && t.objective_id) return false;
      if (f.objective !== 'all' && f.objective !== 'none' && t.objective_id !== f.objective)
        return false;
      if (f.status === 'vencidas') {
        if (!isOverdue(t, today)) return false;
      } else if (f.status !== 'all' && t.status !== f.status) return false;
      if (f.assignee !== 'all' && t.assignee.trim() !== f.assignee) return false;
      if (q) {
        const hay = normalize(`${t.name} ${t.deliverable} ${t.assignee} ${t.notes}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  readonly kpis = computed(() => {
    const list = this.filteredTasks();
    const today = todayISO();
    const total = list.length;
    return {
      total,
      done: list.filter((t) => t.status === 'completada').length,
      inProgress: list.filter((t) => t.status === 'en_proceso').length,
      blocked: list.filter((t) => t.status === 'bloqueada').length,
      overdue: list.filter((t) => isOverdue(t, today)).length,
      progress: total ? Math.round(list.reduce((s, t) => s + t.progress, 0) / total) : 0,
    };
  });

  colorOf(task: Pick<Task, 'objective_id'>): string {
    return (task.objective_id && this.objectiveMap().get(task.objective_id)?.color) || NO_OBJECTIVE_COLOR;
  }

  objectiveOf(task: Pick<Task, 'objective_id'>): Objective | null {
    return (task.objective_id && this.objectiveMap().get(task.objective_id)) || null;
  }

  // ------------------------------------------------------------------
  // Carga y tiempo real
  // ------------------------------------------------------------------

  async open(projectId: string) {
    this.loading.set(true);
    this.notFound.set(false);
    try {
      const [project, members, objectives, tasks] = await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).maybeSingle(),
        this.fetchMembers(projectId),
        supabase.from('objectives').select('*').eq('project_id', projectId).order('code'),
        supabase.from('tasks').select('*').eq('project_id', projectId),
      ]);
      if (project.error) throw project.error;
      if (!project.data) {
        this.notFound.set(true);
        return;
      }
      this.project.set(project.data as Project);
      this.members.set(members);
      this.objectives.set((objectives.data ?? []) as Objective[]);
      this.tasks.set((tasks.data ?? []) as Task[]);
      this.subscribe(projectId);
    } catch (e) {
      this.toast.error(friendlyError(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async fetchMembers(projectId: string): Promise<Member[]> {
    const { data, error } = await supabase
      .from('project_members')
      .select('*, profile:profiles(id, full_name, email)')
      .eq('project_id', projectId)
      .order('joined_at');
    if (error) throw error;
    return (data ?? []) as Member[];
  }

  private subscribe(projectId: string) {
    this.channel?.unsubscribe();
    const filter = `project_id=eq.${projectId}`;

    // Supabase no filtra los DELETE (con RLS solo traen la llave primaria),
    // por eso van en suscripciones aparte sin filtro y se ignoran los ajenos.
    this.channel = supabase
      .channel(`project:${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter }, (p) =>
        this.upsertLocal(this.tasks, p),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter }, (p) =>
        this.upsertLocal(this.tasks, p),
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks' }, (p) =>
        this.removeLocal(this.tasks, p),
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'objectives', filter }, (p) =>
        this.upsertLocal(this.objectives, p),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'objectives', filter }, (p) =>
        this.upsertLocal(this.objectives, p),
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'objectives' }, (p) => {
        this.removeLocal(this.objectives, p);
        // on delete set null: la base ya lo hizo, aqui solo se refleja.
        const id = (p.old as { id?: string }).id;
        this.tasks.update((list) =>
          list.map((t) => (t.objective_id === id ? { ...t, objective_id: null } : t)),
        );
      })
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        (p) => this.project.set(p.new as Project),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members' }, (p) => {
        const row = (p.eventType === 'DELETE' ? p.old : p.new) as Partial<Member>;
        if (row.project_id && row.project_id !== projectId) return;
        if (p.eventType === 'DELETE' && row.user_id === this.auth.user()?.id) {
          this.removed.set(true);
          return;
        }
        this.fetchMembers(projectId).then((m) => this.members.set(m)).catch(() => {});
      })
      .subscribe();
  }

  private upsertLocal<T extends { id: string }>(
    target: WritableSignal<T[]>,
    p: RealtimePostgresChangesPayload<Record<string, unknown>>,
  ) {
    const row = p.new as unknown as T;
    target.update((list) => {
      const i = list.findIndex((x) => x.id === row.id);
      if (i === -1) return [...list, row];
      const copy = list.slice();
      copy[i] = row;
      return copy;
    });
  }

  private removeLocal<T extends { id: string }>(
    target: WritableSignal<T[]>,
    p: RealtimePostgresChangesPayload<Record<string, unknown>>,
  ) {
    const id = (p.old as { id?: string }).id;
    if (id) target.update((list) => list.filter((x) => x.id !== id));
  }

  ngOnDestroy() {
    this.channel?.unsubscribe();
  }

  // ------------------------------------------------------------------
  // Tareas
  // ------------------------------------------------------------------

  newTask(start = todayISO(), end = start) {
    this.editing.set({
      name: '',
      start_date: start,
      end_date: end,
      status: 'pendiente',
      priority: 'media',
      progress: 0,
      // Si hay un objetivo filtrado, la nueva actividad nace en el.
      objective_id: ['all', 'none'].includes(this.filters().objective) ? null : this.filters().objective,
      deliverable: '',
      assignee: '',
      notes: '',
      evidence_url: '',
    });
  }

  edit(task: Task) {
    this.editing.set({ ...task });
  }

  async createTask(draft: TaskDraft) {
    const project = this.project();
    if (!project) return;
    const { data, error } = await supabase
      .from('tasks')
      .insert({ ...draft, project_id: project.id, created_by: this.auth.user()?.id })
      .select()
      .single();
    if (error) throw error;
    // Realtime tambien la trae; upsert por id evita duplicarla.
    this.tasks.update((list) =>
      list.some((t) => t.id === data.id) ? list : [...list, data as Task],
    );
  }

  /** Optimista: la vista se mueve al instante y se revierte si la base falla. */
  async updateTask(id: string, changes: Partial<TaskDraft>) {
    const before = this.tasks().find((t) => t.id === id);
    if (!before) return;
    if (changes.status === 'completada' && changes.progress === undefined) changes.progress = 100;
    this.tasks.update((list) => list.map((t) => (t.id === id ? { ...t, ...changes } : t)));
    const { error } = await supabase.from('tasks').update(changes).eq('id', id);
    if (error) {
      this.tasks.update((list) => list.map((t) => (t.id === id ? before : t)));
      this.toast.error(friendlyError(error));
      throw error;
    }
  }

  async deleteTask(id: string) {
    const before = this.tasks();
    this.tasks.update((list) => list.filter((t) => t.id !== id));
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) {
      this.tasks.set(before);
      throw error;
    }
  }

  async importTasks(rows: ImportRow[], objectives: { code: string; name: string }[], replace: boolean) {
    const project = this.project();
    if (!project) return 0;
    const { data, error } = await supabase.rpc('import_tasks', {
      p_project: project.id,
      p_tasks: rows,
      p_objectives: objectives,
      p_replace: replace,
    });
    if (error) throw error;
    // Una importacion grande genera cientos de eventos; recargar es mas simple.
    await this.reload();
    return data as number;
  }

  async reload() {
    const id = this.project()?.id;
    if (!id) return;
    const [objectives, tasks] = await Promise.all([
      supabase.from('objectives').select('*').eq('project_id', id).order('code'),
      supabase.from('tasks').select('*').eq('project_id', id),
    ]);
    if (objectives.data) this.objectives.set(objectives.data as Objective[]);
    if (tasks.data) this.tasks.set(tasks.data as Task[]);
  }

  // ------------------------------------------------------------------
  // Objetivos
  // ------------------------------------------------------------------

  nextObjectiveColor() {
    return PALETTE[this.objectives().length % PALETTE.length];
  }

  async saveObjective(obj: Partial<Objective> & { code: string; name: string; color: string }) {
    const project = this.project();
    if (!project) return;
    const payload = { code: obj.code.trim().toUpperCase(), name: obj.name.trim(), color: obj.color };
    const query = obj.id
      ? supabase.from('objectives').update(payload).eq('id', obj.id).select().single()
      : supabase.from('objectives').insert({ ...payload, project_id: project.id }).select().single();
    const { data, error } = await query;
    if (error) throw error;
    this.objectives.update((list) => {
      const rest = list.filter((o) => o.id !== data.id);
      return [...rest, data as Objective].sort((a, b) => a.code.localeCompare(b.code));
    });
  }

  async deleteObjective(id: string) {
    const { error } = await supabase.from('objectives').delete().eq('id', id);
    if (error) throw error;
    this.objectives.update((list) => list.filter((o) => o.id !== id));
    this.tasks.update((list) =>
      list.map((t) => (t.objective_id === id ? { ...t, objective_id: null } : t)),
    );
  }

  // ------------------------------------------------------------------
  // Proyecto y miembros
  // ------------------------------------------------------------------

  async updateProject(changes: Partial<Pick<Project, 'name' | 'description' | 'color'>>) {
    const project = this.project();
    if (!project) return;
    const { error } = await supabase.from('projects').update(changes).eq('id', project.id);
    if (error) throw error;
    this.project.set({ ...project, ...changes });
  }

  async regenerateCode() {
    const project = this.project();
    if (!project) return;
    const { data, error } = await supabase.rpc('regenerate_invite_code', { p_project: project.id });
    if (error) throw error;
    this.project.set({ ...project, invite_code: data as string });
  }

  async setRole(userId: string, role: Member['role']) {
    const project = this.project();
    if (!project) return;
    const { error } = await supabase
      .from('project_members')
      .update({ role })
      .eq('project_id', project.id)
      .eq('user_id', userId);
    if (error) throw error;
    this.members.update((list) => list.map((m) => (m.user_id === userId ? { ...m, role } : m)));
  }

  async removeMember(userId: string) {
    const project = this.project();
    if (!project) return;
    const { error } = await supabase
      .from('project_members')
      .delete()
      .eq('project_id', project.id)
      .eq('user_id', userId);
    if (error) throw error;
    this.members.update((list) => list.filter((m) => m.user_id !== userId));
  }

  async leave() {
    const project = this.project();
    if (!project) return;
    const { error } = await supabase.rpc('leave_project', { p_project: project.id });
    if (error) throw error;
  }

  async deleteProject() {
    const project = this.project();
    if (!project) return;
    const { error } = await supabase.from('projects').delete().eq('id', project.id);
    if (error) throw error;
  }

  resetFilters() {
    this.filters.set({ ...EMPTY_FILTERS });
  }

  patchFilters(changes: Partial<Filters>) {
    this.filters.update((f) => ({ ...f, ...changes }));
  }
}

export function isOverdue(t: Task, today = todayISO()) {
  return t.status !== 'completada' && t.end_date < today;
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}
