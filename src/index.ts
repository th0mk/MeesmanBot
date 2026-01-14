import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextChannel
} from 'discord.js';
import cron from 'node-cron';
import { fetchFundData, calculatePercentageChange, FundData, FundType, FUNDS } from './scraper.js';
import {
  initDatabase,
  getSubscriptions,
  addSubscription,
  removeSubscription,
  getSubscriptionCount,
  getLatestPrice,
  addPriceEntry,
  getPriceStats,
  getPriceHistory,
  closeDatabase,
  PriceEntry,
  PriceStats
} from './storage.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const MEESMAN_COLOR = 0x68DDE4;

/**
 * Creates components for a price update
 */
function createPriceUpdateComponents(currentData: FundData, previousData: PriceEntry | null): ContainerBuilder[] {
  const fund = FUNDS[currentData.fundType];
  const change = previousData
    ? calculatePercentageChange(previousData.price, currentData.price!)
    : 0;

  const changeSymbol = change > 0 ? '📈' : change < 0 ? '📉' : '➡️';

  // Build price info text
  let priceText = `**Huidige koers:** €${currentData.price!.toFixed(4)}`;

  if (previousData) {
    const absoluteChange = currentData.price! - previousData.price;
    const changeSign = absoluteChange >= 0 ? '+' : '';
    priceText += `\n**Vorige koers:** €${previousData.price.toFixed(4)}`;
    priceText += `\n**Verschil:** ${changeSign}€${absoluteChange.toFixed(4)} (${changeSign}${change.toFixed(2)}%)`;
  }

  if (currentData.priceDate) {
    priceText += `\n**Koersdatum:** ${currentData.priceDate}`;
  }

  const container = new ContainerBuilder()
    .setAccentColor(MEESMAN_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${changeSymbol} **[Meesman ${fund.name}](${fund.url})**`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(priceText)
    );

  // Add performance data if available
  if (currentData.performances && Object.keys(currentData.performances).length > 0) {
    const perfLines = Object.entries(currentData.performances)
      .sort(([a], [b]) => parseInt(b) - parseInt(a))
      .slice(0, 4)
      .map(([year, perf]) => `${year}: ${perf >= 0 ? '+' : ''}${perf.toFixed(1)}%`)
      .join(' · ');

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Rendement:** ${perfLines}`)
    );
  }

  // Footer
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ISIN: ${fund.isin}`)
  );

  return [container];
}

/**
 * Creates components for the current price status
 */
function createStatusComponents(currentData: FundData, stats: PriceStats, previousData: PriceEntry | null): ContainerBuilder[] {
  const fund = FUNDS[currentData.fundType];
  const change = previousData
    ? calculatePercentageChange(previousData.price, currentData.price!)
    : 0;

  const changeSymbol = change > 0 ? '📈' : change < 0 ? '📉' : '➡️';

  let priceText = `**Huidige koers:** €${currentData.price!.toFixed(4)}`;

  if (previousData) {
    const absoluteChange = currentData.price! - previousData.price;
    const changeSign = absoluteChange >= 0 ? '+' : '';
    priceText += `\n**Vorige koers:** €${previousData.price.toFixed(4)}`;
    priceText += `\n**Verschil:** ${changeSign}€${absoluteChange.toFixed(4)} (${changeSign}${change.toFixed(2)}%)`;
  }

  if (currentData.priceDate) {
    priceText += `\n**Koersdatum:** ${currentData.priceDate}`;
  }

  const container = new ContainerBuilder()
    .setAccentColor(MEESMAN_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${changeSymbol} **[Meesman ${fund.name}](${fund.url})**`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(priceText)
    );

  // Add stats if available
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

  // Add performance data if available
  if (currentData.performances && Object.keys(currentData.performances).length > 0) {
    const perfLines = Object.entries(currentData.performances)
      .sort(([a], [b]) => parseInt(b) - parseInt(a))
      .slice(0, 4)
      .map(([year, perf]) => `${year}: ${perf >= 0 ? '+' : ''}${perf.toFixed(1)}%`)
      .join(' · ');

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Rendement:** ${perfLines}`)
    );
  }

  // Footer
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ISIN: ${fund.isin}`)
  );

  return [container];
}

/**
 * Checks for price updates for a specific fund and notifies subscribers
 */
