const LOG_LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
export type LogLevel = typeof LOG_LEVELS[number];

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

type WebSocketEventName = 'open' | 'close' | 'error' | 'message';
type WebSocketEventListener = (event: unknown) => void;

export interface LogMessage {
    timestamp: string;
    level: LogLevel;
    message: string;
    data?: unknown[];
    source: string;
    requestId?: string;
    context?: Record<string, unknown>;
}

export interface WebSocketLike {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener?(event: WebSocketEventName, listener: WebSocketEventListener): void;
    removeEventListener?(event: WebSocketEventName, listener: WebSocketEventListener): void;
    on?(event: WebSocketEventName, listener: WebSocketEventListener): void;
    off?(event: WebSocketEventName, listener: WebSocketEventListener): void;
    removeListener?(event: WebSocketEventName, listener: WebSocketEventListener): void;
    once?(event: WebSocketEventName, listener: WebSocketEventListener): void;
    readyState?: number;
}

export type WebSocketFactory = (url: string, headers?: Record<string, string>) => WebSocketLike;

export interface WebSocketLoggerOptions {
    wsUrl: string;
    source?: string;
    topic?: string;
    subscriptionTopic?: string;
    enableConsole?: boolean;
    bufferMessages?: boolean;
    maxBufferSize?: number;
    reconnectInterval?: number;
    onConnectionChange?: (state: ConnectionState) => void;
    onMessage?: (message: unknown, rawEvent: unknown) => void;
    webSocketFactory?: WebSocketFactory;
    initialContext?: Record<string, unknown>;
    apiKey?: string;
    headers?: Record<string, string>;
}

export interface InitializeWebSocketLoggerOptions extends WebSocketLoggerOptions {
    patchConsole?: boolean;
    consoleLevels?: LogLevel[];
    consolePassthrough?: boolean;
}

interface NormalizedOptions {
    wsUrl: string;
    source: string;
    topic: string;
    subscriptionTopic: string;
    enableConsole: boolean;
    bufferMessages: boolean;
    maxBufferSize: number;
    reconnectInterval: number;
    onConnectionChange?: (state: ConnectionState) => void;
    onMessage?: (message: unknown, rawEvent: unknown) => void;
    webSocketFactory: WebSocketFactory;
    headers?: Record<string, string>;
}

type ListenerCleanup = () => void;
const globalScope = globalThis as typeof globalThis & {
    location?: { hostname?: string };
    process?: { pid?: number };
    WebSocket?: new (url: string, protocols?: string | string[]) => WebSocketLike;
};

function randomSuffix() {
    return Math.random().toString(36).slice(2, 10);
}

function createDefaultSource() {
    if (globalScope?.location?.hostname) {
        return `${globalScope.location.hostname}-${randomSuffix()}`;
    }
    if (globalScope?.process?.pid) {
        return `node-${globalScope.process.pid}-${randomSuffix()}`;
    }
    return `client-${randomSuffix()}`;
}

function defaultWebSocketFactory(url: string, headers?: Record<string, string>): WebSocketLike {
    const NativeWebSocket = globalScope?.WebSocket;
    if (typeof NativeWebSocket === 'function') {
        // Node.js 'ws' library supports headers via options object
        // Browser WebSocket doesn't support custom headers in constructor
        if (headers && Object.keys(headers).length > 0) {
            return new NativeWebSocket(url, { headers } as unknown as string);
        }
        return new NativeWebSocket(url);
    }
    throw new Error('No global WebSocket implementation found. Provide options.webSocketFactory.');
}

function sanitizeValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
    if (value === null) {
        return null;
    }

    const valueType = typeof value;

    if (valueType === 'function') {
        const fn = value as (...args: unknown[]) => unknown;
        return `[Function${fn.name ? `: ${fn.name}` : ''}]`;
    }

    if (valueType === 'symbol') {
        return value instanceof Symbol ? value.toString() : String(value);
    }

    if (valueType !== 'object') {
        return value;
    }

    const objectValue = value as Record<string, unknown>;

    if (seen.has(objectValue)) {
        return '[Circular]';
    }

    seen.add(objectValue);

    if (Array.isArray(objectValue)) {
        const result = objectValue.map((item) => sanitizeValue(item, seen));
        seen.delete(objectValue);
        return result;
    }

    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(objectValue)) {
        result[key] = sanitizeValue(nestedValue, seen);
    }

    seen.delete(objectValue);
    return result;
}

