// A minimal .xlsx writer for the Admissions Office exports. A CSV cannot carry a
// title block, column widths, a frozen header, colour, or a second sheet, and the
// project deliberately takes no spreadsheet dependency, so this module writes the
// handful of OOXML parts Excel needs and wraps them in a store-only ZIP (no
// compression, so no inflate library either). It supports exactly what the
// applicant summary uses: text, number, and date cells in a fixed set of named
// styles, merged cells, column widths, row heights, a frozen pane, an AutoFilter,
// and landscape fit-to-width printing.

const encoder = new TextEncoder();

// --- ZIP (store method) ------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const dosDateTime = (date) => ({
  time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  day: ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
});

const buildZip = (files, now = new Date()) => {
  const { time, day } = dosDateTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;
  files.forEach(({ name, bytes }) => {
    const nameBytes = encoder.encode(name);
    const crc = crc32(bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 file names
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    locals.push(new Uint8Array(local.buffer), nameBytes, bytes);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(12, time, true);
    central.setUint16(14, day, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, bytes.length, true);
    central.setUint32(24, bytes.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), nameBytes);
    offset += 30 + nameBytes.length + bytes.length;
  });
  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let cursor = 0;
  parts.forEach((part) => {
    out.set(part, cursor);
    cursor += part.length;
  });
  return out;
};

// --- XML helpers -------------------------------------------------------------

// XML 1.0 forbids most control characters, so they are dropped rather than escaped.
const stripControlCharacters = (text) => Array.from(text)
  .filter((char) => {
    const code = char.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || code >= 32;
  })
  .join('');

const xmlEscape = (value) => stripControlCharacters(String(value ?? ''))
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export const columnName = (index) => {
  let name = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
};

// --- Styles ------------------------------------------------------------------

// The named cell styles a caller can use; each maps to a `cellXfs` entry below.
export const XLSX_STYLES = {
  default: 0,
  title: 1,
  metaLabel: 2,
  metaValue: 3,
  header: 4,
  text: 5,
  integer: 6,
  date: 7,
  number: 8,
  good: 9,
  bad: 10,
  pending: 11,
  note: 12,
  heading: 13,
  na: 14,
};

const buildStylesXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="d\\ mmm\\ yyyy"/></numFmts>
<fonts count="8">
<font><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF5B6472"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF006100"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF9C0006"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF7A4A00"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="7">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0B2E6B"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF8"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFEB9C"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFC8D6"/></left><right style="thin"><color rgb="FFBFC8D6"/></right><top style="thin"><color rgb="FFBFC8D6"/></top><bottom style="thin"><color rgb="FFBFC8D6"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" indent="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" indent="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="6" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="7" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// --- Worksheets --------------------------------------------------------------

// A cell is a bare string or number, or `{ value, type, style }` with `type` one
// of 'text' | 'number' | 'date' (an Excel date serial). A null or empty value
// leaves the cell blank but still carries its style, so borders stay continuous.
const normalizeCell = (cell) => {
  const spec = cell && typeof cell === 'object' && !Array.isArray(cell) ? cell : { value: cell };
  const empty = spec.value == null || spec.value === '';
  const type = spec.type || (typeof spec.value === 'number' ? 'number' : 'text');
  return { ...spec, empty, type, style: XLSX_STYLES[spec.style] ?? XLSX_STYLES.default };
};

const buildCellXml = (cell, reference) => {
  const { empty, type, style, value } = normalizeCell(cell);
  const styleAttr = style ? ` s="${style}"` : '';
  if (empty || (type !== 'text' && !Number.isFinite(Number(value)))) return `<c r="${reference}"${styleAttr}/>`;
  if (type === 'text') return `<c r="${reference}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  return `<c r="${reference}"${styleAttr}><v>${Number(value)}</v></c>`;
};

const buildSheetXml = (sheet) => {
  const rows = sheet.rows || [];
  const widthOf = (index) => sheet.columnWidths?.[index];
  const lastColumn = Math.max(1, ...rows.map((row) => row.length));
  const lastRow = Math.max(1, rows.length);
  const freeze = sheet.freeze;
  const pane = freeze
    ? `<pane ${freeze.column ? `xSplit="${freeze.column}" ` : ''}ySplit="${freeze.row}" topLeftCell="${columnName(freeze.column || 0)}${freeze.row + 1}" activePane="${freeze.column ? 'bottomRight' : 'bottomLeft'}" state="frozen"/>`
    : '';
  const cols = Array.from({ length: lastColumn }, (_, index) => (
    widthOf(index) ? `<col min="${index + 1}" max="${index + 1}" width="${widthOf(index)}" customWidth="1"/>` : ''
  )).join('');
  const body = rows.map((row, rowIndex) => {
    const height = sheet.rowHeights?.[rowIndex + 1];
    const cells = row.map((cell, columnIndex) => buildCellXml(cell, `${columnName(columnIndex)}${rowIndex + 1}`)).join('');
    return `<row r="${rowIndex + 1}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells}</row>`;
  }).join('');
  const merges = (sheet.merges || []).length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((range) => `<mergeCell ref="${range}"/>`).join('')}</mergeCells>`
    : '';
  const filter = sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${columnName(lastColumn - 1)}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"${sheet.selected ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${body}</sheetData>
${filter}${merges}
<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
};

// Sheet names are limited to 31 characters and exclude : \ / ? * [ ].
const sheetName = (name, index) => (String(name || `Sheet${index + 1}`).replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || `Sheet${index + 1}`);

// Builds the workbook bytes from `[{ name, rows, columnWidths, rowHeights, merges,
// freeze: { row, column? }, autoFilter }]`. The first sheet opens selected.
export const buildXlsx = (sheets = [], now = new Date()) => {
  const list = sheets.map((sheet, index) => ({ ...sheet, name: sheetName(sheet.name, index), selected: index === 0 }));
  const definedNames = list
    .map((sheet, index) => (sheet.autoFilter
      ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">'${sheet.name.replace(/'/g, "''")}'!${sheet.autoFilter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>`
      : ''))
    .join('');
  const files = [
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${list.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>${definedNames ? `<definedNames>${definedNames}</definedNames>` : ''}</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', text: buildStylesXml() },
    ...list.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, text: buildSheetXml(sheet) })),
  ].map(({ name, text }) => ({ name, bytes: encoder.encode(text) }));
  return buildZip(files, now);
};

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Saves bytes in the browser under `fileName`.
export const downloadBytes = (bytes, fileName, type = XLSX_MIME_TYPE) => {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
