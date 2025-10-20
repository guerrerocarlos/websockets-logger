declare const LOG_LEVELS: readonly ["log", "info", "warn", "error", "debug"];
type LogLevel = typeof LOG_LEVELS[number];
type ConnectionState = 'connecting' | 'connected' | 'disconnected';
type WebSocketEventName = 'open' | 'close' | 'error' | 'message';
type WebSocketEventListener = (event: unknown) => void;
interface LogMessage {
    timestamp: string;
    level: LogLevel;
    message: string;
    data?: unknown[];
    source: string;
    requestId?: string;
    context?: Record<string, unknown>;
}
interface WebSocketLike {
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
type WebSocketFactory = (url: string, headers?: Record<string, string>) => WebSocketLike;
interface WebSocketLoggerOptions {
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
interface InitializeWebSocketLoggerOptions extends WebSocketLoggerOptions {
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
declare class WebSocketLogger {
    private ws;
    private readonly options;
    private readonly messageBuffer;
    private reconnectTimer;
    private isConnected;
    private manualClose;
    private requestId;
    private context;
    private eventUnsubscribers;
    private readonly consoleMethods;
    constructor(options: WebSocketLoggerOptions);
    private connect;
    private handleOpen;
    private handleClose;
    private handleError;
    private handleMessage;
    private notifyConnection;
    private logInternal;
    private sendSubscription;
    private flushBuffer;
    private safeSendLogMessage;
    private safeSend;
    private scheduleReconnect;
    private clearReconnectTimer;
    private cleanupWebSocket;
    private createLogMessage;
    private write;
    setRequestId(requestId: string | null): void;
    clearRequestId(): void;
    setContext(context: Record<string, unknown>): void;
    updateContext(context: Record<string, unknown>): void;
    clearContext(keys?: string[]): void;
    log(...args: unknown[]): void;
    error(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    info(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    reconnect(): void;
    close(): void;
    get connected(): boolean;
    get bufferedMessageCount(): number;
    get loggerOptions(): Readonly<NormalizedOptions>;
}
interface PatchConsoleOptions {
    logger?: WebSocketLogger;
    levels?: LogLevel[];
    passthrough?: boolean;
}
declare function patchConsole(options?: PatchConsoleOptions): () => void;
declare function unpatchConsole(): void;
declare function initializeWebSocketLogger(options: InitializeWebSocketLoggerOptions): WebSocketLogger;
declare function getWebSocketLogger(): WebSocketLogger | null;
declare const wsLog: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
    setRequestId: (requestId: string | null) => void;
    setContext: (context: Record<string, unknown>) => void;
    updateContext: (context: Record<string, unknown>) => void;
    clearContext: (keys?: string[]) => void;
};

export { ConnectionState, InitializeWebSocketLoggerOptions, LogLevel, LogMessage, PatchConsoleOptions, WebSocketFactory, WebSocketLike, WebSocketLogger, WebSocketLoggerOptions, WebSocketLogger as default, getWebSocketLogger, initializeWebSocketLogger, patchConsole, unpatchConsole, wsLog };
