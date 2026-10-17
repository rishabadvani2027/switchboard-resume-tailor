import { tailoringResultSchema, type TailoringResult } from './types';

export interface TailoringProvider {
  analyze(input: { resume: string; jobDescription: string }): Promise<TailoringResult>;
}

let demoAnalysisNumber = 0;

export class MockTailoringProvider implements TailoringProvider {
  async analyze(input: { resume: string; jobDescription: string }): Promise<TailoringResult> {
    demoAnalysisNumber += 1;
    const lines = input.resume.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const selected = lines.slice(0, Math.min(3, lines.length));
    const changes = selected.map((original, index) => ({
      id: `chg-${String(index + 1).padStart(3, '0')}`,
      section: index === 0 ? 'Summary' : 'Experience',
      kind: 'addition' as const,
      original,
      proposed: `${original} (tailored for the target role)`,
      rationale: 'Demo suggestion based on text submitted for this analysis.',
      status: 'pending' as const,
    }));
    return tailoringResultSchema.parse({
      analysisId: `demo-analysis-${String(demoAnalysisNumber).padStart(3, '0')}`,
      status: 'ready',
      changes: changes.length > 0 ? changes : [{
        id: 'chg-001',
        section: 'Summary',
        kind: 'addition',
        original: input.resume,
        proposed: `${input.resume} (tailored for the target role)`,
        rationale: 'Demo suggestion based on text submitted for this analysis.',
        status: 'pending',
      }],
      provider: 'mock-claude-resume-kit-adapter',
    });
  }
}

export function getTailoringProvider(): TailoringProvider {
  if (process.env.TAILORING_PROVIDER && process.env.TAILORING_PROVIDER !== 'mock') {
    throw new Error('Configured tailoring providers require a server integration.');
  }
  return new MockTailoringProvider();
}
