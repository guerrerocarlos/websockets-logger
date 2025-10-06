# websockets-logger

A tiny TypeScript-first helper that forwards your application logs to a Cloudflare Durable Object hub and lets you inspect everything through the [console-omattic-com](../console-omattic-com) UI. Drop it into any browser or Node.js project, keep your existing `console.*` calls, and get a centralized stream of JSON-friendly log events.

## Quick start

Install the package inside your app (once this workspace is published you can reference it via a local path or private registry):

```bash
pnpm add websockets-logger
```

Initialize the logger as early as possible in your app:

```ts
import { initializeWebSocketLogger, wsLog } from 'websockets-logger';

initializeWebSocketLogger({
  wsUrl: 'wss://websockets.omattic.com/hub',
  source: 'my-app', // optional – defaults to host/pid + random suffix
});

wsLog.info('Hello central console');
```

If you prefer to keep using `console.*`, flip on the auto-patching helper:

```ts
initializeWebSocketLogger({
  wsUrl: 'wss://websockets.omattic.com/hub',
  source: 'marketing-site',
  patchConsole: true,
});
```

With `patchConsole: true` the module swaps the global console methods so every call goes through the logger **and** optionally prints locally. By default local printing is disabled to avoid double output; enable it by passing `consolePassthrough: true` or `enableConsole: true`.

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `wsUrl` | – | Required WebSocket endpoint, e.g. `wss://websockets.omattic.com/hub` from [websockets-omattic-com](../websockets-omattic-com). |
| `source` | hostname / pid + random | Acts as the clientId inside the Durable Object. Show up in the console UI as the emitter. |
| `topic` | `logs` | Broadcast topic used when sending messages. Leave as-is to interoperate with the console worker and UI. |
| `subscriptionTopic` | `source` | Initial subscription topic sent on connection. Normally you should not change this. |
| `enableConsole` | `true` (or `false` when `patchConsole` is set) | Mirror messages to the original console methods that were present during initialization. |
| `bufferMessages` | `true` | Queue log entry objects while the socket reconnects. |
| `maxBufferSize` | `100` | Upper bound for the in-memory buffer. Oldest messages are dropped first. |
| `reconnectInterval` | `5000` ms | Automatic reconnect cadence. Set to `0` to disable. |
| `onConnectionChange` | – | `(state) => void` callback with `connecting`, `connected`, or `disconnected`. Useful for status indicators. |
| `onMessage` | – | Receive raw messages coming **from** the hub (handy if you extend the DO to push commands). |
| `webSocketFactory` | `globalThis.WebSocket` | Supply your own implementation when running outside the browser, e.g. `() => new (require('ws'))(url)`. |
| `initialContext` | `{}` | Key/value payload merged into every log message. Update at runtime via `logger.updateContext()`. |
| `patchConsole` | `false` | Only on `initializeWebSocketLogger`. Auto routes console calls through the logger. |
| `consoleLevels` | all | Restrict which console methods are patched. |
| `consolePassthrough` | mirrors `enableConsole` | When patching console, forward the call to the original console after logging. |

## Runtime helpers

```ts
import {
  WebSocketLogger,
  initializeWebSocketLogger,
  getWebSocketLogger,
  patchConsole,
  unpatchConsole,
  wsLog,
} from 'websockets-logger';
```

- `WebSocketLogger` – instantiate manually if you need multiple isolated loggers.
- `initializeWebSocketLogger` – creates a singleton, optionally patches the global console, and returns the instance.
- `getWebSocketLogger` – retrieve the singleton or `null`.
- `patchConsole` / `unpatchConsole` – control console interception explicitly.
- `wsLog` – drop-in replacement object with `log/error/warn/info/debug` plus `setRequestId`, `setContext`, `updateContext`, `clearContext`.

### Request-scoped metadata

```ts
const logger = initializeWebSocketLogger({ wsUrl: HUB_URL });

logger.setRequestId('abc-123');
logger.updateContext({ userId: 'uid_42', featureFlag: 'beta-dashboard' });
logger.info('User opened dashboard');
logger.clearContext(['featureFlag']);
logger.clearRequestId();
```

Every payload delivered to the hub includes the timestamp, level, source, optional request id, and context blob. The [console-omattic-com](../console-omattic-com) UI already highlights `requestId` and prettifies JSON content; adding more context lets you extend that view without changing the worker.

## Using inside Node.js

Pass your own WebSocket implementation and patch the console:

```ts
import WebSocket from 'ws';
import { initializeWebSocketLogger } from 'websockets-logger';

initializeWebSocketLogger({
  wsUrl: 'wss://websockets.omattic.com/hub',
  source: `worker-${process.pid}`,
  webSocketFactory: (url) => new WebSocket(url),
  patchConsole: true,
  enableConsole: true, // still prints locally
});
```

## Relationship to the hub and console projects

- **[websockets-omattic-com](../websockets-omattic-com)** hosts the Cloudflare Worker + Durable Object hub that relays messages between clients. This logger automatically subscribes using its `source` as `clientId` and publishes log entries to the shared `logs` topic.
- **[console-omattic-com](../console-omattic-com)** is the React UI that subscribes to the `all` topic and renders incoming log events. If you follow the defaults, every log produced through this module appears there instantly with request id and JSON detection.

## Development

```bash
pnpm install
pnpm build
```

The build pipeline uses `tsup` to emit dual ESM/CommonJS bundles plus declaration files into `dist/`. To start iterating locally you can `pnpm link --global` and consume the package in another repo via `pnpm link --global websockets-logger`.

## Continuous publishing

- GitHub Actions workflow: `.github/workflows/publish.yml`.
- Trigger: every push to `main` after lint/build.
- Publishes with `pnpm publish --access public` when the `package.json` version is not already on npm.
- Requires an `NPM_TOKEN` repository secret with publish rights to the `websockets-logger` package.
