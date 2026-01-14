# Meesman Fund Tracker Bot

A Discord bot that tracks Meesman fund prices and notifies subscribed channels when changes are detected.

## Supported Funds

- **Aandelen Wereldwijd Totaal** (NL0013689110)
- **Aandelen Verantwoorde Toekomst** (NL0015000PW1)

## Features

- Written in TypeScript with full type safety
- Support for multiple Meesman funds via dropdown selection
- Automatic hourly price checks on Monday and Tuesday
- Notifications when fund prices change
- Shows current price, previous price, and percentage change
- SQLite database for persistent storage
- Slash commands with fund selection dropdowns

## Setup

1. Create a Discord application at https://discord.com/developers/applications

2. Create a bot for your application and copy the token

3. Enable the following in your bot settings:
   - `applications.commands` scope (for slash commands)

4. Copy `.env.example` to `.env` and fill in your values:
   ```
   DISCORD_TOKEN=your_bot_token_here
   DISCORD_CLIENT_ID=your_client_id_here
   ```

5. Install dependencies:
   ```bash
   npm install
   ```

6. Build and register slash commands:
   ```bash
   npm run register
   ```

7. Build and start the bot:
   ```bash
   npm run dev
   ```

   Or build once and run:
   ```bash
   npm run build
   npm start
   ```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run the compiled bot |
| `npm run dev` | Build and run the bot |
| `npm run register` | Build and register slash commands |

## Commands

All commands include a fund selection dropdown to choose which fund to interact with.

| Command | Description |
|---------|-------------|
| `/meesman-follow` | Subscribe current channel to price updates for a fund |
| `/meesman-unfollow` | Unsubscribe current channel from price updates for a fund |
| `/meesman-status` | Get current fund price, statistics, and check for updates |
| `/meesman-history` | Show recent price history for a fund |

## Schedule

The bot automatically checks for price updates for all supported funds every hour on Monday and Tuesday (Europe/Amsterdam timezone). This schedule aligns with when Meesman typically updates their fund prices.

## Data Storage

All data is stored in an SQLite database at `data/meesman.db`:
- **subscriptions**: Channels that receive price update notifications
- **price_history**: Historical price data for tracking changes

## Invite Link

Generate an invite link with the following permissions:
- `View Channels`
- `Send Messages`
- `Embed Links`
- `Use Application Commands`

Example invite URL format:
```
https://discord.com/api/oauth2/authorize?client_id=1460663524106829966&permissions=2147503104&scope=bot%20applications.commands
```
