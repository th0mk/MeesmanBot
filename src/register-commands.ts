import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';

const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  new SlashCommandBuilder()
    .setName('meesman-follow')
    .setDescription('Volg koersupdates van Meesman Aandelen Wereldwijd Totaal'),

  new SlashCommandBuilder()
    .setName('meesman-unfollow')
    .setDescription('Stop met volgen van Meesman Aandelen Wereldwijd Totaal'),

  new SlashCommandBuilder()
    .setName('meesman-status')
    .setDescription('Bekijk de huidige koers van Meesman Aandelen Wereldwijd Totaal'),

  new SlashCommandBuilder()
    .setName('meesman-history')
    .setDescription('Toon recente koersgeschiedenis van Meesman Aandelen Wereldwijd Totaal'),

  new SlashCommandBuilder()
    .setName('meesman-check')
    .setDescription('Controleer handmatig op koerswijzigingen')
].map(command => command.toJSON());

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in environment variables');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function registerCommands(): Promise<void> {
  try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
      Routes.applicationCommands(clientId!),
      { body: commands }
    );

    console.log('Successfully registered application commands:');
    commands.forEach(cmd => console.log(`  - /${cmd.name}: ${cmd.description}`));
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

registerCommands();
