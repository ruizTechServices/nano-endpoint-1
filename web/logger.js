const LEVEL_METHODS = Object.freeze({
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
});

function consoleSink(entry) {
  const method = LEVEL_METHODS[entry.level] ?? "log";
  console[method](entry);
}

export function createLogger(initialSink = consoleSink) {
  let sink = initialSink;

  function emit(level, event, fields = {}) {
    sink({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields,
    });
  }

  return Object.freeze({
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    replaceSink(nextSink) {
      if (typeof nextSink !== "function") throw new TypeError("Logger sink must be a function");
      sink = nextSink;
    },
  });
}

export const logger = createLogger();