function formatArg(arg: unknown): string {
    if (typeof arg === 'string') {
        return arg;
    }

    if (arg instanceof Error) {
        return arg.stack || arg.message || arg.toString();
    }

    try {
        return JSON.stringify(sanitizeValue(arg));
    } catch {
        return String(arg);
    }
}

function createMessageString(args: unknown[]): string {
    return args.map(formatArg).join(' ');
}

function attachListener(ws: WebSocketLike, event: WebSocketEventName, handler: WebSocketEventListener): ListenerCleanup {
    if (typeof ws.addEventListener === 'function' && typeof ws.removeEventListener === 'function') {
        ws.addEventListener(event, handler);
        return () => ws.removeEventListener?.(event, handler);
    }

    if (typeof ws.on === 'function') {
        ws.on(event, handler);
        return () => {
            if (typeof ws.off === 'function') {
                ws.off(event, handler);
            } else if (typeof ws.removeListener === 'function') {
                ws.removeListener(event, handler);
            }
        };
    }

    return () => {};
}

function normalizeOptions(options: WebSocketLoggerOptions): NormalizedOptions {
    const source = options.source ?? createDefaultSource();

    // Merge apiKey into headers if provided
    let headers: Record<string, string> | undefined = options.headers ? { ...options.headers } : undefined;
    if (options.apiKey) {
        headers = headers ?? {};
        headers['X-API-Key'] = options.apiKey;
    }

    return {
        wsUrl: options.wsUrl,
        source,
        topic: options.topic ?? 'logs',
        subscriptionTopic: options.subscriptionTopic ?? source,
        enableConsole: options.enableConsole ?? true,
        bufferMessages: options.bufferMessages ?? true,
        maxBufferSize: options.maxBufferSize ?? 100,
        reconnectInterval: options.reconnectInterval ?? 5000,
        onConnectionChange: options.onConnectionChange,
        onMessage: options.onMessage,
        webSocketFactory: options.webSocketFactory ?? defaultWebSocketFactory,
        headers,
    };
}

export class WebSocketLogger {
    private ws: WebSocketLike | null = null;
    private readonly options: NormalizedOptions;
    private readonly messageBuffer: LogMessage[] = [];
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private isConnected = false;
    private manualClose = false;
    private requestId: string | null = null;
    private context: Record<string, unknown>;
    private eventUnsubscribers: ListenerCleanup[] = [];
    private readonly consoleMethods: Record<LogLevel, (...args: unknown[]) => void>;

    constructor(options: WebSocketLoggerOptions) {
        this.options = normalizeOptions(options);
        this.context = { ...(options.initialContext ?? {}) };
        this.consoleMethods = {
            log: console.log.bind(console),
            info: console.info.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console),
            debug: (console.debug ?? console.log).bind(console),
        };

