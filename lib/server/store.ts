import { authConfig, hasSupabase, isDemoMode, type Session } from '../auth/config';
import type { ChangeStatus, Insights, ResumeChange } from '../tailoring/types';

export type AnalysisRecord = {
  id: string;
  title: string;
  source: string;
  jobDescription: string;
  changes: ResumeChange[];
  insights: Insights;
  provider: string;
  status: 'ready' | 'failed';
  createdAt: string;
};

export type AnalysisSummary = { id: string; title: string; createdAt: string; total: number; pending: number };

export type NewAnalysis = Omit<AnalysisRecord, 'createdAt' | 'status'> & { idempotencyKey: string };

export interface Store {
  readonly kind: 'memory' | 'supabase';
  countCompletedAnalyses(): Promise<number>;
  hasActiveSubscription(): Promise<boolean>;
  findByIdempotencyKey(key: string): Promise<AnalysisRecord | null>;
  createAnalysis(input: NewAnalysis): Promise<AnalysisRecord>;
  getAnalysis(id: string): Promise<AnalysisRecord | null>;
  listAnalyses(limit: number): Promise<AnalysisSummary[]>;
  /** Sets the status of the given changes. Returns null when the analysis does not exist (memory store only). */
  setChangeStatus(analysisId: string, changeIds: string[], status: ChangeStatus): Promise<ResumeChange[] | null>;
  saveExport(analysisId: string, content: string): Promise<void>;
  saveDocument(input: { name: string; type: string; bytes: ArrayBuffer; text: string; kind: 'resume' | 'job_description' }): Promise<{ id: string | null }>;
  activateDemoSubscription?(): Promise<void>;
}

export class StoreError extends Error {
  constructor(message: string, readonly status = 500, readonly userMessage = 'We could not reach the database. Please try again.') {
    super(message);
  }
}

const summarize = (analysis: AnalysisRecord): AnalysisSummary => ({
  id: analysis.id,
  title: analysis.title,
  createdAt: analysis.createdAt,
  total: analysis.changes.length,
  pending: analysis.changes.filter((change) => change.status === 'pending').length,
});

/* ---------------------------------------------------------------- memory (local demo) */

type MemoryState = {
  analyses: Map<string, AnalysisRecord & { userId: string; idempotencyKey: string }>;
  subscriptions: Set<string>;
  exports: Map<string, string>;
};

// Kept on globalThis so it survives Next.js hot reloads during local development.
const memory: MemoryState = ((globalThis as unknown as { __resumeStore?: MemoryState }).__resumeStore ??= {
  analyses: new Map(),
  subscriptions: new Set(),
  exports: new Map(),
});

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  constructor(private userId: string) {}

  private own() { return [...memory.analyses.values()].filter((analysis) => analysis.userId === this.userId); }
  async countCompletedAnalyses() { return this.own().filter((analysis) => analysis.status === 'ready').length; }
  async hasActiveSubscription() { return memory.subscriptions.has(this.userId); }
  async activateDemoSubscription() { memory.subscriptions.add(this.userId); }
  async findByIdempotencyKey(key: string) { return this.own().find((analysis) => analysis.idempotencyKey === key) ?? null; }
  async createAnalysis(input: NewAnalysis) {
    const record = { ...input, userId: this.userId, status: 'ready' as const, createdAt: new Date().toISOString(), changes: input.changes.map((c) => ({ ...c })) };
    memory.analyses.set(input.id, record);
    return record;
  }
  async getAnalysis(id: string) {
    const analysis = memory.analyses.get(id);
    return analysis && analysis.userId === this.userId ? analysis : null;
  }
  async listAnalyses(limit: number) {
    return this.own().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(summarize);
  }
  async setChangeStatus(analysisId: string, changeIds: string[], status: ChangeStatus) {
    const analysis = await this.getAnalysis(analysisId);
    if (!analysis) return null;
    const ids = new Set(changeIds);
    analysis.changes = analysis.changes.map((change) => (ids.has(change.id) ? { ...change, status } : change));
    return analysis.changes;
  }
  async saveExport(analysisId: string, content: string) { memory.exports.set(`${this.userId}:${analysisId}`, content); }
  async saveDocument() { return { id: null }; }
}

/* ---------------------------------------------------------------- supabase (production) */

type AnalysisRow = {
  id: string; title: string; source_text: string; job_description: string; insights: Insights | null;
  provider: string; status: string; created_at: string;
};
type ChangeRow = {
  id: string; section: string; kind: ResumeChange['kind']; original: string; proposed: string;
  rationale: string; status: ChangeStatus; position: number;
};

const toChange = (row: ChangeRow): ResumeChange => ({
  id: row.id, section: row.section, kind: row.kind, original: row.original,
  proposed: row.proposed, rationale: row.rationale ?? '', status: row.status,
});

const emptyInsights: Insights = { summary: '', matchedKeywords: [], missingKeywords: [] };

