import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize
} from 'discord.js';
import cron from 'node-cron';
import { fetchFundData, calculatePercentageChange } from './scraper.js';
import {
  initDatabase,
  getSubscriptions,
  addSubscription,
  removeSubscription,
  isSubscribed,
  getSubscriptionCount,
  getLatestPrice,
  addPriceEntry,
  getPriceStats,
  getPriceHistory,
  closeDatabase
} from './storage.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const FUND_URL = 'https://www.meesman.nl/onze-fondsen/aandelen-wereldwijd-totaal/';
const MEESMAN_COLOR = 0x68DDE4;

/**
 * Creates components for a price update
 */
function createPriceUpdateComponents(currentData, previousData) {
  const change = previousData
    ? calculatePercentageChange(previousData.price, currentData.price)
    : 0;

  const changeSymbol = change > 0 ? '📈' : change < 0 ? '📉' : '➡️';

  // Build price info text
  let priceText = `**Huidige koers:** €${currentData.price.toFixed(4)}`;

  if (previousData) {
    const absoluteChange = currentData.price - previousData.price;
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
      new TextDisplayBuilder().setContent(`${changeSymbol} **[Meesman Aandelen Wereldwijd Totaal](${FUND_URL})**`)
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
    new TextDisplayBuilder().setContent('-# ISIN: NL0013689110')
  );

  return [container];
}

/**
 * Creates components for the current price status
 */
function createStatusComponents(currentData, stats) {
  let priceText = `**Huidige koers:** €${currentData.price.toFixed(4)}`;

  if (currentData.priceDate) {
    priceText += `\n**Koersdatum:** ${currentData.priceDate}`;
  }

  const container = new ContainerBuilder()
    .setAccentColor(MEESMAN_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**[Meesman Aandelen Wereldwijd Totaal](${FUND_URL})**`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(priceText)
    );

  // Add stats if available
  if (stats.count > 1) {
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
    new TextDisplayBuilder().setContent('-# ISIN: NL0013689110')
  );

  return [container];
}

/**
 * Checks for price updates and notifies subscribers
 */
async function checkForUpdates() {
  console.log(`[${new Date().toISOString()}] Checking for price updates...`);

  try {
    const currentData = await fetchFundData();

    if (!currentData.price) {
      console.error('Failed to fetch price data');
      return;
    }

    const previousData = getLatestPrice();

    // Check if price has changed (comparing with 4 decimal precision)
    const priceChanged = !previousData ||
      Math.abs(currentData.price - previousData.price) >= 0.0001;

    if (priceChanged) {
      console.log(`Price changed: ${previousData?.price ?? 'N/A'} -> ${currentData.price}`);

      // Save the new price
      addPriceEntry(currentData);

      // Notify all subscribers
      const subscriptions = getSubscriptions();
      const components = createPriceUpdateComponents(currentData, previousData);

      for (const sub of subscriptions) {
        try {
          const channel = await client.channels.fetch(sub.channelId);
          if (channel) {
            await channel.send({ components, flags: MessageFlags.IsComponentsV2 });
          }
        } catch (err) {
          console.error(`Failed to send to channel ${sub.channelId}:`, err.message);
        }
      }

      console.log(`Notified ${subscriptions.length} channels`);
    } else {
      console.log('No price change detected');
    }
  } catch (err) {
    console.error('Error checking for updates:', err);
  }
}

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'meesman-follow') {
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;

    if (!guildId) {
      await interaction.reply({
        content: 'Dit commando kan alleen in een server gebruikt worden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const added = addSubscription(guildId, channelId);

    if (added) {
      await interaction.reply({
        content: 'Dit kanaal volgt nu koersupdates van Meesman Aandelen Wereldwijd Totaal. Je ontvangt een melding wanneer de koers verandert.'      });
    } else {
      await interaction.reply({
        content: 'Dit kanaal volgt al koersupdates van Meesman Aandelen Wereldwijd Totaal.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  else if (commandName === 'meesman-unfollow') {
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;

    if (!guildId) {
      await interaction.reply({
        content: 'Dit commando kan alleen in een server gebruikt worden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const removed = removeSubscription(guildId, channelId);

    if (removed) {
      await interaction.reply({
        content: 'Dit kanaal volgt niet langer koersupdates van Meesman Aandelen Wereldwijd Totaal.'      });
    } else {
      await interaction.reply({
        content: 'Dit kanaal volgde geen koersupdates van Meesman Aandelen Wereldwijd Totaal.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  else if (commandName === 'meesman-status') {
    await interaction.deferReply();

    try {
      const currentData = await fetchFundData();
      const stats = getPriceStats();

      if (!currentData.price) {
        await interaction.editReply('Kon de huidige koersgegevens niet ophalen.');
        return;
      }

      const components = createStatusComponents(currentData, stats);
      await interaction.editReply({ components, flags: MessageFlags.IsComponentsV2 });
    } catch (err) {
      console.error('Error fetching status:', err);
      await interaction.editReply('Er is een fout opgetreden bij het ophalen van de koersgegevens.');
    }
  }

  else if (commandName === 'meesman-history') {
    const history = getPriceHistory(10);

    if (history.length === 0) {
      await interaction.reply({
        content: 'Nog geen koersgeschiedenis geregistreerd.',
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
        new TextDisplayBuilder().setContent(`**[Meesman Aandelen Wereldwijd Totaal](${FUND_URL}) - Koersgeschiedenis**`)
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

  else if (commandName === 'meesman-check') {
    // Manual check for updates
    await interaction.deferReply();

    try {
      const currentData = await fetchFundData();

      if (!currentData.price) {
        await interaction.editReply('Kon de huidige koersgegevens niet ophalen.');
        return;
      }

      const previousData = getLatestPrice();
      const priceChanged = !previousData ||
        Math.abs(currentData.price - previousData.price) >= 0.0001;

      if (priceChanged) {
        addPriceEntry(currentData);
        const components = createPriceUpdateComponents(currentData, previousData);
        await interaction.editReply({
          components,
          flags: MessageFlags.IsComponentsV2
        });
      } else {
        await interaction.editReply(`Geen koerswijziging. Huidige koers: €${currentData.price.toFixed(4)}`);
      }
    } catch (err) {
      console.error('Error during manual check:', err);
      await interaction.editReply('Er is een fout opgetreden bij het controleren op updates.');
    }
  }
});

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Tracking ${getSubscriptionCount()} channels`);

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
async function start() {
  console.log('Initializing database...');
  await initDatabase();
  console.log('Database initialized');

  await client.login(process.env.DISCORD_TOKEN);
}

start().catch(err => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});
