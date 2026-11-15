import type { AnalysisRecord, Store, StoredDocument } from '../server/store';
import { applyChangesToDocx } from './docx-edit';
import { generateDocx } from './docx-generate';
import { A4, styleFinalDocument, stylesForSource, type PageSize, type StyledLine } from './styled';

export type SourceFormat = 'docx' | 'pdf' | 'text';

export type FormattedExport = {
  sourceFormat: SourceFormat;
  originalName: string | null;
  styled: StyledLine[];
  page: PageSize;
};

const formatOf = (document: StoredDocument | null): SourceFormat => {
  if (!document) return 'text';
  if (document.mimeType === 'application/pdf') return 'pdf';
  if (document.mimeType.includes('wordprocessingml')) return 'docx';
  return 'text';
};

async function loadDocument(store: Store, analysis: AnalysisRecord) {
  if (!analysis.resumeDocumentId) return null;
  return store.getDocument(analysis.resumeDocumentId).catch(() => null);
}

/** Styled lines of the final resume, inheriting the uploaded file's fonts, sizes and spacing. */
export async function buildFormattedExport(store: Store, analysis: AnalysisRecord, finalText: string): Promise<FormattedExport> {
  const document = await loadDocument(store, analysis);
  const sourceStyles = stylesForSource(analysis.source.split('\n'), document?.layout?.lines);
  return {
    sourceFormat: formatOf(document),
    originalName: document?.name ?? null,
    styled: styleFinalDocument(analysis.source, finalText, sourceStyles),
    page: document?.layout?.page ?? A4,
  };
}

/**
 * The downloadable Word file. For a .docx upload this is the user's own file with the approved
 * changes applied in place (all formatting kept); otherwise it is generated from the captured layout.
 */
export async function buildWordFile(store: Store, analysis: AnalysisRecord, finalText: string) {
  const document = await loadDocument(store, analysis);
  if (document && formatOf(document) === 'docx') {
    const bytes = await store.downloadDocument(document).catch(() => null);
    if (bytes) {
      try {
        const result = await applyChangesToDocx(bytes, analysis.changes);
        return { file: result.file, preserved: true, skipped: result.skipped.length };
      } catch (error) {
        console.error('[export] could not edit the original .docx; generating instead', error);
      }
    }
  }
  const formatted = await buildFormattedExport(store, analysis, finalText);
  return { file: await generateDocx(formatted.styled, formatted.page), preserved: false, skipped: 0 };
}
