import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { ResumeChange } from '../tailoring/types';

/* Minimal DOM typings so this file doesn't depend on the browser DOM lib. */
type XNode = {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<XNode>;
  parentNode: XNode | null;
  nextSibling: XNode | null;
  firstChild: XNode | null;
  cloneNode(deep: boolean): XNode;
  removeChild(child: XNode): XNode;
  insertBefore(node: XNode, ref: XNode | null): XNode;
  appendChild(node: XNode): XNode;
  setAttribute(name: string, value: string): void;
  getElementsByTagName(name: string): ArrayLike<XNode>;
};
type XDocument = XNode & { createElementNS(ns: string, name: string): XNode; documentElement: XNode };

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ELEMENT = 1;

const toArray = <T,>(list: ArrayLike<T>) => Array.from({ length: list.length }, (_, index) => list[index]);
const normChar = (ch: string) => (/\s/.test(ch) ? ' ' : ({ '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-' } as Record<string, string>)[ch] ?? ch.toLowerCase());
const normText = (text: string) => text.split('').map(normChar).join('').replace(/ +/g, ' ').trim();

type Segment = { node: XNode | null; text: string };

function descendants(node: XNode, out: XNode[] = []) {
  for (const child of toArray(node.childNodes)) {
    if (child.nodeType !== ELEMENT) continue;
    out.push(child);
    // Don't descend into nested paragraphs (text boxes); they are processed on their own.
    if (child.nodeName !== 'w:p') descendants(child, out);
  }
  return out;
}

/** Text pieces of a paragraph in order: editable <w:t> nodes plus tabs/breaks as spaces. */
function segmentsOf(paragraph: XNode): Segment[] {
  const segments: Segment[] = [];
  for (const element of descendants(paragraph)) {
    if (element.nodeName === 'w:t') segments.push({ node: element, text: element.textContent ?? '' });
    else if (element.nodeName === 'w:tab' || element.nodeName === 'w:br' || element.nodeName === 'w:cr') segments.push({ node: null, text: ' ' });
  }
  return segments;
}

const paragraphText = (paragraph: XNode) => segmentsOf(paragraph).map((segment) => segment.text).join('');

/** Finds `needle` in the paragraph (whitespace/quote/case tolerant) and returns segment positions. */
function locateInParagraph(paragraph: XNode, needle: string) {
  const segments = segmentsOf(paragraph);
  const chars: Array<{ seg: number; offset: number; ch: string }> = [];
  segments.forEach((segment, seg) => { for (let offset = 0; offset < segment.text.length; offset += 1) chars.push({ seg, offset, ch: segment.text[offset] }); });
  // Normalised string with a map back to raw char indices (collapsing whitespace runs).
  let normalized = '';
  const map: number[] = [];
  chars.forEach((entry, index) => {
    const ch = normChar(entry.ch);
    if (ch === ' ' && normalized.endsWith(' ')) return;
    normalized += ch;
    map.push(index);
  });
  const target = normText(needle);
  if (!target) return null;
  const at = normalized.indexOf(target);
  if (at < 0) return null;
  return { segments, chars, start: map[at], end: map[at + target.length - 1] + 1, whole: normText(normalized) === target };
}

function setText(node: XNode, text: string) {
  while (node.firstChild) node.removeChild(node.firstChild);
  const doc = (node as unknown as { ownerDocument: XDocument }).ownerDocument;
  node.appendChild((doc as unknown as { createTextNode(text: string): XNode }).createTextNode(text));
  node.setAttribute('xml:space', 'preserve');
}

/**
 * Replaces raw chars [start, end) of a paragraph. Only the part that actually differs is
 * rewritten (common prefix/suffix are left untouched), so unchanged words keep their own
 * bold/italic/colour formatting; the new text takes the formatting of the first run it touches.
 */
