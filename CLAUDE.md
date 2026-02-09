# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun start              # Run the bot
bun run dev            # Run with hot reload (watch mode)
bun run register       # Register/update Discord slash commands (run after changing command definitions)
bun run build          # Bundle for deployment
bun install            # Install dependencies
```

There are no tests or linters configured. The project uses Bun as both runtime and package manager (not Node.js). TypeScript is run directly by Bun without a separate compile step. Use `bun:sqlite` for database imports (not better-sqlite3 or other packages).

## Architecture

Discord bot that scrapes Meesman fund prices and sends updates to subscribed Discord channels.

**Three source files:**

- `src/index.ts` — Bot entry point: Discord client setup, slash command handlers, cron scheduling, and the update notification loop. Uses Discord.js Components V2 (`ContainerBuilder`, `TextDisplayBuilder`) for message formatting. Contains two component builders: `createPriceUpdateComponents` (automatic notifications) and `createStatusComponents` (manual `/meesman-status` responses).
- `src/scraper.ts` — Fetches Meesman fund pages and parses price/performance data using Cheerio. Defines `FundType` (`'wereldwijd' | 'verantwoord'`) and the `FUNDS` config map. Adding a new fund requires updating `FUNDS`, `FundType`, and the choices in `register-commands.ts`.
- `src/storage.ts` — SQLite persistence layer using `bun:sqlite`. Three tables: `subscriptions` (channel-fund pairs per guild), `price_history` (fund prices with UNIQUE on fund_type+price_date), `guild_settings` (per-guild ping role). Database file auto-created at `data/meesman.db`.

**Update flow:** Cron (`node-cron`) runs `checkForUpdates()` at :15 and :45, hours 9-20 Amsterdam time, Mondays and Tuesdays only. For each fund: scrape price → compare with latest stored price (0.0001 threshold) → if changed, save to DB and notify all subscribed channels. Each guild can have its own ping role; the role mention is embedded inside the Components V2 container (not in the `content` field, which is incompatible with `MessageFlags.IsComponentsV2`).

**Slash commands** are registered globally via `src/register-commands.ts` (separate script, not part of the bot runtime). All commands are in Dutch. Guild-only commands: follow, unfollow, ping-rol. Works anywhere: status, history.

## Key Constraints

- Messages using `MessageFlags.IsComponentsV2` cannot include the legacy `content` field — role mentions must go inside component builders.
- The `price_history` table has a UNIQUE constraint on `(fund_type, price_date)` — `INSERT OR REPLACE` is used, so a price update for the same date overwrites.
- Fund choices in `register-commands.ts` must be kept in sync with `FUNDS` in `scraper.ts`.
