import JSZip from 'jszip';
import { wordFontName, type PageSize, type StyledLine } from './styled';

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const twips = (points: number) => Math.max(0, Math.round(points * 20));

function paragraphXml(line: StyledLine) {
  const font = escapeXml(wordFontName(line));
  const jc = line.align === 'center' ? 'center' : line.align === 'right' ? 'right' : 'left';
  const pPr = `<w:pPr><w:spacing w:before="${twips(line.gapBefore)}" w:after="0" w:line="${Math.round(line.size * 1.2 * 20)}" w:lineRule="atLeast"/>${line.indent > 0 ? `<w:ind w:left="${twips(line.indent)}"/>` : ''}<w:jc w:val="${jc}"/></w:pPr>`;
  if (!line.text.trim()) return `<w:p>${pPr}</w:p>`;
  const rPr = `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>${line.bold ? '<w:b/>' : ''}${line.italic ? '<w:i/>' : ''}<w:sz w:val="${Math.round(line.size * 2)}"/><w:szCs w:val="${Math.round(line.size * 2)}"/></w:rPr>`;
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(line.text)}</w:t></w:r></w:p>`;
}

/** Builds a .docx that reproduces the captured layout: fonts, sizes, weight, alignment, indents, spacing, page size. */
export async function generateDocx(lines: StyledLine[], page: PageSize): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const margin = twips(page.marginLeft);
  const top = twips(page.marginTop);
  const body = lines.map(paragraphXml).join('');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="${twips(page.width)}" w:h="${twips(page.height)}"/><w:pgMar w:top="${top}" w:right="${margin}" w:bottom="${top}" w:left="${margin}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
