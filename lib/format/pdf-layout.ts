import type { DocumentLayout, LineStyle, StyledLine } from './styled';

type TextItem = { str: string; transform: number[]; width: number; height: number; fontName: string };

const familyOf = (fontName: string, generic?: string): LineStyle['family'] => {
  if (/courier|mono|consolas|menlo/i.test(fontName) || generic === 'monospace') return 'mono';
  if (/times|garamond|georgia|cambria|serif|minion|palatino|book ?antiqua|baskerville/i.test(fontName.replace(/sans/i, '')) || generic === 'serif') return 'serif';
  return 'sans';
};

/**
 * Reads the visual layout of a PDF resume: each text line with its font size, weight, family,
 * alignment, indent and spacing, plus the page size and margins. Used to reproduce the
 * uploaded design when rendering the tailored resume.
 */
export async function extractPdfLayout(bytes: ArrayBuffer, maxPages = 4): Promise<DocumentLayout | null> {
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  } catch { /* use default */ }

  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  try {
    const lines: StyledLine[] = [];
    let pageWidth = 595.28;
    let pageHeight = 841.89;
    let minX = Infinity;
    let maxTop = 0;

    for (let pageNumber = 1; pageNumber <= Math.min(doc.numPages, maxPages); pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      pageWidth = viewport.width;
      pageHeight = viewport.height;
      await page.getOperatorList(); // loads fonts so their real names are available
      const content = await page.getTextContent();
      const items = (content.items as TextItem[]).filter((item) => typeof item.str === 'string' && item.str.trim().length > 0);

      const fontInfo = (fontName: string) => {
        let real = '';
        try { real = (page.commonObjs.get(fontName) as { name?: string } | undefined)?.name ?? ''; } catch { /* not loaded */ }
        const generic = (content.styles as Record<string, { fontFamily?: string }>)[fontName]?.fontFamily;
        const clean = real.replace(/^[A-Z]{6}\+/, '');
        return {
          name: clean,
          bold: /bold|black|heavy|semibold|demi/i.test(clean),
          italic: /italic|oblique/i.test(clean),
          family: familyOf(clean, generic),
        };
      };

      // Group items into lines by baseline.
      const rows: Array<{ y: number; items: TextItem[] }> = [];
      for (const item of items) {
        const y = item.transform[5];
        const size = Math.abs(item.transform[3]) || item.height;
        const row = rows.find((candidate) => Math.abs(candidate.y - y) <= Math.max(2, size * 0.35));
        if (row) row.items.push(item); else rows.push({ y, items: [item] });
      }
      rows.sort((a, b) => b.y - a.y);

      let previousBottom: number | null = null;
      for (const row of rows) {
        row.items.sort((a, b) => a.transform[4] - b.transform[4]);
        let text = '';
        let lastEnd: number | null = null;
        for (const item of row.items) {
          const x = item.transform[4];
          if (lastEnd !== null && x - lastEnd > 1.5 && !text.endsWith(' ') && !item.str.startsWith(' ')) text += ' ';
          text += item.str;
          lastEnd = x + item.width;
        }
        // Style of the line = style of its longest run.
        const main = row.items.reduce((best, item) => (item.str.length > best.str.length ? item : best), row.items[0]);
        const info = fontInfo(main.fontName);
        const size = Math.round((Math.abs(main.transform[3]) || main.height) * 2) / 2;
        const left = row.items[0].transform[4];
        const right = lastEnd ?? left;
        const top = pageHeight - row.y - size;
        minX = Math.min(minX, left);
        if (pageNumber === 1) maxTop = Math.max(maxTop, 0);
        const gap = previousBottom === null ? 0 : Math.max(0, top - previousBottom);
        previousBottom = pageHeight - row.y + size * 0.25;
        const center = (left + right) / 2;
        const align: LineStyle['align'] = Math.abs(center - pageWidth / 2) < pageWidth * 0.04 && right - left < pageWidth * 0.8 && left > pageWidth * 0.12
          ? 'center'
          : right > pageWidth * 0.85 && left > pageWidth * 0.5 ? 'right' : 'left';
        lines.push({ text: text.replace(/\s+/g, ' ').trim(), size, bold: info.bold, italic: info.italic, family: info.family, font: info.name || undefined, align, indent: left, gapBefore: Math.round(gap * 10) / 10 });
      }
      previousBottom = null;
      page.cleanup();
    }
    if (lines.length === 0) return null;
    const marginLeft = Number.isFinite(minX) ? Math.max(18, Math.min(minX, 108)) : 54;
    const firstTop = lines.length ? 0 : 0;
    return {
      page: { width: pageWidth, height: pageHeight, marginLeft, marginTop: Math.max(18, Math.min(72, marginLeft + firstTop)) },
      lines: lines.map((line) => ({ ...line, indent: line.align === 'left' ? Math.max(0, Math.round((line.indent - marginLeft) * 10) / 10) : 0, gapBefore: Math.min(line.gapBefore, 40) })),
    };
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
