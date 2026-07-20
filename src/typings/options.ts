import { IAnyObject } from "./common";
import type { BreadcrumbData } from "../core/typing";

export interface MemoryMonitorOptions {
  enabled?: boolean;
  sampleIntervalMs?: number; // 本地采样间隔，默认 60 秒；采样本身不上报
  sampleWindowSize?: number; // 趋势窗口采样点数量，默认 6（约 5 分钟）
  minUsedJSHeapSize?: number; // 触发异常所需的当前最低堆内存，默认 512 MiB
  minGrowthBytes?: number; // 窗口内持续增长的最低字节数，默认 256 MiB
  minGrowthRatio?: number; // 窗口内持续增长倍率，默认 1.5
  collectContext?: () => Record<string, unknown> | null;
}

export interface IOptionsParams {
  dsn: string;
  appVersion?: string; // 引用方应用的版本号，用于区分不同版本的问题
  maxBreadcrumbs?: number; // 用户行为栈最大长度，默认 DEFAULTS.MAX_BREADCRUMBS
  beforePushBreadcrumb?: (data: BreadcrumbData) => BreadcrumbData | null;
  filterXhrUrlRegExp?: RegExp;
  filterResourceUrlRegExp?: RegExp;
  skipLocalName?: (e: HTMLElement) => boolean;
  [key: string]: any;
  beforeDataReport?: (T: any) => any;
  vue?: VueInstance;
  handleHttpStatus?: (T: any) => boolean;
  throttleDelayTime?: 0;
  supportPlugins?: string[];
  getUserId?: () => string | number;
  overTime?: number; // 路由跳转慢检测阈值（毫秒），默认 3000，仅 HistoryPlugin 使用
  requestTimeout?: number; // HTTP 超时判定阈值（毫秒），默认 60000；决定超时文案与 ignoreErrors.timeoutUrls 的命中
  resourceLoadTime?: number;
  memoryMonitor?: MemoryMonitorOptions; // 极端内存增长监控；每个标签页会话最多上报一次
  wrapElementCallback?: (element: HTMLElement) => void;
  // 请求错误过滤配置（降噪）
  ignoreErrors?: {
    // 忽略「超时类」错误（Status=0 且耗时达到 requestTimeout*0.95）的 URL 模式列表（如非关键轮询：公告、未读数等）
    timeoutUrls?: string[];
    // 自定义错误过滤函数，返回 true 表示忽略该错误
    customFilter?: (data: {
      url: string;
      status: number;
      elapsedTime: number;
    }) => boolean;
  };
}

export interface VueInstance {
  // fix in Vue3 typescript's declaration file error
  [key: string]: any;
  config?: VueConfiguration;
  // mixin(hooks: { [key: string]: () => void }): void
  version: string;
}
export interface VueConfiguration {
  errorHandler?(err: Error, vm: ViewModel | any, info: string): void;
  warnHandler?(msg: string, vm: ViewModel | any, trace: string): void;
  [key: string]: any;
}
export interface ViewModel {
  [key: string]: any;
  $root?: Record<string, unknown>;
  $options?: {
    [key: string]: any;
    name?: string;
    // vue2.6
    propsData?: IAnyObject;
    _componentTag?: string;
    __file?: string;
    props?: IAnyObject;
  };
  $props?: Record<string, unknown>;
}
