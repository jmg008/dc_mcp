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
- live mobile search result parsing for gallery-restricted search
- live view-page parsing for post metadata/body/images
- live `/board/comment/` calls for comments

## Tool contracts

### `search`

Input:

```json
{ "query": "gpt" }
```

Behavior:

- empty or recent-like query returns recent posts
- other queries use DCInside post search and keep only `thesingularity`

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
- `MCP_PROBE_QUERY` defaults to `gpt`
- `MCP_FETCH_ID` forces a specific `thesingularity:<postNo>` for fetch verification

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
