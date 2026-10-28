# 应用版本追踪使用说明

## 概述

SDK 支持在初始化时传入**引用方应用的版本号**（`appVersion`），用于在监控数据中区分不同版本的应用产生的问题。

## 使用方法

### 基础用法

在调用 `TrackInit` 时，通过 `appVersion` 参数传入你的应用版本号：

```javascript
import { TrackInit } from 'tc-tracker';

const tracker = TrackInit({
  dsn: 'https://your-api.com/report',
  appVersion: '1.0.0', // 你的应用版本号
  supportPlugins: [
    'RequestPlugin',
    'DomPlugin',
    'HistoryPlugin',
    'ErrorPlugin',
    'ConsolePlugin',
  ],
});
```

### 在 Vue 项目中使用

```javascript
import { install } from 'tc-tracker';
import Vue from 'vue';

Vue.use(install, {
  dsn: 'https://your-api.com/report',
  appVersion: '2.1.5', // 你的 Vue 应用版本号
  vue: Vue,
  supportPlugins: ['ErrorPlugin', 'ConsolePlugin'],
});
```

### 动态获取版本号

如果你的应用版本号存储在配置文件或环境变量中，可以动态获取：

```javascript
// 从 package.json 获取（需要构建工具支持）
import { version } from './package.json';

const tracker = TrackInit({
  dsn: 'https://your-api.com/report',
  appVersion: version,
  supportPlugins: ['ErrorPlugin'],
});
```

```javascript
// 从环境变量获取
const tracker = TrackInit({
  dsn: 'https://your-api.com/report',
  appVersion: process.env.REACT_APP_VERSION || '1.0.0',
  supportPlugins: ['ErrorPlugin'],
});
```

## 数据结构

当上报监控数据时，`appVersion` 会自动附加到数据中：

```javascript
{
  "type": "error",
  "message": "Uncaught TypeError: Cannot read property 'x' of undefined",
  "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "appVersion": "1.0.0",  // 应用版本号
  "pageUrl": "https://your-app.com/page",
  "sessionID": "session-id-xxx",
  "userInfo": {
    "userId": "user-123",
    "sdkVersion": "0.2.3",  // SDK 版本号（自动注入）
    "apikey": "your-api-key"
  },
  "deviceInfo": { ... },
  "breadcrumb": [ ... ]
}
```

## 使用场景

### 1. 版本问题追踪

通过 `appVersion` 字段，你可以：
- 快速定位某个版本特有的问题
- 对比不同版本的错误率
- 追踪版本升级后的问题修复情况

### 2. 灰度发布监控

```javascript
const tracker = TrackInit({
  dsn: 'https://your-api.com/report',
  appVersion: `${version}-${isGrayRelease ? 'gray' : 'stable'}`,
  supportPlugins: ['ErrorPlugin'],
});
```

### 3. 多环境版本管理

```javascript
const getAppVersion = () => {
  const env = process.env.NODE_ENV;
  const version = process.env.APP_VERSION || '1.0.0';
  return `${version}-${env}`; // 例如：1.0.0-production
};

const tracker = TrackInit({
  dsn: 'https://your-api.com/report',
  appVersion: getAppVersion(),
  supportPlugins: ['ErrorPlugin'],
});
```

## 版本号规范建议

推荐使用语义化版本号（Semantic Versioning）：

- **主版本号**：不兼容的 API 修改（如：`2.0.0`）
- **次版本号**：向下兼容的功能新增（如：`1.1.0`）
- **修订号**：向下兼容的问题修正（如：`1.0.1`）

示例格式：
- `1.0.0` - 标准版本号
- `1.0.0-beta.1` - 测试版本
- `1.0.0-alpha` - 内测版本
- `1.0.0-rc.1` - 候选版本

## 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `appVersion` | `string` | 否 | 引用方应用的版本号，用于区分不同版本的问题 |

## 注意事项

1. `appVersion` 是可选字段，不传入时该字段为 `undefined`
2. SDK 会自动注入 SDK 自身的版本号到 `userInfo.sdkVersion` 字段
3. 建议在应用发布时务必传入 `appVersion`，便于后续问题追踪
4. 版本号建议使用字符串类型，支持任意格式

## SDK 版本说明

- **SDK 版本号**（`sdkVersion`）：由 SDK 自动注入，表示监控 SDK 的版本
- **应用版本号**（`appVersion`）：由你手动传入，表示你的应用版本

