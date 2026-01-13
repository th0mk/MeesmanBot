# Meesman Fund Tracker Bot

A Discord bot that tracks the Meesman "Aandelen Wereldwijd Totaal" fund price and notifies subscribed channels when changes are detected.

## Features

- Automatic hourly price checks on Monday and Tuesday
- Notifications when the fund price changes
- Shows current price, previous price, and percentage change
- SQLite database for persistent storage
- Slash commands for easy interaction

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

6. Register slash commands:
   ```bash
   npm run register
   ```

7. Start the bot:
   ```bash
   npm start
   ```

## Commands

| Command | Description |
|---------|-------------|
| `/meesman-follow` | Subscribe current channel to price updates |
| `/meesman-unfollow` | Unsubscribe current channel from price updates |
| `/meesman-status` | Get current fund price and statistics |
| `/meesman-history` | Show recent price history |
| `/meesman-check` | Manually trigger a price check |

## Schedule

The bot automatically checks for price updates every hour on Monday and Tuesday (Europe/Amsterdam timezone). This schedule aligns with when Meesman typically updates their fund prices.

## Data Storage

All data is stored in an SQLite database at `data/meesman.db`:
- **subscriptions**: Channels that receive price update notifications
- **price_history**: Historical price data for tracking changes

## Invite Link

Generate an invite link with the following permissions:
- `Send Messages`
- `Embed Links`
- `Use Slash Commands`

Example invite URL format:
```
https://discord.com/api/oauth2/authorize?client_id=1460663524106829966&permissions=2147485696&scope=bot%20applications.commands
```