        this.connect();
    }

    private connect() {
        this.manualClose = false;
        this.notifyConnection('connecting');

        try {
            const ws = this.options.webSocketFactory(this.options.wsUrl, this.options.headers);
            this.ws = ws;

            this.eventUnsubscribers = [
                attachListener(ws, 'open', this.handleOpen),
                attachListener(ws, 'close', this.handleClose),
                attachListener(ws, 'error', this.handleError),
                attachListener(ws, 'message', this.handleMessage),
            ];
        } catch (error) {
            this.logInternal('error', 'Failed to create WebSocket connection:', error);
            this.scheduleReconnect();
        }
    }

    private handleOpen = () => {
        this.isConnected = true;
        this.logInternal('info', 'WebSocket logger connected');
        this.sendSubscription();
        this.flushBuffer();
        this.clearReconnectTimer();
        this.notifyConnection('connected');
    };

    private handleClose = () => {
        this.isConnected = false;
        this.cleanupWebSocket();
        this.logInternal('warn', 'WebSocket logger disconnected');
        this.notifyConnection('disconnected');
        this.scheduleReconnect();
    };

    private handleError = (event: unknown) => {
        this.isConnected = false;
        this.logInternal('error', 'WebSocket logger error:', event);
        this.notifyConnection('disconnected');
        this.scheduleReconnect();
    };

    private handleMessage = (event: unknown) => {
        if (!this.options.onMessage) {
            return;
        }

        const data = (event && typeof event === 'object' && 'data' in (event as Record<string, unknown>))
            ? (event as Record<string, unknown>).data
            : event;

        this.options.onMessage(data, event);
    };

    private notifyConnection(state: ConnectionState) {
        this.options.onConnectionChange?.(state);
    }

    private logInternal(level: LogLevel, ...args: unknown[]) {
        if (!this.options.enableConsole) {
            return;
        }

        this.consoleMethods[level](...args);
    }

    private sendSubscription() {
        const payload = {
            clientId: this.options.source,
            action: 'subscribe',
            topic: this.options.subscriptionTopic,
        };

        this.safeSend(payload);
    }

    private flushBuffer() {
        if (!this.isConnected) {
            return;
        }

        while (this.messageBuffer.length > 0) {
            const message = this.messageBuffer.shift();
            if (message) {
                this.safeSendLogMessage(message);
            }
        }
    }

    private safeSendLogMessage(logMessage: LogMessage) {
        const payload = {
            topic: this.options.topic,
            value: logMessage,
            clientId: this.options.source,
        };

        this.safeSend(payload);
    }

    private safeSend(payload: unknown) {
        if (!this.isConnected || !this.ws) {
            return;
        }

        try {
            const sanitized = sanitizeValue(payload);
            this.ws.send(JSON.stringify(sanitized));
        } catch (error) {
            this.logInternal('error', 'Failed to send WebSocket message:', error);
        }
    }

    private scheduleReconnect() {
        if (this.manualClose) {
            return;
        }

        if (this.reconnectTimer || this.options.reconnectInterval <= 0) {
            return;
        }

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.manualClose) {
                this.connect();
            }
        }, this.options.reconnectInterval);
    }

    private clearReconnectTimer() {
        if (!this.reconnectTimer) {
            return;
        }
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    private cleanupWebSocket(forceClose = false) {
        if (this.ws) {
            if (forceClose) {
                try {
                    this.ws.close();
                } catch {
                    // ignore close errors
                }
            }
        }

        if (this.eventUnsubscribers.length > 0) {
            for (const unsubscribe of this.eventUnsubscribers) {
                try {
                    unsubscribe();
                } catch {
                    // ignore unsubscribe errors
                }
            }
            this.eventUnsubscribers = [];
        }

        this.ws = null;
    }

    private createLogMessage(level: LogLevel, args: unknown[]): LogMessage {
        const sanitizedArgs = args.map((arg) => sanitizeValue(arg));
        const includeFirstArg = args.length === 1 && typeof args[0] !== 'string';
        const dataCandidates = includeFirstArg ? sanitizedArgs : sanitizedArgs.slice(1);

        const message: LogMessage = {
            timestamp: new Date().toISOString(),
            level,
            message: createMessageString(args),
            source: this.options.source,
        };

        if (this.requestId) {
            message.requestId = this.requestId;
        }

        if (dataCandidates.length > 0) {
            message.data = dataCandidates;
        }

        if (Object.keys(this.context).length > 0) {
            message.context = { ...this.context };
        }

        return message;
    }

    private write(level: LogLevel, args: unknown[]) {
        const logMessage = this.createLogMessage(level, args);
        if (this.isConnected && this.ws) {
            this.safeSendLogMessage(logMessage);
        } else if (this.options.bufferMessages) {
            this.messageBuffer.push(logMessage);
            if (this.messageBuffer.length > this.options.maxBufferSize) {
                this.messageBuffer.shift();
            }
        }

        this.logInternal(level, ...args);
    }

    setRequestId(requestId: string | null) {
        this.requestId = requestId;
    }

    clearRequestId() {
        this.requestId = null;
    }

    setContext(context: Record<string, unknown>) {
        this.context = { ...context };
    }

    updateContext(context: Record<string, unknown>) {
        this.context = { ...this.context, ...context };
    }

    clearContext(keys?: string[]) {
        if (!keys) {
            this.context = {};
            return;
        }

        for (const key of keys) {
            delete this.context[key];
        }
    }

    log(...args: unknown[]) {
        this.write('log', args);
    }

    error(...args: unknown[]) {
        this.write('error', args);
    }

    warn(...args: unknown[]) {
        this.write('warn', args);
    }

    info(...args: unknown[]) {
        this.write('info', args);
    }

    debug(...args: unknown[]) {
        this.write('debug', args);
    }

    reconnect() {
        this.manualClose = false;
        this.clearReconnectTimer();
        this.cleanupWebSocket(true);
        this.connect();
    }

    close() {
        this.manualClose = true;
        this.clearReconnectTimer();
        this.cleanupWebSocket(true);
        this.isConnected = false;
        this.notifyConnection('disconnected');
    }

    get connected() {
        return this.isConnected;
    }

    get bufferedMessageCount() {
        return this.messageBuffer.length;
    }

    get loggerOptions(): Readonly<NormalizedOptions> {
        return { ...this.options };
    }
}

