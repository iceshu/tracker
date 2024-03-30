import { IAnyObject } from "./typing";

export interface IOptionsParams {
  dns: string;
  version?: string;
  filterXhrUrlRegExp?: RegExp;
  [key: string]: any;
  beforeDataReport?: (T: any) => any;
  vue?: VueInstance;
  throttleDelayTime?: 0;
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
