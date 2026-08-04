import {
  ButtonInteraction,
  Client,
  GatewayIntentBits,
  MessageFlags,
  TextChannel
} from 'discord.js';
import cron from 'node-cron';
import { fetchFundData, FUNDS } from './scraper.js';
import { DEFAULT_PERIOD } from './chart.utils.js';
import {
  buildTrendMessage,
  buildTrendView,
  createHistoryComponents,
  createPriceUpdateComponents,
  createStatusComponents,
  parseTrendButton,
  trendFiles
} from './embed.utils.js';
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
  getPingRole,
  setPingRole,
  closeDatabase
} from './storage.js';
import type { FundData, FundType } from './scraper.types.js';
import type { PriceEntry } from './storage.types.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

async function notifySubscribers(fundType: FundType, currentData: FundData, previousData: PriceEntry | null): Promise<void> {
  const subscriptions = getSubscriptions(fundType);

  // Rendered once and attached per message, since every channel needs its own copy
  const trend = buildTrendView(fundType, DEFAULT_PERIOD.id, 'update');

  for (const sub of subscriptions) {
    try {
      const channel = await client.channels.fetch(sub.channelId);
      if (channel && channel.isTextBased()) {
        const pingRoleId = getPingRole(sub.guildId);
        const components = createPriceUpdateComponents(currentData, previousData, trend, pingRoleId);
        await (channel as TextChannel).send({
          components,
          files: trendFiles(trend),
          flags: MessageFlags.IsComponentsV2
        });
      }
    } catch (err) {
      console.error(`Failed to send to channel ${sub.channelId}:`, (err as Error).message);
    }
  }

  console.log(`Notified ${subscriptions.length} channels for ${FUNDS[fundType].name}`);
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
      addPriceEntry(currentData);
      await notifySubscribers(fundType, currentData, previousData);
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

async function handleTrendButton(interaction: ButtonInteraction): Promise<void> {
  const button = parseTrendButton(interaction.customId);
  if (!button) {
    return;
  }

  try {
    const pingRoleId = interaction.guildId ? getPingRole(interaction.guildId) : null;
    const message = buildTrendMessage(button, pingRoleId);

    if (!message) {
      await interaction.deferUpdate();
      return;
    }

    await interaction.update({
      components: message.components,
      files: message.files,
      attachments: [],
      flags: MessageFlags.IsComponentsV2
    });
  } catch (err) {
    console.error('Failed to update price trend:', (err as Error).message);
  }
}

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    await handleTrendButton(interaction);
    return;
  }

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
      const previousData = getLatestPrice(fundType);

      if (!currentData.price) {
        await interaction.editReply(`Kon de huidige koersgegevens van ${fund.name} niet ophalen.`);
        return;
      }

      // Check if price changed and save + notify subscribers if so
      const priceChanged = !previousData ||
        Math.abs(currentData.price - previousData.price) >= 0.0001;

      if (priceChanged) {
        addPriceEntry(currentData);
        await notifySubscribers(fundType, currentData, previousData);
      }

      const stats = getPriceStats(fundType);
      const trend = buildTrendView(fundType, DEFAULT_PERIOD.id, 'status');

      await interaction.editReply({
        components: createStatusComponents(currentData, stats, previousData, trend),
        files: trendFiles(trend),
        flags: MessageFlags.IsComponentsV2
      });
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

    await interaction.reply({
      components: createHistoryComponents(fundType, history),
      flags: MessageFlags.IsComponentsV2
    });
  }

  else if (commandName === 'meesman-ping-rol') {
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: 'Dit commando kan alleen in een server gebruikt worden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // Check if user has manage guild permission
    if (!interaction.memberPermissions?.has('ManageGuild')) {
      await interaction.reply({
        content: 'Je hebt de "Server beheren" permissie nodig om de ping rol in te stellen.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const role = interaction.options.getRole('rol');

    if (role) {
      setPingRole(guildId, role.id);
      await interaction.reply({
        content: `De rol ${role} wordt nu gepingt bij koersupdates.`
      });
    } else {
      setPingRole(guildId, null);
      await interaction.reply({
        content: 'Ping rol verwijderd. Er wordt geen rol meer gepingt bij koersupdates.'
      });
    }
  }
});

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user?.tag}`);
  console.log(`Tracking ${getSubscriptionCount()} channel subscriptions`);

  checkForUpdates();

  // Schedule hourly checks on Monday (1), Tuesday (2), and Wednesday (3) between 8:00 and 22:00
  cron.schedule('15,45 9-20 * * 1,2,3', () => {
    checkForUpdates();
  }, {
    timezone: 'Europe/Amsterdam'
  });

  console.log('Scheduled hourly price checks for Monday, Tuesday, and Wednesday 8:00-22:00 (Europe/Amsterdam timezone)');
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
