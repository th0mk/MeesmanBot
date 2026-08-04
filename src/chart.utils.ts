import { Resvg } from '@resvg/resvg-js';
import type { PriceEntry } from './storage.types.js';
import type { ChartPeriod, PriceChart } from './chart.types.js';

const WIDTH = 520;
const HEIGHT = 220;
const RENDER_SCALE = 2;

const GUTTER_LEFT = 52;
const PADDING_RIGHT = 12;
const PADDING_TOP = 12;
const AXIS_BOTTOM = 26;

const PLOT_LEFT = GUTTER_LEFT;
const PLOT_RIGHT = WIDTH - PADDING_RIGHT;
const PLOT_TOP = PADDING_TOP;
const PLOT_BOTTOM = HEIGHT - AXIS_BOTTOM;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;

const LINE_COLOR = '#68DDE4';
const AXIS_COLOR = '#8B9BA0';
const LABEL_COLOR = '#93A1A6';
const FONT_FAMILY = 'DejaVu Sans, Helvetica, Arial, sans-serif';
const FONT_SIZE = 10.5;

const MAX_Y_TICKS = 10;
const X_TICKS = 5;
const MAX_POINTS = 460;
const DAY_LABEL_MAX_SPAN = 200;

const MIN_SPAN_FRACTION = 0.3;

const NICE_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

const PERIOD_MONTH: ChartPeriod = { id: '30', label: '30 dagen', buttonLabel: '30d', days: 30 };
const PERIOD_QUARTER: ChartPeriod = { id: '90', label: '90 dagen', buttonLabel: '90d', days: 90 };
const PERIOD_YEAR: ChartPeriod = { id: '365', label: '1 jaar', buttonLabel: '1j', days: 365 };
const PERIOD_ALL: ChartPeriod = { id: 'all', label: 'alles', buttonLabel: 'Alles', days: null };

export const CHART_PERIODS = [PERIOD_MONTH, PERIOD_QUARTER, PERIOD_YEAR, PERIOD_ALL];
export const DEFAULT_PERIOD = PERIOD_YEAR;

interface Point {
  x: number;
  y: number;
}

interface Axis {
  min: number;
  max: number;
  step: number;
  decimals: number;
}

export function resolvePeriod(id: string): ChartPeriod {
  for (const period of CHART_PERIODS) {
    if (period.id === id) {
      return period;
    }
  }
  return DEFAULT_PERIOD;
}

function entryDate(entry: PriceEntry): string {
  return entry.priceDate || entry.fetchedAt.slice(0, 10);
}

export function filterByPeriod(history: PriceEntry[], period: ChartPeriod): PriceEntry[] {
  if (period.days === null || history.length === 0) {
    return history;
  }

  const newest = new Date(entryDate(history[history.length - 1])).getTime();
  const cutoff = newest - period.days * 86400000;

  const filtered: PriceEntry[] = [];
  for (const entry of history) {
    if (new Date(entryDate(entry)).getTime() >= cutoff) {
      filtered.push(entry);
    }
  }
  return filtered;
}

function downsample(entries: PriceEntry[], max: number): PriceEntry[] {
  if (entries.length <= max) {
    return entries;
  }

  const sampled: PriceEntry[] = [];
  const step = (entries.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    sampled.push(entries[Math.round(i * step)]);
  }
  return sampled;
}

function spanInDays(entries: PriceEntry[]): number {
  const from = new Date(entryDate(entries[0])).getTime();
  const to = new Date(entryDate(entries[entries.length - 1])).getTime();
  return (to - from) / 86400000;
}

function labelDate(entry: PriceEntry, withDay: boolean): string {
  const raw = entryDate(entry);
  const month = MONTHS[parseInt(raw.slice(5, 7), 10) - 1];
  if (withDay) {
    return `${raw.slice(8, 10)} ${month}`;
  }
  return `${month} '${raw.slice(2, 4)}`;
}

