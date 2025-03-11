import { TrackInit } from "../../dist/track.esm.js";
// 定义需要忽略的消息模式
export const ignoredPatterns = [
  "twitter",
  "t.co/1/i/adsct",
  "Cannot parse given Error object",
  "px.ads.linkedin.",
  "/faceswap/gallery/cover/",
  "googleads.g.doubleclick.net",
  "googletagmanager",
  "aloha-extension://nativeCall",
  ".agora.",
  "/videos/faceswap/gallery/cosplay/",
  "web-2.statscollector.sd-rtn.com",
  "statscollector-1.agora.io",
  "statscollector",
  ".clarity.",
  ".redditstatic.",
  ".g2crowd.",
];

// 创建正则表达式
export const createFilterRegExp = (patterns) => {
  // 转义特殊字符并将模式组合成一个正则表达式
  const escapedPatterns = patterns.map((pattern) =>
    pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  return new RegExp(escapedPatterns.join("|"));
};

const tt = TrackInit({
  dsn: "https://hapi.akool.io/monitor/collect",
  supportPlugins: [
    "RequestPlugin",
    "DomPlugin",
    "HistoryPlugin",
    "ErrorPlugin",
    "ConsolePlugin",
  ],
  filterXhrUrlRegExp: createFilterRegExp(ignoredPatterns),
});
window.tt = tt;