function replaceRange(found: NonNullable<ReturnType<typeof locateInParagraph>>, fullReplacement: string) {
  const { segments, chars } = found;
  let { start, end } = found;
  const raw = chars.slice(start, end).map((entry) => entry.ch).join('');
  let prefix = 0;
  while (prefix < raw.length && prefix < fullReplacement.length && raw[prefix] === fullReplacement[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < raw.length - prefix && suffix < fullReplacement.length - prefix && raw[raw.length - 1 - suffix] === fullReplacement[fullReplacement.length - 1 - suffix]) suffix += 1;
  // Keep whole words: back off to a word boundary so a word isn't split across two formats.
  while (prefix > 0 && /\w/.test(raw[prefix - 1] ?? '') && /\w/.test(raw[prefix] ?? '')) prefix -= 1;
  while (suffix > 0 && /\w/.test(raw[raw.length - suffix] ?? '') && /\w/.test(raw[raw.length - suffix - 1] ?? '')) suffix -= 1;
  const replacement = fullReplacement.slice(prefix, fullReplacement.length - suffix);
  start += prefix;
  end -= suffix;
  if (start === end) {
    if (!replacement) return true;
    // Pure insertion: append to the character just before the insertion point.
    const anchor = start > 0 ? chars[start - 1] : chars[start];
    if (!anchor || !segments[anchor.seg].node) return false;
    const segment = segments[anchor.seg];
    const at = start > 0 ? anchor.offset + 1 : anchor.offset;
    setText(segment.node!, segment.text.slice(0, at) + replacement + segment.text.slice(at));
    return true;
  }
  while (start < end && !segments[chars[start].seg].node) start += 1; // don't start on a tab
  if (start >= end) return false;
  const first = chars[start];
  const last = chars[end - 1];
  for (let seg = first.seg; seg <= last.seg; seg += 1) {
    const segment = segments[seg];
    if (!segment.node) continue;
    const from = seg === first.seg ? first.offset : 0;
    const to = seg === last.seg ? last.offset + 1 : segment.text.length;
    const before = segment.text.slice(0, from);
    const after = segment.text.slice(to);
    setText(segment.node, seg === first.seg ? `${before}${replacement}${seg === last.seg ? after : ''}` : after);
  }
  return true;
}

function isListParagraph(paragraph: XNode) {
  if (toArray(paragraph.getElementsByTagName('w:numPr')).length > 0) return true;
  // Lists can also come from the paragraph style ("List Bullet", "ListParagraph", …).
  const style = toArray(paragraph.getElementsByTagName('w:pStyle'))[0] as unknown as { getAttribute?(name: string): string | null } | undefined;
  return /list|bullet/i.test(style?.getAttribute?.('w:val') ?? '');
}
const BULLET_PREFIX = /^\s*([-•*▪◦●]|\d+[.)])\s+/;
const stripBullet = (text: string) => text.replace(BULLET_PREFIX, '');
/**
 * Word draws bullets for real list paragraphs, so a typed "- " from the AI must be dropped there.
 * But some resumes type the bullet character themselves ("• Built…"); then the text keeps it.
 */
const bulletAware = (paragraph: XNode, text: string) => (isListParagraph(paragraph) && !BULLET_PREFIX.test(paragraphText(paragraph)) ? stripBullet(text) : text);

function isHeadingParagraph(paragraph: XNode) {
  const style = toArray(paragraph.getElementsByTagName('w:pStyle'))[0] as unknown as { getAttribute?(name: string): string | null } | undefined;
  const styleName = style?.getAttribute?.('w:val') ?? '';
  if (/heading|title/i.test(styleName)) return true;
  const text = paragraphText(paragraph).trim();
  const runs = toArray(paragraph.getElementsByTagName('w:r')).filter((run) => (run.textContent ?? '').trim());
  const allBold = runs.length > 0 && runs.every((run) => toArray(run.getElementsByTagName('w:b')).length > 0);
  return text.length > 0 && text.length <= 40 && (allBold || text === text.toUpperCase());
}

/** Clones a paragraph's formatting with new text (first run's formatting kept, other runs dropped). */
function cloneWithText(doc: XDocument, template: XNode, text: string) {
  const clone = template.cloneNode(true);
  const runs = toArray(clone.getElementsByTagName('w:r'));
  const keep = runs.find((run) => toArray(run.getElementsByTagName('w:t')).length > 0) ?? runs[0];
  // Remove everything except paragraph properties and the kept run.
  for (const child of toArray(clone.childNodes)) {
    if (child.nodeType === ELEMENT && child.nodeName !== 'w:pPr' && child !== keep && !(keep && child === keep.parentNode)) clone.removeChild(child);
  }
  let run = keep;
  if (!run) {
    run = doc.createElementNS(W_NS, 'w:r');
    clone.appendChild(run);
  } else if (run.parentNode && run.parentNode !== clone) {
    // Run was inside a hyperlink etc.; lift it out.
    const wrapper = run.parentNode;
    clone.insertBefore(run, wrapper);
    clone.removeChild(wrapper);
  }
  for (const child of toArray(run.childNodes)) {
    if (child.nodeType === ELEMENT && child.nodeName !== 'w:rPr') run.removeChild(child);
  }
  const t = doc.createElementNS(W_NS, 'w:t');
  setText(t, bulletAware(template, text));
  run.appendChild(t);
  return clone;
}

