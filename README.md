# dcinside-mcp

Read-only remote MCP server for the DCInside minor gallery **"특이점이 온다"** (`thesingularity`).

## What it exposes

- `search`
- `fetch`

Everything is hard-scoped to `thesingularity`.

## Current adapter strategy

`dcinside.js@1.0.6` is still the only upstream integration point, but the adapter uses the package's live HTTP session plus the current DCInside page and comment schemas.

This is intentional:

- `Client.document()` is still useful for compatibility checking
- `Client.board()` is currently fragile against the live list markup for this gallery
- `search` is not implemented by the package
- `comments` is declared by the package but not implemented

So this server uses:

- live list page parsing for recent posts
- live recommended-list parsing for concept posts
- live view-page parsing for post metadata/body/images
- live `/board/comment/` calls for comments

## Tool contracts

### `search`

Input:

```json
{ "hours": 24 }
```

Behavior:

- returns only recommended posts from `thesingularity`
- filters them to the last N hours using `Asia/Seoul` time
- defaults to `24` hours when omitted

Result item fields:

- `id`
- `title`
- `url`

### `fetch`

Input:

```json
{ "id": "thesingularity:12345" }
```

Result fields:

- `id`
- `title`
- `text`
- `url`
- `metadata`
- `comments`
- `imageUrls`

## Local development

Requirements:

- Node `>=20.18.1`

Run:

```bash
npm install
npm run build
npm start
```

Default endpoint:

- `http://127.0.0.1:3000/mcp`

Health check:

- `http://127.0.0.1:3000/healthz`

## Environment

See [.env.example](C:/Users/jmg008/Desktop/coding/mcp/dcmcp/.env.example).

Important:

- `ALLOWED_ORIGINS` is required when `NODE_ENV=production`
- `MCP_STATELESS=1` forces stateless MCP mode for serverless platforms or local Vercel-style testing
- recommended first production allowlist is `https://chat.openai.com,https://chatgpt.com`
- production defaults are:
  - `REQUEST_TIMEOUT_MS=15000`
  - `RECENT_CACHE_TTL_MS=45000`
  - `POST_CACHE_TTL_MS=180000`
  - `MAX_CONCURRENCY=2`

## Validation

Unit and HTTP tests:

```bash
npm test
```

Live smoke check against DCInside:

```bash
npm run smoke:live
```

Public deployment probe:

```bash
npm run probe:deploy -- https://<your-service>.onrender.com/mcp
```

Optional env overrides:

- `MCP_ALLOWED_ORIGIN` defaults to `https://chat.openai.com`
- `MCP_PROBE_HOURS` defaults to `24`
- `MCP_FETCH_ID` forces a specific `thesingularity:<postNo>` for fetch verification
- probe accepts both stateful invalid-session `400` and stateless `405`

Optional live Vitest integration suite:

- PowerShell: ``$env:RUN_LIVE_DC_TESTS='1'; npm test``

## Render deployment

This repo includes:

- [Dockerfile](C:/Users/jmg008/Desktop/coding/mcp/dcmcp/Dockerfile)
- [render.yaml](C:/Users/jmg008/Desktop/coding/mcp/dcmcp/render.yaml)
- [.dockerignore](C:/Users/jmg008/Desktop/coding/mcp/dcmcp/.dockerignore)

Render notes:

- health check path is `/healthz`
- set `ALLOWED_ORIGINS=https://chat.openai.com,https://chatgpt.com` in Render before deploying
- use the Blueprint flow or create a Docker web service pointed at this repo

Suggested release order:

1. Push this project to a GitHub or GitLab repository.
2. Create a Render Blueprint from that repository.
3. Set `ALLOWED_ORIGINS=https://chat.openai.com,https://chatgpt.com` during the initial Blueprint flow.
4. Wait for `GET /healthz` to return `200`.
5. Run `npm run probe:deploy -- https://<your-service>.onrender.com/mcp`.
6. Verify `POST /mcp` with MCP Inspector if you want an extra manual check.
7. Register `https://<your-service>.onrender.com/mcp` as a custom connector in ChatGPT.

## Vercel deployment

This repo can also run on Vercel without a Docker layer.

Behavior:

- `src/index.ts` now exports the Express app as a default export for Vercel
- when `VERCEL=1`, the server switches to stateless MCP mode automatically
- you can simulate the same behavior locally with `MCP_STATELESS=1`

Vercel notes:

- keep the project root at the repository root
- set the same production env vars as Render, especially `ALLOWED_ORIGINS`
- in stateless mode, `POST /mcp` works normally and `GET`/`DELETE /mcp` return `405`
- this repo includes [vercel.json](/C:/Users/jmg008/Desktop/coding/mcp/dcmcp/vercel.json) to force the `express` framework preset and clear `buildCommand`/`outputDirectory` overrides
- if the Vercel dashboard still shows `Build Command` or `Output Directory` overrides from an older import, clear them and redeploy
