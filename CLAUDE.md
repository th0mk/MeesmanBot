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

**File layout:** exported types live in `*.types.ts` files, helper functions in `*.utils.ts` files.

- `src/index.ts` — Bot entry point: Discord client setup, slash command routing, button routing, cron scheduling, and the update notification loop. Holds no message formatting of its own.
- `src/embed.utils.ts` — All Components V2 message building: `createPriceUpdateComponents` (automatic notifications), `createStatusComponents` (manual `/meesman-status`), `createHistoryComponents` (`/meesman-history`), and `buildTrendMessage`, which rebuilds a whole message when a period button is clicked.
- `src/chart.utils.ts` — Renders the price trend to a PNG using `@resvg/resvg-js`, with a labelled price axis and date axis. The price axis snaps to round steps (1-2-5 progression) and extends to round bounds, the way Meesman's own chart does, so the all-time view lands on €30-€110 per 10. The axis also spans at least `MIN_SPAN_FRACTION` of the price level (30%), so a small move over a short period does not get stretched to fill the whole height and read as a far bigger change than it is. Defines the periods (30d / 90d / 1j / alles) and `filterByPeriod`. Every stored price in the window is plotted; the axis labels stay sparse. The background is transparent so the chart works in both the light and the dark Discord theme.
- `src/scraper.ts` — Fetches Meesman fund pages and parses price data using Cheerio. Holds the `FUNDS` config map. Adding a new fund requires updating `FUNDS`, `FundType` in `scraper.types.ts`, and the choices in `register-commands.ts`.
- `src/storage.ts` — SQLite persistence layer using `bun:sqlite`. Three tables: `subscriptions` (channel-fund pairs per guild), `price_history` (fund prices with UNIQUE on fund_type+price_date), `guild_settings` (per-guild ping role). Database file auto-created at `data/meesman.db`.
- `src/*.types.ts` — `scraper.types.ts` (`FundType`, `Fund`, `FundData`), `storage.types.ts` (`PriceEntry`, `PriceStats`, `Subscription`, `GuildSettings`), `chart.types.ts` (`PriceChart`, `ChartPeriod`), `embed.types.ts` (`TrendView`, `TrendVariant`, `TrendButton`).

**Update flow:** Cron (`node-cron`) runs `checkForUpdates()` at :15 and :45, hours 9-20 Amsterdam time, Mondays through Wednesdays only. For each fund: scrape price → compare with latest stored price (0.0001 threshold) → if changed, save to DB and notify all subscribed channels. The chart is rendered once per update and attached to every message that goes out. Each guild can have its own ping role; the role mention is embedded inside the Components V2 container (not in the `content` field, which is incompatible with `MessageFlags.IsComponentsV2`).

**Slash commands** are registered globally via `src/register-commands.ts` (separate script, not part of the bot runtime). All commands are in Dutch. Guild-only commands: follow, unfollow, ping-rol. Works anywhere: status, history.

## Key Constraints

- Messages using `MessageFlags.IsComponentsV2` cannot include the legacy `content` field — role mentions must go inside component builders.
- The `price_history` table has a UNIQUE constraint on `(fund_type, price_date)` — `INSERT OR REPLACE` is used, so a price update for the same date overwrites.
- Images inside a Components V2 container are referenced as `attachment://<name>` from a `MediaGalleryBuilder`, and the matching `AttachmentBuilder` must be passed in `files` on the same message. A fresh attachment is built per message.
- A chart needs at least two points in the selected period. When there are fewer, the period buttons are still rendered with a short note in place of the image, so a user can always switch back to a period that does have data.
- Period buttons carry their state in the custom id (`verloop:<fund>:<period>:<variant>`), so they keep working after a restart without any collector. Clicking one rebuilds the whole message from the database and replaces the attachment, which is why `attachments: []` is passed on update.
- The axis labels need a font on the host. resvg does not fail when it cannot find one — it silently draws the chart without any labels. A bare Linux server needs a font package installed (`apt install fonts-dejavu-core`).
- Fund choices in `register-commands.ts` must be kept in sync with `FUNDS` in `scraper.ts`.