export type DocxEditResult = { file: Uint8Array; applied: number; skipped: string[] };

/**
 * Applies approved changes to the user's original .docx, keeping its fonts, styles, bullets,
 * spacing, margins, headers and footers. Text is replaced inside the existing runs; new lines
 * are cloned from a neighbouring paragraph so they match the surrounding formatting.
 */
export async function applyChangesToDocx(original: ArrayBuffer, changes: ResumeChange[]): Promise<DocxEditResult> {
  const zip = await JSZip.loadAsync(original);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('Not a Word document (word/document.xml missing).');
  const xml = await entry.async('string');
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as XDocument;
  const allParagraphs = () => toArray(doc.getElementsByTagName('w:p'));
  const skipped: string[] = [];
  let applied = 0;

  const findParagraph = (line: string, from = 0) => {
    const list = allParagraphs();
    for (let index = from; index < list.length; index += 1) {
      const found = locateInParagraph(list[index], line);
      if (found) return { paragraph: list[index], index, found };
    }
    return null;
  };

  for (const change of changes.filter((candidate) => candidate.status === 'approved')) {
    const originalLines = change.original.split('\n').filter((line) => line.trim());
    const first = originalLines.length ? findParagraph(originalLines[0]) : null;
    if (!first) { skipped.push(change.id); continue; }

    // Collect the paragraphs covering a multi-line original.
    const covered = [first];
    for (const line of originalLines.slice(1)) {
      const next = findParagraph(line, covered[covered.length - 1].index + 1);
      if (!next) break;
      covered.push(next);
    }
    if (covered.length !== originalLines.length) { skipped.push(change.id); continue; }
    const anchor = covered[covered.length - 1].paragraph;

    if (change.kind === 'addition') {
      let template = anchor;
      if (isHeadingParagraph(anchor)) {
        const list = allParagraphs();
        const following = list.slice(covered[covered.length - 1].index + 1).find((paragraph) => paragraphText(paragraph).trim());
        if (following && !isHeadingParagraph(following)) template = following;
      }
      let after = anchor;
      for (const line of change.proposed.split('\n').filter((candidate) => candidate.trim())) {
        const clone = cloneWithText(doc, template, line);
        after.parentNode!.insertBefore(clone, after.nextSibling);
        after = clone;
      }
      applied += 1;
      continue;
    }

    const proposedLines = change.kind === 'removal' ? [] : change.proposed.split('\n');
    if (covered.length === 1 && proposedLines.length <= 1) {
      const { paragraph, found } = covered[0];
      if (change.kind === 'removal' && found.whole) {
        paragraph.parentNode!.removeChild(paragraph);
      } else {
        const replacement = found.whole ? bulletAware(paragraph, proposedLines[0] ?? '') : (proposedLines[0] ?? '');
        if (!replaceRange(found, replacement)) { skipped.push(change.id); continue; }
      }
      applied += 1;
      continue;
    }

    // Multi-line change: rewrite the covered paragraphs line by line.
    covered.forEach((item, index) => {
      if (index < proposedLines.length) {
        const whole = locateInParagraph(item.paragraph, paragraphText(item.paragraph));
        if (whole) replaceRange(whole, bulletAware(item.paragraph, proposedLines[index]));
      } else {
        item.paragraph.parentNode!.removeChild(item.paragraph);
      }
    });
    let after = anchor.parentNode ? anchor : covered[0].paragraph;
    for (const line of proposedLines.slice(covered.length)) {
      const clone = cloneWithText(doc, covered[covered.length - 1].paragraph, line);
      after.parentNode!.insertBefore(clone, after.nextSibling);
      after = clone;
    }
    applied += 1;
  }

  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc as never));
  const file = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { file, applied, skipped };
}
