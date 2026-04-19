# Claude Bridge

[![npm version](https://img.shields.io/npm/v/@olakunlevpn/claude-bridge.svg?style=flat-square)](https://www.npmjs.com/package/@olakunlevpn/claude-bridge)
[![Tests](https://img.shields.io/github/actions/workflow/status/Olakunlevpn/claude-bridge/ci.yml?branch=main&style=flat-square&label=tests)](https://github.com/Olakunlevpn/claude-bridge/actions)
[![Total downloads](https://img.shields.io/npm/dt/@olakunlevpn/claude-bridge.svg?style=flat-square)](https://www.npmjs.com/package/@olakunlevpn/claude-bridge)
[![Monthly downloads](https://img.shields.io/npm/dm/@olakunlevpn/claude-bridge.svg?style=flat-square)](https://www.npmjs.com/package/@olakunlevpn/claude-bridge)
[![License](https://img.shields.io/npm/l/@olakunlevpn/claude-bridge.svg?style=flat-square)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Olakunlevpn/claude-bridge.svg?style=flat-square)](https://github.com/Olakunlevpn/claude-bridge)

A tiny local HTTP proxy in front of the Claude CLI. Any app on your machine can POST a prompt to `http://localhost:8787` and get an answer back — billed against the Claude Pro/Max subscription the CLI is logged into, not against a pay-per-token API key.

## Use this when

- You already pay for Claude Pro/Max and don't want a second API bill.
- You want a Chrome extension, shell script, or side project to talk to Claude without managing keys.
- You're prototyping in tools that can't speak the Anthropic SDK directly.

## Don't use this when

- You need the lowest possible latency. The direct API is 2–3× faster.
- You're shipping a product to other people. They don't have your CLI session.
- You're processing thousands of requests per day. You'll hit subscription throttles.

## Requirements

- Node.js 18+
- The [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/overview), installed and logged in:

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

## Installation

```bash
npm install -g @olakunlevpn/claude-bridge
```

The package is scoped but the CLI is still invoked as `claude-bridge`.

## Usage

Start the server:

```bash
claude-bridge
```

Send a prompt:

```bash
curl -s http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{"userText":"What is 2+2?"}' | jq -r .answer
```

Check the health endpoint:

```bash
curl http://localhost:8787/health
# {"status":"ok","model":"default"}
```

## API

### `POST /`

```http
POST / HTTP/1.1
Host: localhost:8787
Content-Type: application/json

{
  "systemPrompt": "You are a concise answer bot.",
  "userText": "Which is the capital of France? A) Berlin B) Paris C) Rome",
  "model": "haiku"
}
```

| Field          | Required | Notes                                                         |
| -------------- | -------- | ------------------------------------------------------------- |
| `userText`     | yes      | The user prompt.                                              |
| `systemPrompt` | no       | When provided, prepended to `userText` with a `---` separator.|
| `model`        | no       | Per-request model override. Falls back to `BRIDGE_MODEL`.     |

Response:

```json
{ "answer": "B" }
```

Error responses (`{ "error": "..." }`):

| Status | Meaning                                                           |
| ------ | ----------------------------------------------------------------- |
| 400    | `userText` missing or not a string, or `model` not a string.      |
| 401    | `BRIDGE_TOKEN` is set and the request didn't pass auth.           |
| 405    | Non-POST on `/`.                                                  |
| 413    | Request body exceeds the 1 MB limit.                              |
| 500    | Claude CLI failed or the request timed out.                       |

### `GET /health`

```json
{ "status": "ok", "model": "default" }
```

## Configuration

Configure via environment variables, or drop a `.env` file in either location:

- `./.env` — per-project, takes priority
- `~/.claude-bridge/.env` — global default

Shell environment variables always win over both files.

| Variable             | Default        | Purpose                                                       |
| -------------------- | -------------- | ------------------------------------------------------------- |
| `BRIDGE_PORT`        | `8787`         | Port to listen on                                             |
| `BRIDGE_TIMEOUT_MS`  | `30000`        | Per-request timeout in milliseconds                           |
| `BRIDGE_MODEL`       | _(CLI default)_| Default model. A per-request `model` in the body overrides it.|
| `BRIDGE_TOKEN`       | _(unset)_      | Enables `Authorization: Bearer ...` when set                  |
| `CLAUDE_CMD`         | `claude`       | Path or name of the Claude CLI binary                         |

Example `.env`:

```dotenv
BRIDGE_PORT=9000
BRIDGE_MODEL=haiku
BRIDGE_TIMEOUT_MS=60000
```

Or inline:

```bash
BRIDGE_PORT=9000 BRIDGE_MODEL=haiku claude-bridge
```

## Using from a Chrome extension

Add to `manifest.json`:

```json
"host_permissions": ["http://localhost/*", "http://127.0.0.1/*"]
```

Call it:

```js
const response = await fetch("http://localhost:8787", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ systemPrompt, userText })
});
const { answer } = await response.json();
```

## Security

- The server binds to `127.0.0.1` only, so it's not reachable from the network.
- Requests larger than 1 MB return `413 Payload Too Large`.
- Authentication is optional. Set `BRIDGE_TOKEN` to require `Authorization: Bearer <token>` on all requests except `OPTIONS` and `GET /health`:

```bash
BRIDGE_TOKEN=$(openssl rand -hex 24) claude-bridge
```

```bash
curl -s http://localhost:8787 \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userText":"What is 2+2?"}'
```

Without `BRIDGE_TOKEN`, anyone who can reach `localhost` on your machine can call the bridge. Don't run it unauthenticated on a shared box.

## Licensing and terms

Claude Bridge calls the official Claude CLI via `spawn`. Make sure your usage stays within [Anthropic's Acceptable Use Policy](https://www.anthropic.com/legal/aup) and the terms of your subscription. Extracting OAuth tokens outside the CLI is a separate thing that Anthropic has banned — this project does **not** do that; it just runs the CLI.

## Contributing

Issues and pull requests welcome at [github.com/Olakunlevpn/claude-bridge](https://github.com/Olakunlevpn/claude-bridge). For major changes, open an issue first.

## Credits

- [Olakunlevpn](https://github.com/Olakunlevpn)

## License

The MIT License (MIT). See [LICENSE](LICENSE).
