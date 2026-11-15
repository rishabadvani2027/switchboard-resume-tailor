/**
 * Transparent, deterministic ATS-style match score (0–100) for a resume against a job.
 *
 * Applicant tracking systems mostly do literal keyword matching plus basic parsing checks, so
 * the score is computed from the resume text itself — never by the AI — and the same inputs
 * always give the same number. Weights:
 *   Keywords from the job      70   share of the job's important keywords found in the resume
 *   Standard sections          10   summary, experience, skills, education
 *   Job title alignment         5   the target role's title words appear
 *   Measurable results          5   bullets that contain numbers
 *   Contact details             5   email and phone
 *   Length                      5   roughly one to two pages of text
 */

export type AtsCheck = { label: string; points: number; max: number; detail: string };
export type AtsScore = { score: number; checks: AtsCheck[]; matched: string[]; missing: string[] };

const STOPWORDS = new Set(('a about above across after again against all also am an and any are as at be because been before being between both but by can could did do does doing down during each either etc ever every few for from further had has have having he her here hers him his how i if in into is it its itself just least less like made make many may me might more most must my no nor not of off on once only or other our ours out over own per same she should so some such than that the their them then there these they this those through to too under until up upon us very via was we were what when where which while who whom why will with within without would you your yours ' +
  'ability able across activities apply based benefits candidate candidates company culture day days environment excellent experience experienced global good great help ideal including job join looking new opportunity plus position preferred required requirements responsibilities role skills strong team teams work working years year using use well within strong across').split(' '));

const normalize = (text: string) => text.toLowerCase()
  .replace(/[‘’]/g, "'").replace(/[–—]/g, '-')
  .replace(/[^a-z0-9+#./\s-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the keyword (or all of its significant words) appears in the text. */
export function containsKeyword(normalizedText: string, keyword: string) {
  const phrase = normalize(keyword);
  if (!phrase) return false;
  const boundary = (word: string) => new RegExp(`(^|[^a-z0-9+#])${escapeRegex(word)}(?=$|[^a-z0-9+#])`);
  if (boundary(phrase).test(normalizedText)) return true;
  const words = phrase.split(/[\s/-]+/).filter((word) => word.length >= 3 && !STOPWORDS.has(word));
  if (words.length < 2) return false;
  return words.every((word) => boundary(word).test(normalizedText) || (word.endsWith('s') && boundary(word.slice(0, -1)).test(normalizedText)));
}

/** Fallback keyword extraction from the job description when the AI didn't provide a list. */
export function extractJobKeywords(jobDescription: string, limit = 20): string[] {
  const counts = new Map<string, number>();
  for (const word of normalize(jobDescription).split(' ')) {
    const clean = word.replace(/^[^a-z0-9+#]+|[^a-z0-9+#]+$/g, '');
    if (clean.length < 3 || STOPWORDS.has(clean) || /^\d+$/.test(clean)) continue;
    counts.set(clean, (counts.get(clean) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([word]) => word);
}

/** The keyword set used for scoring: the AI's matched + missing lists, de-duplicated. */
export function jobKeywords(jobDescription: string, insights?: { matchedKeywords?: string[]; missingKeywords?: string[] }) {
  const fromAi = [...(insights?.matchedKeywords ?? []), ...(insights?.missingKeywords ?? [])]
    .map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 1 && keyword.length <= 60);
  const seen = new Set<string>();
  const unique = fromAi.filter((keyword) => { const key = normalize(keyword); if (!key || seen.has(key)) return false; seen.add(key); return true; });
  return unique.length >= 5 ? unique.slice(0, 30) : extractJobKeywords(jobDescription);
}

const SECTION_PATTERNS: Array<[string, RegExp]> = [
  ['Summary', /^\s*(professional\s+)?(summary|profile|objective|about( me)?)\b/im],
  ['Experience', /^\s*(work\s+|professional\s+)?(experience|employment|work history)\b/im],
  ['Skills', /^\s*(technical\s+|core\s+|key\s+)?(skills|competencies|technologies|tech stack)\b/im],
  ['Education', /^\s*(education|academic|qualifications|degrees?)\b/im],
];

export function scoreResume(resume: string, jobDescription: string, keywords: string[]): AtsScore {
  const text = normalize(resume);
  const checks: AtsCheck[] = [];

  const matched = keywords.filter((keyword) => containsKeyword(text, keyword));
  const missing = keywords.filter((keyword) => !matched.includes(keyword));
  const keywordPoints = keywords.length ? (matched.length / keywords.length) * 70 : 70;
  checks.push({ label: 'Job keywords', points: keywordPoints, max: 70, detail: `${matched.length} of ${keywords.length} found` });

  const sections = SECTION_PATTERNS.filter(([, pattern]) => pattern.test(resume)).map(([name]) => name);
  checks.push({ label: 'Standard sections', points: (sections.length / SECTION_PATTERNS.length) * 10, max: 10, detail: sections.length ? `${sections.join(', ')}` : 'No standard headings found' });

  const titleLine = jobDescription.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  const titleWords = normalize(titleLine.split(/[—–|,(:]| - | at /)[0]).split(' ').filter((word) => word.length >= 3 && !STOPWORDS.has(word)).slice(0, 4);
  const titleHits = titleWords.filter((word) => containsKeyword(text, word)).length;
  checks.push({ label: 'Job title alignment', points: titleWords.length ? (titleHits / titleWords.length) * 5 : 5, max: 5, detail: titleWords.length ? `${titleHits} of ${titleWords.length} title words` : 'No title detected' });

  const bullets = resume.split('\n').map((line) => line.trim()).filter((line) => /^([-•*▪◦]|\d+\.)\s+/.test(line) || line.split(' ').length >= 8);
  const quantified = bullets.filter((line) => /\d/.test(line.replace(/\b(19|20)\d{2}\b/g, ''))).length;
  const metricRatio = bullets.length ? Math.min(1, quantified / Math.max(3, bullets.length * 0.4)) : 0;
  checks.push({ label: 'Measurable results', points: metricRatio * 5, max: 5, detail: `${quantified} bullet${quantified === 1 ? '' : 's'} with numbers` });

  const hasEmail = /[\w.+-]+@[\w-]+\.[\w.]+/.test(resume);
  const hasPhone = /(\+?\d[\d\s().-]{7,}\d)/.test(resume);
  checks.push({ label: 'Contact details', points: (hasEmail ? 3 : 0) + (hasPhone ? 2 : 0), max: 5, detail: [hasEmail ? 'email' : 'no email', hasPhone ? 'phone' : 'no phone'].join(', ') });

  const words = resume.split(/\s+/).filter(Boolean).length;
  const lengthPoints = words >= 250 && words <= 1000 ? 5 : words >= 150 && words <= 1300 ? 3 : 1;
  checks.push({ label: 'Length', points: lengthPoints, max: 5, detail: `${words} words` });

  const score = Math.round(checks.reduce((sum, check) => sum + check.points, 0));
  return { score: Math.max(0, Math.min(100, score)), checks: checks.map((check) => ({ ...check, points: Math.round(check.points * 10) / 10 })), matched, missing };
}