两者相互独立，共同帮助你更好地定位和解决问题。

## 本地持久化与刷新后恢复

SDK 默认将经过 `beforeDataReport` 过滤的待发送事件写入 IndexedDB，再发送请求。网络失败、HTTP 非 2xx 或请求超时不会删除记录；下次 `TrackInit` 会异步补发，不阻塞初始化。

```javascript
const tracker = TrackInit({
  dsn: 'https://your-api.com/report',
  apikey: 'your-project',
  appVersion: '1.0.0',
  supportPlugins: ['ErrorPlugin', 'PerformancePlugin'],
  memoryMonitor: {
    enabled: true,
    sampleIntervalMs: 60_000,
  },
  recovery: {
    enabled: true,
    maxEvents: 100,
    maxBytes: 1024 * 1024,
    maxAgeMs: 24 * 60 * 60 * 1000,
  },
});
```

### 事件与诊断快照

| 数据 | 保存和恢复行为 |
|------|----------------|
| 待发送事件 | 过滤完成后固定为 JSON，事务提交后发送；收到 HTTP 2xx 才删除 |
| `memoryDiagnosticSnapshot` | 启用 `PerformancePlugin` 和 `memoryMonitor.enabled` 后，首个有效内存样本及后续采样更新本页快照，不立即发送；同一标签页下一次启用监控时恢复 |
| `memoryAnomaly` | 检测到持续极端增长时上报；确认送达后标记本会话已上报，恢复补发的确认同样生效；诊断采样继续进行 |

补发保留事件原来的 `appVersion`、时间、URL、用户、会话和 `eventId`，不会套用新页面的版本或用户信息，也不会再次执行新页面的 `beforeDataReport`。正常刷新、导航、关闭及进程崩溃都可能留下快照；**`memoryDiagnosticSnapshot` 不代表已确认发生 crash 或 OOM**。

### 容量、隐私与兼容边界

- `maxEvents`、`maxBytes` 按 `dsn + apikey` 隔离，快照也计入限额；超限淘汰最旧记录，过期记录在访问存储时清理。字节数指 JSON payload 的 UTF-8 大小，不包含 IndexedDB 元数据。
- 单个诊断快照最多 64 KiB，最多包含 12 个内存样本、20 条最近行为和 5 条最近长任务。超限、过滤拒绝或 hook 抛错会移除本页旧快照，避免保留已不允许保存的数据。
- 沿用内存监控采样间隔：默认 60 秒，最短 30 秒。`collectContext` 现在也用于周期快照，应保持轻量，并避免采集敏感数据；`beforeDataReport` 在数据落盘前执行。
- 设置 `recovery: { enabled: false }` 后，不读取、写入或补发持久化数据；普通事件仍直接发送。此设置不会删除已有记录，重新启用后仍可能补发未过期记录。
- 诊断快照要求顶层页面、可用的 `sessionStorage` 和 Web Locks，以及浏览器提供有效的 `performance.memory`。不满足条件时不保证诊断快照恢复；iframe 和缺少 Web Locks 的环境仍支持普通事件待发送队列。
- 诊断快照仅在原标签页恢复，并要求当前仍启用性能插件和内存监控；其他活跃标签页的快照不会被领取。同一文档多次初始化不会恢复自己的快照。
- IndexedDB 不可用、写入超时或存储空间不足时，普通事件降级为直接发送，不将存储错误抛给业务；此时无法保证刷新后恢复。超过存储总容量的普通事件也只做直接发送。
- `destroy()` 停止采样和后续发送、取消当前请求，但保留已落盘的未确认事件与最后快照。崩溃时只能恢复最后一次成功提交的数据，尚未提交的最后一段仍可能丢失。

### 收集端契约

上报使用可检查响应的 `fetch` POST，请求体为 JSON。跨域收集接口必须正确配置 CORS；只有可读取的 HTTP 2xx 响应才被视为确认，10 秒未完成的请求按失败保留，不做无限重试。

服务端应以项目和 `eventId` 作为幂等键，重复提交仍返回成功。服务端可能已经接收事件，但浏览器在删除本地记录前崩溃，因此补发可能重复；稳定 `eventId` 并不等于客户端能保证 exactly-once。本仓库仅包含 SDK，不包含收集端去重实现。


