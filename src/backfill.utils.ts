import { inflateRawSync } from 'node:zlib';
import { FUNDS } from './scraper.js';
import type { FundType } from './scraper.types.js';
import type { HistoricalPrice } from './backfill.types.js';

/**
 * Meesman publishes every trading price since 2015 as a spreadsheet linked from
 * the fund pages. The columns are labelled with the fund names below; the "B"
 * share class and the closed funds are deliberately left out.
 */
const COLUMN_HEADINGS: Record<string, FundType> = {
  'Aandelen Wereldwijd Totaal A': 'wereldwijd',
  'Aandelen Verantwoorde Toekomst': 'verantwoord'
};

const DATE_HEADING = 'datum';
const SPREADSHEET_LINK = /href="([^"]*handelskoersen[^"]*\.xlsx)"/i;

// Excel counts days from 1900-01-01 but also counts a 1900-02-29 that never
// existed, so the usable epoch is two days before that.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

// Guards against reading a stray number as a date. Covers 2010 through 2065.
const MIN_SERIAL = 40000;
const MAX_SERIAL = 60000;

// === Zip reading ===
//
// An .xlsx is a zip of XML parts, and we only need two of them. Reading the
// central directory (rather than the local headers) keeps this correct no
// matter which tool wrote the file.

function findCentralDirectory(zip: Buffer): number {
  const EOCD_SIZE = 22;
  const MAX_COMMENT = 0xffff;
  const earliest = Math.max(0, zip.length - EOCD_SIZE - MAX_COMMENT);

  for (let offset = zip.length - EOCD_SIZE; offset >= earliest; offset--) {
    if (zip.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error('Not a zip file: no end-of-central-directory record');
}

export function readZipEntry(zip: Buffer, name: string): string {
  const eocd = findCentralDirectory(zip);
  const total = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < total; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Corrupt zip: bad central directory signature');
    }

    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);

    if (zip.toString('utf8', offset + 46, offset + 46 + nameLength) === name) {
      // The local header repeats the name and extra fields with its own lengths.
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = zip.subarray(start, start + compressedSize);

      if (method !== 0 && method !== 8) {
        throw new Error(`Unsupported zip compression method ${method} for ${name}`);
      }
      return (method === 0 ? Buffer.from(data) : inflateRawSync(data)).toString('utf8');
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`The spreadsheet does not contain ${name}`);
}

// === Sheet parsing ===

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, '&');
}

export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>(.*?)<\/si>/gs)].map(entry =>
    decodeEntities([...entry[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(part => part[1]).join(''))
  );
}

function isRed(color: string | undefined): boolean {
  if (!color) {
    return false;
  }
  // Colours are ARGB ("FFFF0000") or plain RGB. Anything strongly red-dominant
  // counts, so a darker red would be caught too.
  const rgb = color.length === 8 ? color.slice(2) : color;
  const [red, green, blue] = [0, 2, 4].map(at => parseInt(rgb.slice(at, at + 2), 16));
  return red >= 0x99 && green <= 0x66 && blue <= 0x66;
}

/**
 * Meesman marks dividend payouts in red in the same columns as the prices, and
 * says so in the sheet's own header note. This resolves which cell styles use a
 * red font so those cells can be skipped — reading the colour rather than
 * hardcoding style numbers, which shift whenever the sheet is re-saved.
 */
export function parseRedStyles(xml: string): Set<number> {
  const fonts = xml.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/);
  const cellXfs = xml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!fonts || !cellXfs) {
    return new Set();
  }

  const redFonts = new Set<number>();
  [...fonts[1].matchAll(/<font>([\s\S]*?)<\/font>/g)].forEach((font, index) => {
    if (isRed(font[1].match(/<color[^>]*rgb="([0-9A-Fa-f]+)"/)?.[1])) {
      redFonts.add(index);
    }
  });

  const redStyles = new Set<number>();
  [...cellXfs[1].matchAll(/<xf [^>]*?\/?>/g)].forEach((xf, index) => {
    const fontId = xf[0].match(/fontId="(\d+)"/);
    if (fontId && redFonts.has(parseInt(fontId[1], 10))) {
      redStyles.add(index);
    }
  });

  return redStyles;
}

/**
 * Returns one map of column letter to cell value per non-empty row. Cells that
 * carry no value — the gaps where a fund did not exist yet — are left out, so
 * callers should treat a missing column as "no price that day". Red cells are
 * dropped as dividends, which empties out the dividend rows entirely.
 */
