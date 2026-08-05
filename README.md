# Meesman Fund Tracker Bot

A Discord bot that tracks Meesman fund prices and notifies subscribed channels when changes are detected.

## Supported Funds

- **Aandelen Wereldwijd Totaal** (NL0013689110)
- **Aandelen Verantwoorde Toekomst** (NL0015000PW1)

## Features

- Written in TypeScript, runs with Bun
- Support for multiple Meesman funds via dropdown selection
- Automatic hourly price checks on Monday and Tuesday
- Notifications when fund prices change
- Shows current price, previous price, and percentage change
- Price trend chart with a price axis and a date axis, rendered as a PNG and attached to every price update and `/meesman-status` reply
- Buttons under the chart to switch the period between 30 days, 90 days, one year and all time
- One-off backfill of the full price history from Meesman's own published spreadsheet, so the chart has years of history from day one
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
   bun install
   ```

   The chart axis labels are drawn with a system font. On a bare Linux server
   without any fonts installed, the chart still renders but the labels are
   silently left out — install a font package to avoid that:

   ```bash
   sudo apt install fonts-dejavu-core
   ```

6. Register slash commands:
   ```bash
   bun run register
   ```

7. Backfill the price history (optional, but recommended before first run):
   ```bash
   bun run backfill
   ```

   Without this the database starts empty and the chart only fills up as the bot
   runs. See [Backfilling price history](#backfilling-price-history) below.

8. Start the bot:
   ```bash
   bun start
   ```

   Or with hot reload:
   ```bash
   bun run dev
   ```

## Scripts

| Script | Description |
|--------|-------------|
| `bun start` | Run the bot |
| `bun run dev` | Run with hot reload (watch mode) |
| `bun run register` | Register slash commands |
| `bun run backfill` | Import the full price history from Meesman's spreadsheet |
| `bun run build` | Bundle for Node.js deployment |

## Backfilling price history

The bot only records prices while it is running, so a fresh database has nothing
to chart. Meesman publishes every trading price since 2015 as a spreadsheet
linked from its fund pages, and `bun run backfill` imports it:

```bash
bun run backfill
```

That fills `price_history` with the weekly trading prices for both funds — back
to September 2019 for Aandelen Wereldwijd Totaal and February 2022 for Aandelen
Verantwoorde Toekomst, which is when each fund launched.

Options (note the `--` separator, which passes the flag through to the script):

```bash
bun run backfill -- --dry-run             # report what would be imported, write nothing
bun run backfill -- --fonds=wereldwijd    # import one fund only
```

Worth knowing:

- **It is safe to re-run.** Dates already in the database are skipped, never
  overwritten, so prices the bot recorded live keep their original fetch time.
  Re-running after a few months tops up whatever is missing.
- **The spreadsheet link is discovered at runtime** by reading it off the fund
  page, because it lives under a generated `/media/<id>/` path that changes
  whenever Meesman republishes the file.
- **Dividend payouts are skipped.** They sit in the same columns as the prices
  and are distinguished only by being coloured red, which the importer detects
  by resolving the cell's font colour.
- **Prices are weekly**, so a 30-day chart is built from roughly four points.
- If Meesman changes the spreadsheet layout the import fails loudly with what it
  could not find, rather than writing partial or wrong data.

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
- **price_history**: Historical price data for tracking changes, populated live
  by the bot and in bulk by `bun run backfill`

## Deployment

The bot runs on Linux using `screen` for process management:

```bash
# Start a new screen session
screen -S meesman

# Install dependencies and start the bot
bun install && bun start

# Detach from session: Ctrl+A, then D
```

To reattach later:
```bash
screen -r meesman
```

If it says "attached" elsewhere, force reattach:
```bash
screen -d -r meesman
```

After pulling new code, reattach to the screen session, stop the bot with `Ctrl+C`, then run `bun install && bun start` again.

## Invite Link

Generate an invite link with the following permissions:
- `View Channels`
- `Send Messages`
- `Embed Links`
- `Attach Files` (required for the price trend chart)
- `Use Application Commands`

Example invite URL format:
```
https://discord.com/api/oauth2/authorize?client_id=1460663524106829966&permissions=2147535872&scope=bot%20applications.commands
```