let globalLogger: WebSocketLogger | null = null;
let activeConsoleRestore: (() => void) | null = null;

export interface PatchConsoleOptions {
    logger?: WebSocketLogger;
    levels?: LogLevel[];
    passthrough?: boolean;
}

export function patchConsole(options: PatchConsoleOptions = {}): () => void {
    const logger = options.logger ?? globalLogger;
    if (!logger) {
        throw new Error('No WebSocketLogger available to patch console. Initialize one or pass it explicitly.');
    }

    const levels = options.levels ?? [...LOG_LEVELS];
    const passthrough = options.passthrough ?? false;
    const consoleRef = console as unknown as Record<LogLevel, (...args: unknown[]) => void>;
    const originals: Partial<Record<LogLevel, (...args: unknown[]) => void>> = {};

    for (const level of levels) {
        const original = consoleRef[level]?.bind(console);
        originals[level] = original;
        consoleRef[level] = (...args: unknown[]) => {
            logger[level](...args);
            if (passthrough && original) {
                original(...args);
            }
        };
    }

    const restore = () => {
        for (const level of levels) {
            const original = originals[level];
            if (original) {
                consoleRef[level] = original;
            }
        }
    };

    activeConsoleRestore?.();
    activeConsoleRestore = restore;

    return restore;
}

export function unpatchConsole() {
    if (activeConsoleRestore) {
        activeConsoleRestore();
        activeConsoleRestore = null;
    }
}

export function initializeWebSocketLogger(options: InitializeWebSocketLoggerOptions): WebSocketLogger {
    const {
        patchConsole: shouldPatchConsole = false,
        consoleLevels,
        consolePassthrough,
        ...rest
    } = options;

    if (globalLogger) {
        globalLogger.close();
    }

    const loggerOptions: WebSocketLoggerOptions = {
        ...rest,
        enableConsole: rest.enableConsole ?? !shouldPatchConsole,
    };

    const logger = new WebSocketLogger(loggerOptions);
    globalLogger = logger;

    if (shouldPatchConsole) {
        const passthrough = consolePassthrough ?? Boolean(loggerOptions.enableConsole);
        patchConsole({
            logger,
            levels: consoleLevels,
            passthrough,
        });
    }

    return logger;
}

export function getWebSocketLogger(): WebSocketLogger | null {
    return globalLogger;
}

export const wsLog = {
    log: (...args: unknown[]) => {
        if (globalLogger) {
            globalLogger.log(...args);
        } else {
            console.log(...args);
        }
    },
    error: (...args: unknown[]) => {
        if (globalLogger) {
            globalLogger.error(...args);
        } else {
            console.error(...args);
        }
    },
    warn: (...args: unknown[]) => {
        if (globalLogger) {
            globalLogger.warn(...args);
        } else {
            console.warn(...args);
        }
    },
    info: (...args: unknown[]) => {
        if (globalLogger) {
            globalLogger.info(...args);
        } else {
            console.info(...args);
        }
    },
    debug: (...args: unknown[]) => {
        if (globalLogger) {
            globalLogger.debug(...args);
        } else {
            (console.debug ?? console.log)(...args);
        }
    },
    setRequestId: (requestId: string | null) => {
        if (!globalLogger) {
            return;
        }
        if (requestId) {
            globalLogger.setRequestId(requestId);
        } else {
            globalLogger.clearRequestId();
        }
    },
    setContext: (context: Record<string, unknown>) => {
        globalLogger?.setContext(context);
    },
    updateContext: (context: Record<string, unknown>) => {
        globalLogger?.updateContext(context);
    },
    clearContext: (keys?: string[]) => {
        globalLogger?.clearContext(keys);
    },
};

export default WebSocketLogger;
