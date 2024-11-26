import { TrackInit } from "../../dist/track.esm.js";
const tt = TrackInit({
  dns: "https://example.com/app-id",
});
console.log("tt", tt);
window.tt = tt;