async function checkForUpdatesForFund(fundType: FundType): Promise<void> {
  const fund = FUNDS[fundType];
  console.log(`[${new Date().toISOString()}] Checking for price updates for ${fund.name}...`);

  try {
    const currentData = await fetchFundData(fundType);

    if (!currentData.price) {
      console.error(`Failed to fetch price data for ${fund.name}`);
      return;
    }

    const previousData = getLatestPrice(fundType);

    // Check if price has changed (comparing with 4 decimal precision)
    const priceChanged = !previousData ||
      Math.abs(currentData.price - previousData.price) >= 0.0001;

    if (priceChanged) {
      console.log(`${fund.name} price changed: ${previousData?.price ?? 'N/A'} -> ${currentData.price}`);

      // Save the new price
      addPriceEntry(currentData);

      // Notify all subscribers for this fund
      const subscriptions = getSubscriptions(fundType);
      const components = createPriceUpdateComponents(currentData, previousData);

      for (const sub of subscriptions) {
        try {
          const channel = await client.channels.fetch(sub.channelId);
          if (channel && channel.isTextBased()) {
            await (channel as TextChannel).send({ components, flags: MessageFlags.IsComponentsV2 });
          }
        } catch (err) {
          console.error(`Failed to send to channel ${sub.channelId}:`, (err as Error).message);
        }
      }

      console.log(`Notified ${subscriptions.length} channels for ${fund.name}`);
    } else {
      console.log(`No price change detected for ${fund.name}`);
    }
  } catch (err) {
    console.error(`Error checking for updates for ${fund.name}:`, err);
  }
}

/**
 * Checks for price updates for all funds
 */
async function checkForUpdates(): Promise<void> {
  await checkForUpdatesForFund('wereldwijd');
  await checkForUpdatesForFund('verantwoord');
}

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'meesman-follow') {
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    const fundType = interaction.options.getString('fonds', true) as FundType;
    const fund = FUNDS[fundType];

    if (!guildId) {
      await interaction.reply({
        content: 'Dit commando kan alleen in een server gebruikt worden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const added = addSubscription(guildId, channelId, fundType);

    if (added) {
      await interaction.reply({
        content: `Dit kanaal volgt nu koersupdates van Meesman ${fund.name}. Je ontvangt een melding wanneer de koers verandert.`
      });
    } else {
      await interaction.reply({
        content: `Dit kanaal volgt al koersupdates van Meesman ${fund.name}.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }

  else if (commandName === 'meesman-unfollow') {
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    const fundType = interaction.options.getString('fonds', true) as FundType;
    const fund = FUNDS[fundType];

    if (!guildId) {
      await interaction.reply({
        content: 'Dit commando kan alleen in een server gebruikt worden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const removed = removeSubscription(guildId, channelId, fundType);

    if (removed) {
      await interaction.reply({
        content: `Dit kanaal volgt niet langer koersupdates van Meesman ${fund.name}.`
      });
    } else {
      await interaction.reply({
        content: `Dit kanaal volgde geen koersupdates van Meesman ${fund.name}.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }

  else if (commandName === 'meesman-status') {
    const fundType = interaction.options.getString('fonds', true) as FundType;
    const fund = FUNDS[fundType];

    await interaction.deferReply();

    try {
      const currentData = await fetchFundData(fundType);
      const stats = getPriceStats(fundType);
      const previousData = getLatestPrice(fundType);

      if (!currentData.price) {
        await interaction.editReply(`Kon de huidige koersgegevens van ${fund.name} niet ophalen.`);
        return;
      }

      // Check if price changed and save if so
      const priceChanged = !previousData ||
        Math.abs(currentData.price - previousData.price) >= 0.0001;

      if (priceChanged) {
        addPriceEntry(currentData);
      }

      const components = createStatusComponents(currentData, stats, previousData);
      await interaction.editReply({ components, flags: MessageFlags.IsComponentsV2 });
    } catch (err) {
      console.error('Error fetching status:', err);
      await interaction.editReply(`Er is een fout opgetreden bij het ophalen van de koersgegevens van ${fund.name}.`);
    }
  }

  else if (commandName === 'meesman-history') {
    const fundType = interaction.options.getString('fonds', true) as FundType;
    const fund = FUNDS[fundType];
    const history = getPriceHistory(fundType, 10);

    if (history.length === 0) {
      await interaction.reply({
        content: `Nog geen koersgeschiedenis geregistreerd voor ${fund.name}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const historyLines = history.map((entry, i) => {
      const date = entry.priceDate || entry.fetchedAt.split('T')[0];
      return `${i + 1}. €${entry.price.toFixed(4)} (${date})`;
    }).join('\n');

    const container = new ContainerBuilder()
      .setAccentColor(MEESMAN_COLOR)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**[Meesman ${fund.name}](${fund.url}) - Koersgeschiedenis**`)
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(historyLines)
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Laatste ${history.length} koersen`)
      );

    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }
});

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user?.tag}`);
  console.log(`Tracking ${getSubscriptionCount()} channel subscriptions`);

  // Schedule hourly checks on Monday (1) and Tuesday (2) between 8:00 and 22:00
  cron.schedule('0 8-22 * * 1,2', () => {
    checkForUpdates();
  }, {
    timezone: 'Europe/Amsterdam'
  });

  console.log('Scheduled hourly price checks for Monday and Tuesday 8:00-22:00 (Europe/Amsterdam timezone)');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  closeDatabase();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  closeDatabase();
  client.destroy();
  process.exit(0);
});

// Start the bot
async function start(): Promise<void> {
  console.log('Initializing database...');
  await initDatabase();
  console.log('Database initialized');

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('DISCORD_TOKEN is not set');
  }

  await client.login(token);
}

start().catch(err => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});
