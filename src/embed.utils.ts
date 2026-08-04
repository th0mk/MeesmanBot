import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder
} from 'discord.js';
import { FUNDS, calculatePercentageChange } from './scraper.js';
import { createPriceChart, filterByPeriod, resolvePeriod, CHART_PERIODS } from './chart.utils.js';
import { getFullPriceHistory, getPriceHistory, getPriceStats } from './storage.js';
import type { FundData, FundType } from './scraper.types.js';
import type { PriceEntry, PriceStats } from './storage.types.js';
import type { PriceChart } from './chart.types.js';
import type { TrendButton, TrendVariant, TrendView } from './embed.types.js';

const MEESMAN_COLOR = 0x68DDE4;
const BUTTON_PREFIX = 'verloop';

export interface TrendMessage {
  components: ContainerBuilder[];
  files: AttachmentBuilder[];
}

function trendIcon(change: number): string {
  if (change > 0) return '📈';
  if (change < 0) return '📉';
  return '';
}

function iconPrefix(change: number): string {
  const icon = trendIcon(change);
  return icon ? `${icon} ` : '';
}

function entryTimestamp(entry: PriceEntry): number {
  const dateStr = entry.priceDate || entry.fetchedAt.split('T')[0];
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

function buildPriceChart(entries: PriceEntry[]): PriceChart | null {
  try {
    return createPriceChart(entries);
  } catch (err) {
    console.error('Failed to render price chart:', (err as Error).message);
    return null;
  }
}

export function chartAttachment(chart: PriceChart): AttachmentBuilder {
  return new AttachmentBuilder(chart.png, { name: chart.fileName });
}

export function trendFiles(trend: TrendView | null): AttachmentBuilder[] {
  if (!trend || !trend.chart) {
    return [];
  }
  return [chartAttachment(trend.chart)];
}

export function buildTrendView(fundType: FundType, periodId: string, variant: TrendVariant): TrendView | null {
  const history = getFullPriceHistory(fundType);
  if (history.length < 2) {
    return null;
  }

  const period = resolvePeriod(periodId);
  const entries = filterByPeriod(history, period);

  return { fundType, entries, chart: buildPriceChart(entries), period, variant };
}

export function parseTrendButton(customId: string): TrendButton | null {
  const parts = customId.split(':');
  if (parts.length !== 4 || parts[0] !== BUTTON_PREFIX) {
    return null;
  }

  const fundType = parts[1] as FundType;
  if (!FUNDS[fundType]) {
    return null;
  }

  return {
    fundType,
    periodId: parts[2],
    variant: parts[3] === 'status' ? 'status' : 'update'
  };
}

function periodButtons(view: TrendView): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  for (const period of CHART_PERIODS) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${BUTTON_PREFIX}:${view.fundType}:${period.id}:${view.variant}`)
        .setLabel(period.buttonLabel)
        .setStyle(period.id === view.period.id ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  }
  return row;
}

function addPriceTrendComponents(container: ContainerBuilder, view: TrendView, showRange: boolean): void {
  const entries = view.entries;

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  if (view.chart && entries.length >= 2) {
    const first = entries[0];
    const last = entries[entries.length - 1];
    const trendChange = calculatePercentageChange(first.price, last.price);
    const trendSign = trendChange >= 0 ? '+' : '';

    container
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**Koersverloop (${view.period.label}):** ${iconPrefix(trendChange)}${trendSign}${trendChange.toFixed(2)}% sinds <t:${entryTimestamp(first)}:D>`
        )
      )
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(`attachment://${view.chart.fileName}`)
        )
      );

    if (showRange) {
      let lowest = first.price;
      let highest = first.price;
      for (const entry of entries) {
        if (entry.price < lowest) lowest = entry.price;
        if (entry.price > highest) highest = entry.price;
      }

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# Laag €${lowest.toFixed(4)} · Hoog €${highest.toFixed(4)} · ${entries.length} koersen`
        )
      );
    }
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Koersverloop (${view.period.label})**\n-# Nog te weinig koersen in deze periode.`
      )
    );
  }

  container.addActionRowComponents(periodButtons(view));
}

