import { createErrorLogger } from "./vendor/browser-error-logger.js";

const endpointBase = window.WIZARD_FIGHT_SOCKET_URL || "http://localhost:5055";

const logger = createErrorLogger({
  endpoint: `${endpointBase}/client-errors`,
  appName: "wizard-fight-frontend",
  appVersion: "dev",
  captureUnhandled: true,
  capturePromiseRejections: true,
  captureConsoleErrors: true,
  batchSize: 1,
  flushInterval: 1000,
  debug: true,
  filter: (report) => {
    if (report.filename?.includes("chrome-extension://")) return false;
    if (report.message?.includes("ResizeObserver")) return false;
    return true;
  },
  onError: (error) => {
    console.warn("[wizard-fight] error logger failed", error);
  },
});

window.wizardFightLogger = logger;