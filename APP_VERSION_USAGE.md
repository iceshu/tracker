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