function priceText(currentData: FundData, previousData: PriceEntry | null, change: number): string {
  let text = `**Huidige koers:** €${currentData.price!.toFixed(4)}`;

  if (previousData) {
    const absoluteChange = currentData.price! - previousData.price;
    const changeSign = absoluteChange >= 0 ? '+' : '';
    text += `\n**Vorige koers:** €${previousData.price.toFixed(4)}`;
    text += `\n**Verschil:** ${changeSign}€${absoluteChange.toFixed(4)} (${changeSign}${change.toFixed(2)}%)`;
  }

  if (currentData.priceDate) {
    text += `\n**Koersdatum:** ${currentData.priceDate}`;
  }
  return text;
}

function addFooter(container: ContainerBuilder, isin: string): void {
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ISIN: ${isin}`)
  );
}

export function createPriceUpdateComponents(
  currentData: FundData,
  previousData: PriceEntry | null,
  trend: TrendView | null,
  pingRoleId?: string | null
): ContainerBuilder[] {
  const fund = FUNDS[currentData.fundType];
  const change = previousData
    ? calculatePercentageChange(previousData.price, currentData.price!)
    : 0;

  const container = new ContainerBuilder()
    .setAccentColor(MEESMAN_COLOR);

  if (pingRoleId) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`<@&${pingRoleId}>`)
    );
  }

  container
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${iconPrefix(change)}**[Meesman ${fund.name}](${fund.url})**`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(priceText(currentData, previousData, change))
    );

  if (trend) {
    addPriceTrendComponents(container, trend, true);
  }

  addFooter(container, fund.isin);
  return [container];
}

export function createStatusComponents(
  currentData: FundData,
  stats: PriceStats,
  previousData: PriceEntry | null,
  trend: TrendView | null
): ContainerBuilder[] {
  const fund = FUNDS[currentData.fundType];
  const change = previousData
    ? calculatePercentageChange(previousData.price, currentData.price!)
    : 0;

  const container = new ContainerBuilder()
    .setAccentColor(MEESMAN_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${iconPrefix(change)}**[Meesman ${fund.name}](${fund.url})**`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(priceText(currentData, previousData, change))
    );

  if (stats.count > 1 && stats.highest !== undefined && stats.lowest !== undefined && stats.average !== undefined) {
    const statsText = [
      `**Hoogste:** €${stats.highest.toFixed(4)}`,
      `**Laagste:** €${stats.lowest.toFixed(4)}`,
      `**Gemiddelde:** €${stats.average.toFixed(4)}`,
      `**Metingen:** ${stats.count}`
    ].join(' · ');

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(statsText)
    );
  }

  if (trend) {
    addPriceTrendComponents(container, trend, false);
  }

  addFooter(container, fund.isin);
  return [container];
}

export function createHistoryComponents(fundType: FundType, history: PriceEntry[]): ContainerBuilder[] {
  const fund = FUNDS[fundType];

  const container = new ContainerBuilder()
    .setAccentColor(MEESMAN_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**[Meesman ${fund.name}](${fund.url}) - Koersgeschiedenis**`)
    );

  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    const previous = history[i + 1];

    let changeText = '';
    if (previous) {
      const change = calculatePercentageChange(previous.price, entry.price);
      const sign = change >= 0 ? '+' : '';
      changeText = ` ${iconPrefix(change)}${sign}${change.toFixed(2)}%`;
    }

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `€${entry.price.toFixed(4)}${changeText}\n-# <t:${entryTimestamp(entry)}:D>`
      )
    );
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Laatste ${history.length} koersen`)
  );

  return [container];
}

function toFundData(entry: PriceEntry): FundData {
  return {
    fundType: entry.fundType,
    price: entry.price,
    priceDate: entry.priceDate,
    isin: FUNDS[entry.fundType].isin,
    annualCosts: null,
    fetchedAt: entry.fetchedAt,
    performances: entry.performances ?? {}
  };
}

export function buildTrendMessage(button: TrendButton, pingRoleId: string | null): TrendMessage | null {
  const recent = getPriceHistory(button.fundType, 2);
  if (recent.length === 0) {
    return null;
  }

  const latest = recent[0];
  const previous = recent.length > 1 ? recent[1] : null;
  const trend = buildTrendView(button.fundType, button.periodId, button.variant);
  const currentData = toFundData(latest);

  const components = button.variant === 'status'
    ? createStatusComponents(currentData, getPriceStats(button.fundType), previous, trend)
    : createPriceUpdateComponents(currentData, previous, trend, pingRoleId);

  return { components, files: trendFiles(trend) };
}
