import { IAnyObject } from "./common";

export interface IOptionsParams {
  dsn: string;
  appVersion?: string; // 引用方应用的版本号，用于区分不同版本的问题
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
  overTime?: number;
  resourceLoadTime?: number;
  wrapElementCallback?: (element: HTMLElement) => void;
  // 请求错误过滤配置（降噪）
  ignoreErrors?: {
    // 忽略超时错误的 URL 模式列表（如非关键接口：公告、广告等）
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
