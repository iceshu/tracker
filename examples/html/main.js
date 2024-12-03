import { TrackInit } from "../../dist/track.esm.js";
const tt = TrackInit({
  dsn: "https://hapi.akool.io/monitor/collect",
  supportPlugins: [
    "RequestPlugin",
    "DomPlugin",
    "HistoryPlugin",
    "ErrorPlugin",
    "ConsolePlugin",
  ],
});
window.tt = tt;
