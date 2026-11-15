import type { ResumeChange } from '../tailoring/types';
import { expandToLines, uniqueIndex, type Span } from '../tailoring/spans';

const SKILLS_HEADING = /^\s*(technical\s+|core\s+|key\s+)?(skills|competencies|technologies|tech stack)\b.*$/i;

/**
 * Builds a change that adds skills the candidate confirmed they have. Prefers appending to the
 * existing skills line; otherwise inserts a "Skills:" line after a free anchor. Never touches a
 * line that another change already covers, so export assembly stays unambiguous.
 */
export function buildSkillsChange(source: string, existing: ResumeChange[], skills: string[], id: string): ResumeChange | null {
  const clean = [...new Set(skills.map((skill) => skill.trim().replace(/\s+/g, ' ')).filter((skill) => skill.length > 0 && skill.length <= 60))].slice(0, 20);
  if (clean.length === 0) return null;

  const taken: Span[] = existing.flatMap((change) => {
    const start = uniqueIndex(source, change.original);
    return start < 0 ? [] : [expandToLines(source, { start, end: start + change.original.length })];
  });
  const lines: Array<{ text: string; start: number; end: number }> = [];
  let offset = 0;
  for (const text of source.split('\n')) {
    lines.push({ text, start: offset, end: offset + text.length });
    offset += text.length + 1;
  }
  const isFree = (line: { start: number; end: number }) => !taken.some((span) => line.start <= span.end && span.start <= line.end);
  const isUnique = (text: string) => text.trim().length > 0 && uniqueIndex(source, text) >= 0;

  const headingIndex = lines.findIndex((line) => SKILLS_HEADING.test(line.text));
  const skillsText = clean.join(', ');
  const base = { id, section: 'Skills', rationale: 'Added by you: skills you confirmed you have, matching the job’s keywords.', status: 'approved' as const };

  if (headingIndex >= 0) {
    // 1) Append to the line under the heading, or to the heading line itself ("Skills: Python, Go").
    const heading = lines[headingIndex];
    // "Skills: Python, Go" keeps its list on the heading line itself.
    const inline = /^[^:]*:\s*\S/.test(heading.text);
    const target = inline ? heading : lines.slice(headingIndex + 1).find((line) => line.text.trim().length > 0);
    if (target && isFree(target) && isUnique(target.text)) {
      const trimmed = target.text.replace(/\s+$/, '');
      const separator = /[,;|•·]\s*\S/.test(trimmed) ? (trimmed.includes('|') ? ' | ' : trimmed.includes('•') ? ' • ' : ', ') : ', ';
      return { ...base, kind: 'edit', original: trimmed, proposed: `${trimmed.replace(/[.,;]\s*$/, '')}${separator}${clean.join(separator)}` };
    }
    // 2) Insert a new line right after the heading.
    if (isFree(heading) && isUnique(heading.text)) {
      return { ...base, kind: 'addition', original: heading.text.replace(/\s+$/, ''), proposed: skillsText };
    }
  }

  // 3) No usable skills section: add a "Skills:" line after the last free, unique line.
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (isFree(line) && isUnique(line.text)) {
      return { ...base, kind: 'addition', original: line.text.replace(/\s+$/, ''), proposed: `Skills: ${skillsText}` };
    }
  }
  return null;
}
