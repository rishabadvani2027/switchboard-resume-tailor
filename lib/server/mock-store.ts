import type { ResumeChange } from '../tailoring/types';

export type AnalysisStatus = 'ready' | 'failed';
type Analysis = {
  id: string;
  userId: string;
  source: string;
  jobDescription: string;
  changes: ResumeChange[];
  status: AnalysisStatus;
  error?: string;
};
type ExportRecord = { analysisId: string; userId: string; content: string; createdAt: string };

const analyses = new Map<string, Analysis>();
const documents = new Map<string, { id: string; userId: string; name: string; text: string }>();
const exportsByAnalysis = new Map<string, ExportRecord>();
const operations = new Map<string, Set<string>>();
const operationResults = new Map<string, string>();
const subscriptions = new Map<string, 'active' | 'inactive'>();

export function saveAnalysis(analysis: Omit<Analysis, 'status'> & Partial<Pick<Analysis, 'status'>>) {
  analyses.set(analysis.id, { ...analysis, status: analysis.status ?? 'ready' });
}

export function saveFailedAnalysis(analysis: Omit<Analysis, 'status'> & { error: string }) {
  saveAnalysis({ ...analysis, status: 'failed' });
}

export function getAnalysis(id: string, userId: string) {
  const analysis = analyses.get(id);
  return analysis?.userId === userId ? analysis : null;
}

export function updateChange(analysisId: string, changeId: string, userId: string, status: 'approved' | 'rejected') {
  const analysis = getAnalysis(analysisId, userId);
  if (!analysis) return null;
  const index = analysis.changes.findIndex((change) => change.id === changeId);
  if (index < 0) return null;
  analysis.changes[index] = { ...analysis.changes[index], status };
  return analysis.changes[index];
}

export function saveDocument(userId: string, name: string, text: string) {
  const id = `demo-document-${crypto.randomUUID()}`;
  documents.set(id, { id, userId, name, text });
  return { id, userId, name, text };
}

export function getDocument(id: string, userId: string) {
  const document = documents.get(id);
  return document?.userId === userId ? document : null;
}

export function setSubscriptionStatus(userId: string, status: 'active' | 'inactive') {
  subscriptions.set(userId, status);
}

export function hasActiveSubscription(userId: string) {
  return subscriptions.get(userId) === 'active';
}

export function getCompletedOperations(userId: string) {
  return operations.get(userId)?.size ?? 0;
}

// This synchronous operation is the demo store's atomic reservation boundary.
// Replaying a key is a no-op, while concurrent callers cannot overbook a slot.
export function reserveOperation(userId: string, operationKey: string) {
  const userOperations = operations.get(userId) ?? new Set<string>();
  if (userOperations.has(operationKey)) {
    operations.set(userId, userOperations);
    return { allowed: true, alreadyReserved: true, subscribed: hasActiveSubscription(userId) };
  }
  if (!hasActiveSubscription(userId) && userOperations.size >= 3) {
    return { allowed: false, alreadyReserved: false, subscribed: false };
  }
  userOperations.add(operationKey);
  operations.set(userId, userOperations);
  return { allowed: true, alreadyReserved: false, subscribed: hasActiveSubscription(userId) };
}

export function releaseOperation(userId: string, operationKey: string) {
  operations.get(userId)?.delete(operationKey);
  operationResults.delete(`${userId}:${operationKey}`);
}

export function recordCompletedOperation(userId: string, operationKey: string, analysisId?: string) {
  reserveOperation(userId, operationKey);
  if (analysisId) operationResults.set(`${userId}:${operationKey}`, analysisId);
}

export function getOperationResult(userId: string, operationKey: string) {
  const analysisId = operationResults.get(`${userId}:${operationKey}`);
  return analysisId ? getAnalysis(analysisId, userId) : null;
}

export function saveExport(userId: string, analysisId: string, content: string) {
  const existing = exportsByAnalysis.get(`${userId}:${analysisId}`);
  if (existing) return existing;
  const record = { analysisId, userId, content, createdAt: new Date().toISOString() };
  exportsByAnalysis.set(`${userId}:${analysisId}`, record);
  return record;
}

export function getExport(userId: string, analysisId: string) {
  const record = exportsByAnalysis.get(`${userId}:${analysisId}`);
  return record?.userId === userId ? record : null;
}
