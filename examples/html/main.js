import { TrackInit } from "../../dist/track.esm.js";
const tt = TrackInit({
  dns: "https://hapi.akool.io/monitor/collect",
  supportPlugins: [
    "RequestPlugin",
    "DomPlugin",
    "HistoryPlugin",
    "ErrorPlugin",
    "ConsolePlugin",
    "PerformancePlugin",
  ],
});
window.tt = tt;
