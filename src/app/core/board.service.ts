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

/** Fila leida del Excel: el responsable llega como texto y se vincula al importar. */
export type ImportRow = Omit<TaskDraft, 'objective_id' | 'assignee_id'> & { objective_code: string };

/** Opcion del filtro de responsables: 'u:<id>' = miembro, 'x:<nombre>' = otra persona. */
export interface AssigneeOption {
  value: string;
  name: string;
  avatar: string;
  member: boolean;
}

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
  /** Administra el proyecto (nombre, equipo, roles, codigo). */
  readonly isOwner = computed(() => this.myRole() === 'owner');
  /** Crea, borra y edita cualquier actividad u objetivo, e importa Excel. */
  readonly canEditAll = computed(() => this.myRole() === 'owner' || this.myRole() === 'editor');
  /** Ve todas las actividades (el integrante solo ve las suyas). */
  readonly canSeeAll = computed(() => this.canEditAll() || this.myRole() === 'contributor');
  readonly myId = computed(() => this.auth.user()?.id ?? null);

  readonly memberMap = computed(() => new Map(this.members().map((m) => [m.user_id, m])));

  readonly objectiveMap = computed(() => new Map(this.objectives().map((o) => [o.id, o])));

  readonly sortedTasks = computed(() =>
    [...this.tasks()].sort(
      (a, b) =>
        a.start_date.localeCompare(b.start_date) ||
        a.end_date.localeCompare(b.end_date) ||
        a.name.localeCompare(b.name),
    ),
  );

  /** Filtro de responsables: miembros del equipo y luego otras personas escritas a mano. */
  readonly assignees = computed<AssigneeOption[]>(() => {
    const members = this.members().map((m) => ({
      value: 'u:' + m.user_id,
      name: m.profile?.full_name || m.profile?.email || 'Sin nombre',
      avatar: m.profile?.avatar ?? '',
      member: true,
    }));
    const others = new Set<string>();
    for (const t of this.tasks()) if (!t.assignee_id && t.assignee.trim()) others.add(t.assignee.trim());
    return [
      ...members.sort((a, b) => a.name.localeCompare(b.name)),
      ...[...others].sort((a, b) => a.localeCompare(b)).map((n) => ({ value: 'x:' + n, name: n, avatar: '', member: false })),
    ];
  });

  /** Nombre que se muestra del responsable (el del perfil, que siempre esta al dia). */
  assigneeName(t: Pick<Task, 'assignee_id' | 'assignee'>): string {
    if (t.assignee_id) {
      const p = this.memberMap().get(t.assignee_id)?.profile;
      return p?.full_name || p?.email || t.assignee || 'Miembro del equipo';
    }
    return t.assignee.trim();
  }

  assigneeAvatar(t: Pick<Task, 'assignee_id'>): string {
    return (t.assignee_id && this.memberMap().get(t.assignee_id)?.profile?.avatar) || '';
  }

  /** Puede cambiar estado y avance de esta actividad (la suya, o todas si edita todo). */
  canUpdate(t: Pick<Task, 'assignee_id'>): boolean {
    return this.canEditAll() || (!!t.assignee_id && t.assignee_id === this.myId());
  }

  /** Busca al miembro por nombre, correo o la parte del correo antes de la @. */
  matchMember(text: string): Member | null {
    const q = normalize(text);
    if (!q) return null;
    return (
      this.members().find((m) => {
        const p = m.profile;
        if (!p) return false;
        return [p.full_name, p.email, p.email.split('@')[0]].some((v) => v && normalize(v) === q);
      }) ?? null
    );
  }

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
      if (f.assignee !== 'all') {
        const key = t.assignee_id ? 'u:' + t.assignee_id : t.assignee.trim() ? 'x:' + t.assignee.trim() : 'none';
        if (key !== f.assignee) return false;
      }
      if (q) {
        const hay = normalize(`${t.name} ${t.deliverable} ${this.assigneeName(t)} ${t.notes}`);
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
      .select('*, profile:profiles(id, full_name, email, avatar)')
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
        const before = this.myRole();
        this.fetchMembers(projectId)
          .then((m) => {
            this.members.set(m);
            if (this.myRole() !== before) void this.reload();
          })
          .catch(() => {});
      })
      // Nombre y avatar del equipo en vivo.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (p) => {
        const row = p.new as { id: string; full_name: string; email: string; avatar?: string };
        if (!this.memberMap().has(row.id)) return;
        this.members.update((list) =>
          list.map((m) => (m.user_id === row.id ? { ...m, profile: { ...m.profile, ...row } } : m)),
        );
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

  private readonly onVisible = () => {
    if (document.visibilityState === 'visible' && this.project() && !this.canSeeAll()) void this.reload();
  };

  constructor() {
    document.addEventListener('visibilitychange', this.onVisible);
  }

  ngOnDestroy() {
    this.channel?.unsubscribe();
    document.removeEventListener('visibilitychange', this.onVisible);
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
      assignee_id: null,
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
    // El responsable del Excel se vincula al miembro que coincida; si no, queda como otra persona.
    const linked = rows.map((r) => {
      const m = this.matchMember(r.assignee);
      return m ? { ...r, assignee_id: m.user_id, assignee: m.profile?.full_name ?? r.assignee } : { ...r, assignee_id: null };
    });
    const { data, error } = await supabase.rpc('import_tasks', {
      p_project: project.id,
      p_tasks: linked,
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