function round(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function decimalsFor(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  return 2;
}

function niceAxis(dataLow: number, dataHigh: number): Axis {
  const middle = (dataLow + dataHigh) / 2;
  const minSpan = middle * MIN_SPAN_FRACTION;

  let lowest = dataLow;
  let highest = dataHigh;
  if (highest - lowest < minSpan) {
    lowest = middle - minSpan / 2;
    highest = middle + minSpan / 2;
  }

  for (const step of NICE_STEPS) {
    const min = round(Math.floor(lowest / step) * step);
    const max = round(Math.ceil(highest / step) * step);
    if (Math.round((max - min) / step) + 1 <= MAX_Y_TICKS) {
      return { min, max, step, decimals: decimalsFor(step) };
    }
  }

  const step = NICE_STEPS[NICE_STEPS.length - 1];
  return {
    min: round(Math.floor(lowest / step) * step),
    max: round(Math.ceil(highest / step) * step),
    step,
    decimals: decimalsFor(step)
  };
}

function toPoints(entries: PriceEntry[], axis: Axis): Point[] {
  const range = axis.max - axis.min;
  const points: Point[] = [];

  for (let i = 0; i < entries.length; i++) {
    const ratio = range === 0 ? 0.5 : (entries[i].price - axis.min) / range;
    points.push({
      x: PLOT_LEFT + (entries.length === 1 ? PLOT_WIDTH / 2 : (i / (entries.length - 1)) * PLOT_WIDTH),
      y: PLOT_TOP + (1 - ratio) * PLOT_HEIGHT
    });
  }
  return points;
}

function buildYAxis(axis: Axis): string {
  const range = axis.max - axis.min;
  const ticks = Math.round(range / axis.step) + 1;
  let svg = '';

  for (let i = 0; i < ticks; i++) {
    const value = round(axis.min + i * axis.step);
    const y = PLOT_TOP + (1 - (value - axis.min) / range) * PLOT_HEIGHT;

    svg += `<line x1="${PLOT_LEFT}" y1="${y.toFixed(2)}" x2="${PLOT_RIGHT}" y2="${y.toFixed(2)}" `
      + `stroke="${AXIS_COLOR}" stroke-width="1" stroke-opacity="0.22"/>`;
    svg += `<text x="${PLOT_LEFT - 7}" y="${(y + 3.5).toFixed(2)}" text-anchor="end" `
      + `fill="${LABEL_COLOR}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}">`
      + `€${value.toFixed(axis.decimals)}</text>`;
  }

  svg += `<line x1="${PLOT_LEFT}" y1="${PLOT_TOP}" x2="${PLOT_LEFT}" y2="${PLOT_BOTTOM}" `
    + `stroke="${AXIS_COLOR}" stroke-width="1" stroke-opacity="0.45"/>`;
  return svg;
}

function buildXAxis(entries: PriceEntry[], points: Point[]): string {
  let svg = `<line x1="${PLOT_LEFT}" y1="${PLOT_BOTTOM}" x2="${PLOT_RIGHT}" y2="${PLOT_BOTTOM}" `
    + `stroke="${AXIS_COLOR}" stroke-width="1" stroke-opacity="0.45"/>`;

  const withDay = spanInDays(entries) <= DAY_LABEL_MAX_SPAN;
  const ticks = Math.min(X_TICKS, entries.length);
  const used = new Set<string>();

  for (let i = 0; i < ticks; i++) {
    const index = ticks === 1 ? 0 : Math.round((i / (ticks - 1)) * (entries.length - 1));
    const label = labelDate(entries[index], withDay);
    if (used.has(label)) {
      continue;
    }
    used.add(label);

    const x = points[index].x;
    const anchor = index === 0 ? 'start' : index === entries.length - 1 ? 'end' : 'middle';

    svg += `<line x1="${x.toFixed(2)}" y1="${PLOT_BOTTOM}" x2="${x.toFixed(2)}" y2="${PLOT_BOTTOM + 4}" `
      + `stroke="${AXIS_COLOR}" stroke-width="1" stroke-opacity="0.45"/>`;
    svg += `<text x="${x.toFixed(2)}" y="${PLOT_BOTTOM + 16}" text-anchor="${anchor}" `
      + `fill="${LABEL_COLOR}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}">`
      + `${label}</text>`;
  }
  return svg;
}

function buildSvg(entries: PriceEntry[]): string {
  let lowest = entries[0].price;
  let highest = entries[0].price;
  for (const entry of entries) {
    if (entry.price < lowest) lowest = entry.price;
    if (entry.price > highest) highest = entry.price;
  }

  const axis = niceAxis(lowest, highest);
  const points = toPoints(entries, axis);

  let line = '';
  for (let i = 0; i < points.length; i++) {
    const command = i === 0 ? 'M' : 'L';
    line += `${command}${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const area = `${line}L${last.x.toFixed(2)} ${PLOT_BOTTOM}L${first.x.toFixed(2)} ${PLOT_BOTTOM}Z`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`
    + '<defs>'
    + '<linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">'
    + `<stop offset="0%" stop-color="${LINE_COLOR}" stop-opacity="0.35"/>`
    + `<stop offset="100%" stop-color="${LINE_COLOR}" stop-opacity="0.02"/>`
    + '</linearGradient>'
    + '</defs>'
    + buildYAxis(axis)
    + `<path d="${area}" fill="url(#fill)"/>`
    + `<path d="${line}" fill="none" stroke="${LINE_COLOR}" stroke-width="2.5" `
    + 'stroke-linejoin="round" stroke-linecap="round"/>'
    + `<circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="4.5" fill="${LINE_COLOR}"/>`
    + buildXAxis(entries, points)
    + '</svg>';
}

export function createPriceChart(history: PriceEntry[]): PriceChart | null {
  if (history.length < 2) {
    return null;
  }

  const entries = downsample(history, MAX_POINTS);
  const resvg = new Resvg(buildSvg(entries), {
    fitTo: { mode: 'width', value: WIDTH * RENDER_SCALE },
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' }
  });

  return {
    png: resvg.render().asPng(),
    fileName: `koersverloop-${entries[entries.length - 1].fundType}.png`
  };
}