export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;
  constructor(private userId: string, private token: string) {}

  private async request<T>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
    const { prefer, headers, ...rest } = init;
    const response = await fetch(`${authConfig.supabaseUrl}/rest/v1/${path}`, {
      ...rest,
      headers: {
        apikey: authConfig.supabaseAnonKey!,
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        ...(prefer ? { prefer } : {}),
        ...headers,
      },
      cache: 'no-store',
    }).catch((error: unknown) => { throw new StoreError(`Supabase unreachable: ${String(error)}`, 503); });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const missingColumn = /column .* does not exist|Could not find the .* column/i.test(detail);
      throw new StoreError(
        `Supabase ${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${response.status} ${detail.slice(0, 400)}`,
        response.status === 409 ? 409 : 502,
        missingColumn ? 'The database schema is out of date. Apply the latest Supabase migration.' : undefined,
      );
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async countCompletedAnalyses() {
    const rows = await this.request<Array<{ id: string }>>(`analyses?select=id&user_id=eq.${this.userId}&status=eq.ready&limit=1000`);
    return rows.length;
  }

  async hasActiveSubscription() {
    const rows = await this.request<Array<{ status: string }>>(`subscriptions?select=status&user_id=eq.${this.userId}`);
    return rows.some((row) => row.status === 'active' || row.status === 'trialing');
  }

  private async loadChanges(analysisId: string) {
    const rows = await this.request<ChangeRow[]>(`changes?select=id,section,kind,original,proposed,rationale,status,position&analysis_id=eq.${analysisId}&order=position.asc`);
    return rows.map(toChange);
  }

  private async hydrate(row: AnalysisRow): Promise<AnalysisRecord> {
    return {
      id: row.id,
      title: row.title,
      source: row.source_text,
      jobDescription: row.job_description,
      insights: { ...emptyInsights, ...(row.insights ?? {}) },
      provider: row.provider,
      status: row.status === 'failed' ? 'failed' : 'ready',
      createdAt: row.created_at,
      changes: await this.loadChanges(row.id),
    };
  }

  private static readonly analysisColumns = 'id,title,source_text,job_description,insights,provider,status,created_at';

  async findByIdempotencyKey(key: string) {
    const rows = await this.request<AnalysisRow[]>(`analyses?select=${SupabaseStore.analysisColumns}&user_id=eq.${this.userId}&idempotency_key=eq.${encodeURIComponent(key)}&limit=1`);
    return rows[0] ? this.hydrate(rows[0]) : null;
  }

  async createAnalysis(input: NewAnalysis) {
    const [row] = await this.request<AnalysisRow[]>('analyses', {
      method: 'POST',
      prefer: 'return=representation',
      body: JSON.stringify({
        id: input.id,
        user_id: this.userId,
        title: input.title,
        source_text: input.source,
        job_description: input.jobDescription,
        insights: input.insights,
        provider: input.provider,
        status: 'ready',
        idempotency_key: input.idempotencyKey,
      }),
    });
    await this.request('changes', {
      method: 'POST',
      prefer: 'return=minimal',
      body: JSON.stringify(input.changes.map((change, position) => ({
        id: change.id,
        analysis_id: input.id,
        user_id: this.userId,
        section: change.section,
        kind: change.kind,
        original: change.original,
        proposed: change.proposed,
        rationale: change.rationale,
        status: 'pending',
        position,
      }))),
    });
    return { ...(await this.hydrate(row)) };
  }

  async getAnalysis(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const rows = await this.request<AnalysisRow[]>(`analyses?select=${SupabaseStore.analysisColumns}&id=eq.${id}&user_id=eq.${this.userId}&limit=1`);
    return rows[0] ? this.hydrate(rows[0]) : null;
  }

  async listAnalyses(limit: number) {
    const rows = await this.request<Array<{ id: string; title: string; created_at: string; changes: Array<{ status: ChangeStatus }> }>>(
      `analyses?select=id,title,created_at,changes!changes_analysis_id_fkey(status)&user_id=eq.${this.userId}&status=eq.ready&order=created_at.desc&limit=${limit}`,
    );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      total: row.changes?.length ?? 0,
      pending: row.changes?.filter((change) => change.status === 'pending').length ?? 0,
    }));
  }

  async setChangeStatus(analysisId: string, changeIds: string[], status: ChangeStatus) {
    if (!/^[0-9a-f-]{36}$/i.test(analysisId)) return null;
    const safeIds = changeIds.filter((id) => /^[A-Za-z0-9_-]{1,100}$/.test(id));
    if (safeIds.length > 0) {
      await this.request(`changes?analysis_id=eq.${analysisId}&user_id=eq.${this.userId}&id=in.(${safeIds.map((id) => `"${id}"`).join(',')})`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: JSON.stringify({ status }),
      });
    }
    return [];
  }

  async saveExport(analysisId: string, content: string) {
    await this.request('exports', {
      method: 'POST',
      prefer: 'return=minimal',
      body: JSON.stringify({ analysis_id: analysisId, user_id: this.userId, content }),
    });
  }

  async saveDocument(input: { name: string; type: string; bytes: ArrayBuffer; text: string; kind: 'resume' | 'job_description' }) {
    const safeName = input.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const storagePath = `${this.userId}/${crypto.randomUUID()}-${safeName}`;
    const upload = await fetch(`${authConfig.supabaseUrl}/storage/v1/object/private-documents/${storagePath}`, {
      method: 'POST',
      headers: {
        apikey: authConfig.supabaseAnonKey!,
        authorization: `Bearer ${this.token}`,
        'content-type': input.type,
        'x-upsert': 'false',
      },
      body: Buffer.from(input.bytes),
      cache: 'no-store',
    }).catch(() => null);
    if (!upload?.ok) {
      throw new StoreError(`Storage upload failed: ${upload?.status} ${await upload?.text().catch(() => '')}`, 502);
    }
    const rows = await this.request<Array<{ id: string }>>('documents', {
      method: 'POST',
      prefer: 'return=representation',
      body: JSON.stringify({ user_id: this.userId, kind: input.kind, storage_path: storagePath, extracted_text: input.text }),
    });
    return { id: rows[0]?.id ?? null };
  }
}

export function getStore(session: Session): Store {
  if (isDemoMode) return new MemoryStore(session.userId);
  if (hasSupabase && session.accessToken) return new SupabaseStore(session.userId, session.accessToken);
  throw new StoreError('No persistence configured.', 503, 'Storage is not configured on the server (SUPABASE_URL / SUPABASE_ANON_KEY).');
}