export function parseSheetRows(xml: string, sharedStrings: string[], redStyles: Set<number>): Map<string, string>[] {
  const rows: Map<string, string>[] = [];

  for (const row of xml.matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
    const cells = new Map<string, string>();

    // Excluding "/" from the attributes makes self-closing (empty) cells fail
    // to match, rather than swallowing the following cell's value.
    for (const cell of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>/]*)>(.*?)<\/c>/gs)) {
      const value = cell[3].match(/<v>([^<]*)<\/v>/);
      if (!value) {
        continue;
      }

      const style = cell[2].match(/\bs="(\d+)"/);
      if (style && redStyles.has(parseInt(style[1], 10))) {
        continue;
      }

      const isSharedString = /\bt="s"/.test(cell[2]);
      cells.set(cell[1], isSharedString ? sharedStrings[parseInt(value[1], 10)] ?? '' : decodeEntities(value[1]));
    }

    if (cells.size > 0) {
      rows.push(cells);
    }
  }
  return rows;
}

export function excelSerialToDate(serial: number): string {
  return new Date(EXCEL_EPOCH + Math.round(serial) * 86400000).toISOString().slice(0, 10);
}

/**
 * Reads the "Handelskoersen" sheet into one entry per fund per trading day,
 * oldest first. The sheet lists newest first and leaves a column blank for
 * every day a fund was not yet trading.
 */
export function parseSpreadsheet(xlsx: Buffer): HistoricalPrice[] {
  const sharedStrings = parseSharedStrings(readZipEntry(xlsx, 'xl/sharedStrings.xml'));
  const redStyles = parseRedStyles(readZipEntry(xlsx, 'xl/styles.xml'));
  const rows = parseSheetRows(readZipEntry(xlsx, 'xl/worksheets/sheet1.xml'), sharedStrings, redStyles);

  const headerRow = rows.findIndex(row =>
    [...row.values()].some(value => COLUMN_HEADINGS[value.trim()] !== undefined)
  );
  if (headerRow === -1) {
    throw new Error('No fund columns found — the spreadsheet layout changed');
  }

  const fundColumns = new Map<string, FundType>();
  let dateColumn: string | null = null;

  for (const [column, value] of rows[headerRow]) {
    const fundType = COLUMN_HEADINGS[value.trim()];
    if (fundType) {
      fundColumns.set(column, fundType);
    }
    if (value.trim().toLowerCase() === DATE_HEADING) {
      dateColumn = column;
    }
  }

  if (!dateColumn) {
    throw new Error('No "datum" column found — the spreadsheet layout changed');
  }
  for (const fundType of Object.values(COLUMN_HEADINGS)) {
    if (![...fundColumns.values()].includes(fundType)) {
      throw new Error(`No column found for ${fundType} — the spreadsheet layout changed`);
    }
  }

  const prices: HistoricalPrice[] = [];

  for (const row of rows.slice(headerRow + 1)) {
    const serial = Number(row.get(dateColumn));
    if (!Number.isFinite(serial) || serial < MIN_SERIAL || serial > MAX_SERIAL) {
      continue;
    }
    const priceDate = excelSerialToDate(serial);

    for (const [column, fundType] of fundColumns) {
      const price = Number(row.get(column));
      if (Number.isFinite(price) && price > 0) {
        prices.push({ fundType, price: Math.round(price * 10000) / 10000, priceDate });
      }
    }
  }

  return prices.reverse();
}

// === Fetching ===

/**
 * The spreadsheet lives under a generated /media/<id>/ path that changes when
 * Meesman republishes it, so the link is read off the fund page each time.
 */
export async function findSpreadsheetUrl(): Promise<string> {
  const { url } = FUNDS.wereldwijd;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const link = (await response.text()).match(SPREADSHEET_LINK);
  if (!link) {
    throw new Error(`No "handelskoersen" spreadsheet link found on ${url}`);
  }
  return new URL(link[1], url).href;
}

export async function fetchHistoricalPrices(): Promise<HistoricalPrice[]> {
  const url = await findSpreadsheetUrl();
  console.log(`Downloading ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download the spreadsheet: ${response.status}`);
  }
  return parseSpreadsheet(Buffer.from(await response.arrayBuffer()));
}
