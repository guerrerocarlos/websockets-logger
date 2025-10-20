var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var LOG_LEVELS = ["log", "info", "warn", "error", "debug"];
var globalScope = globalThis;
function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}
__name(randomSuffix, "randomSuffix");
function createDefaultSource() {
  if (globalScope?.location?.hostname) {
    return `${globalScope.location.hostname}-${randomSuffix()}`;
  }
  if (globalScope?.process?.pid) {
    return `node-${globalScope.process.pid}-${randomSuffix()}`;
  }
  return `client-${randomSuffix()}`;
}
__name(createDefaultSource, "createDefaultSource");
function defaultWebSocketFactory(url, headers) {
  const NativeWebSocket = globalScope?.WebSocket;
  if (typeof NativeWebSocket === "function") {
    if (headers && Object.keys(headers).length > 0) {
      return new NativeWebSocket(url, { headers });
    }
    return new NativeWebSocket(url);
  }
  throw new Error("No global WebSocket implementation found. Provide options.webSocketFactory.");
}
__name(defaultWebSocketFactory, "defaultWebSocketFactory");
function sanitizeValue(value, seen = /* @__PURE__ */ new WeakSet()) {
  if (value === null) {
    return null;
  }
  const valueType = typeof value;
  if (valueType === "function") {
    const fn = value;
    return `[Function${fn.name ? `: ${fn.name}` : ""}]`;
  }
  if (valueType === "symbol") {
    return value instanceof Symbol ? value.toString() : String(value);
  }
  if (valueType !== "object") {
    return value;
  }
  const objectValue = value;
  if (seen.has(objectValue)) {
    return "[Circular]";
  }
  seen.add(objectValue);
  if (Array.isArray(objectValue)) {
    const result2 = objectValue.map((item) => sanitizeValue(item, seen));
    seen.delete(objectValue);
    return result2;
  }
  const result = {};
  for (const [key, nestedValue] of Object.entries(objectValue)) {
    result[key] = sanitizeValue(nestedValue, seen);
  }
  seen.delete(objectValue);
  return result;
}
__name(sanitizeValue, "sanitizeValue");
function formatArg(arg) {
  if (typeof arg === "string") {
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
__name(formatArg, "formatArg");
function createMessageString(args) {
  return args.map(formatArg).join(" ");
}
__name(createMessageString, "createMessageString");
function attachListener(ws, event, handler) {
  if (typeof ws.addEventListener === "function" && typeof ws.removeEventListener === "function") {
    ws.addEventListener(event, handler);
    return () => ws.removeEventListener?.(event, handler);
  }
  if (typeof ws.on === "function") {
    ws.on(event, handler);
    return () => {
      if (typeof ws.off === "function") {
        ws.off(event, handler);
      } else if (typeof ws.removeListener === "function") {
        ws.removeListener(event, handler);
      }
    };
  }
  return () => {
  };
}
__name(attachListener, "attachListener");
function normalizeOptions(options) {
  const source = options.source ?? createDefaultSource();
  let headers = options.headers ? { ...options.headers } : void 0;
  if (options.apiKey) {
    headers = headers ?? {};
    headers["X-API-Key"] = options.apiKey;
  }
  return {
    wsUrl: options.wsUrl,
    source,
    topic: options.topic ?? "logs",
    subscriptionTopic: options.subscriptionTopic ?? source,
    enableConsole: options.enableConsole ?? true,
    bufferMessages: options.bufferMessages ?? true,
    maxBufferSize: options.maxBufferSize ?? 100,
    reconnectInterval: options.reconnectInterval ?? 5e3,
    onConnectionChange: options.onConnectionChange,
    onMessage: options.onMessage,
    webSocketFactory: options.webSocketFactory ?? defaultWebSocketFactory,
    headers
  };
}
__name(normalizeOptions, "normalizeOptions");
var _WebSocketLogger = class _WebSocketLogger {
  constructor(options) {
    this.ws = null;
    this.messageBuffer = [];
    this.reconnectTimer = null;
    this.isConnected = false;
    this.manualClose = false;
    this.requestId = null;
    this.eventUnsubscribers = [];
    this.handleOpen = /* @__PURE__ */ __name(() => {
      this.isConnected = true;
      this.logInternal("info", "WebSocket logger connected");
      this.sendSubscription();
      this.flushBuffer();
      this.clearReconnectTimer();
      this.notifyConnection("connected");
    }, "handleOpen");
    this.handleClose = /* @__PURE__ */ __name(() => {
      this.isConnected = false;
      this.cleanupWebSocket();
      this.logInternal("warn", "WebSocket logger disconnected");
      this.notifyConnection("disconnected");
      this.scheduleReconnect();
    }, "handleClose");
    this.handleError = /* @__PURE__ */ __name((event) => {
      this.isConnected = false;
      this.logInternal("error", "WebSocket logger error:", event);
      this.notifyConnection("disconnected");
      this.scheduleReconnect();
    }, "handleError");
    this.handleMessage = /* @__PURE__ */ __name((event) => {
      if (!this.options.onMessage) {
        return;
      }
      const data = event && typeof event === "object" && "data" in event ? event.data : event;
      this.options.onMessage(data, event);
    }, "handleMessage");
    this.options = normalizeOptions(options);
    this.context = { ...options.initialContext ?? {} };
    this.consoleMethods = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: (console.debug ?? console.log).bind(console)
    };
    this.connect();
  }
  connect() {
    this.manualClose = false;
    this.notifyConnection("connecting");
    try {
      const ws = this.options.webSocketFactory(this.options.wsUrl, this.options.headers);
      this.ws = ws;
      this.eventUnsubscribers = [
        attachListener(ws, "open", this.handleOpen),
        attachListener(ws, "close", this.handleClose),
        attachListener(ws, "error", this.handleError),
        attachListener(ws, "message", this.handleMessage)
      ];
    } catch (error) {
      this.logInternal("error", "Failed to create WebSocket connection:", error);
      this.scheduleReconnect();
    }
  }
  notifyConnection(state) {
    this.options.onConnectionChange?.(state);
  }
  logInternal(level, ...args) {
    if (!this.options.enableConsole) {
      return;
    }
    this.consoleMethods[level](...args);
  }
  sendSubscription() {
    const payload = {
      clientId: this.options.source,
      action: "subscribe",
      topic: this.options.subscriptionTopic
    };
    this.safeSend(payload);
  }
  flushBuffer() {
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
  safeSendLogMessage(logMessage) {
    const payload = {
      topic: this.options.topic,
      value: logMessage,
      clientId: this.options.source
    };
    this.safeSend(payload);
  }
  safeSend(payload) {
    if (!this.isConnected || !this.ws) {
      return;
    }
    try {
      const sanitized = sanitizeValue(payload);
      this.ws.send(JSON.stringify(sanitized));
    } catch (error) {
      this.logInternal("error", "Failed to send WebSocket message:", error);
    }
  }
  scheduleReconnect() {
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
  clearReconnectTimer() {
    if (!this.reconnectTimer) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
  cleanupWebSocket(forceClose = false) {
    if (this.ws) {
      if (forceClose) {
        try {
          this.ws.close();
        } catch {
        }
      }
    }
    if (this.eventUnsubscribers.length > 0) {
      for (const unsubscribe of this.eventUnsubscribers) {
        try {
          unsubscribe();
        } catch {
        }
      }
      this.eventUnsubscribers = [];
    }
    this.ws = null;
  }
  createLogMessage(level, args) {
    const sanitizedArgs = args.map((arg) => sanitizeValue(arg));
    const includeFirstArg = args.length === 1 && typeof args[0] !== "string";
    const dataCandidates = includeFirstArg ? sanitizedArgs : sanitizedArgs.slice(1);
    const message = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      message: createMessageString(args),
      source: this.options.source
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
  write(level, args) {
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
  setRequestId(requestId) {
    this.requestId = requestId;
  }
  clearRequestId() {
    this.requestId = null;
  }
  setContext(context) {
    this.context = { ...context };
  }
  updateContext(context) {
    this.context = { ...this.context, ...context };
  }
  clearContext(keys) {
    if (!keys) {
      this.context = {};
      return;
    }
    for (const key of keys) {
      delete this.context[key];
    }
  }
  log(...args) {
    this.write("log", args);
  }
  error(...args) {
    this.write("error", args);
  }
  warn(...args) {
    this.write("warn", args);
  }
  info(...args) {
    this.write("info", args);
  }
  debug(...args) {
    this.write("debug", args);
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
    this.notifyConnection("disconnected");
  }
  get connected() {
    return this.isConnected;
  }
  get bufferedMessageCount() {
    return this.messageBuffer.length;
  }
  get loggerOptions() {
    return { ...this.options };
  }
};
__name(_WebSocketLogger, "WebSocketLogger");
var WebSocketLogger = _WebSocketLogger;
var globalLogger = null;
var activeConsoleRestore = null;
function patchConsole(options = {}) {
  const logger = options.logger ?? globalLogger;
  if (!logger) {
    throw new Error("No WebSocketLogger available to patch console. Initialize one or pass it explicitly.");
  }
  const levels = options.levels ?? [...LOG_LEVELS];
  const passthrough = options.passthrough ?? false;
  const consoleRef = console;
  const originals = {};
  for (const level of levels) {
    const original = consoleRef[level]?.bind(console);
    originals[level] = original;
    consoleRef[level] = (...args) => {
      logger[level](...args);
      if (passthrough && original) {
        original(...args);
      }
    };
  }
  const restore = /* @__PURE__ */ __name(() => {
    for (const level of levels) {
      const original = originals[level];
      if (original) {
        consoleRef[level] = original;
      }
    }
  }, "restore");
  activeConsoleRestore?.();
  activeConsoleRestore = restore;
  return restore;
}
__name(patchConsole, "patchConsole");
function unpatchConsole() {
  if (activeConsoleRestore) {
    activeConsoleRestore();
    activeConsoleRestore = null;
  }
}
__name(unpatchConsole, "unpatchConsole");
function initializeWebSocketLogger(options) {
  const {
    patchConsole: shouldPatchConsole = false,
    consoleLevels,
    consolePassthrough,
    ...rest
  } = options;
  if (globalLogger) {
    globalLogger.close();
  }
  const loggerOptions = {
    ...rest,
    enableConsole: rest.enableConsole ?? !shouldPatchConsole
  };
  const logger = new WebSocketLogger(loggerOptions);
  globalLogger = logger;
  if (shouldPatchConsole) {
    const passthrough = consolePassthrough ?? Boolean(loggerOptions.enableConsole);
    patchConsole({
      logger,
      levels: consoleLevels,
      passthrough
    });
  }
  return logger;
}
__name(initializeWebSocketLogger, "initializeWebSocketLogger");
function getWebSocketLogger() {
  return globalLogger;
}
__name(getWebSocketLogger, "getWebSocketLogger");
var wsLog = {
  log: (...args) => {
    if (globalLogger) {
      globalLogger.log(...args);
    } else {
      console.log(...args);
    }
  },
  error: (...args) => {
    if (globalLogger) {
      globalLogger.error(...args);
    } else {
      console.error(...args);
    }
  },
  warn: (...args) => {
    if (globalLogger) {
      globalLogger.warn(...args);
    } else {
      console.warn(...args);
    }
  },
  info: (...args) => {
    if (globalLogger) {
      globalLogger.info(...args);
    } else {
      console.info(...args);
    }
  },
  debug: (...args) => {
    if (globalLogger) {
      globalLogger.debug(...args);
    } else {
      (console.debug ?? console.log)(...args);
    }
  },
  setRequestId: (requestId) => {
    if (!globalLogger) {
      return;
    }
    if (requestId) {
      globalLogger.setRequestId(requestId);
    } else {
      globalLogger.clearRequestId();
    }
  },
  setContext: (context) => {
    globalLogger?.setContext(context);
  },
  updateContext: (context) => {
    globalLogger?.updateContext(context);
  },
  clearContext: (keys) => {
    globalLogger?.clearContext(keys);
  }
};
var src_default = WebSocketLogger;
export {
  WebSocketLogger,
  src_default as default,
  getWebSocketLogger,
  initializeWebSocketLogger,
  patchConsole,
  unpatchConsole,
  wsLog
};
//# sourceMappingURL=index.mjs.map