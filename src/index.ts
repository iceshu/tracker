import { BaseBrowserClient } from "./core";
import { VueInstance } from "./core/options";
import {
  ConsolePlugin,
  DomPlugin,
  ErrorPlugin,
  HistoryPlugin,
  PerformancePlugin,
  RequestPlugin,
  ResourcePlugin,
  VuePlugin,
} from "./plugins";
import { BasePlugin } from "./typings/base";
import { IOptionsParams } from "./typings/options";
const pluginMap: Record<string, BasePlugin> = {
  'RequestPlugin': RequestPlugin,
  'DomPlugin': DomPlugin,
  'HistoryPlugin': HistoryPlugin,
  'ErrorPlugin': ErrorPlugin,
  'ConsolePlugin': ConsolePlugin,
  'PerformancePlugin': PerformancePlugin,
  'ResourcePlugin': ResourcePlugin,
};

export const TrackInit = (rawOptions: IOptionsParams) => {
  const supportPlugins = rawOptions.supportPlugins || [];
  const currentPlugins = supportPlugins
    .map((e) => {
      const plugin = pluginMap[e];
      return plugin;
    })
    .filter(Boolean);
  if (rawOptions.vue) {
    currentPlugins.push(VuePlugin);
  }
  const baseClient = new BaseBrowserClient(rawOptions, currentPlugins);
  return baseClient;
};
export function install(Vue: VueInstance, rawOptions: IOptionsParams) {
  const handler = Vue.config?.errorHandler;
  // vue项目在Vue.config.errorHandler中上报错误
  const baseClient = TrackInit(rawOptions);
  Vue.config!.errorHandler = function (err, vm, info) {
    console.log(err);
    baseClient.errorBoundary(err);
    if (handler) handler.apply(null, [err, vm, info]);
  };
}
export default { install, TrackInit };
export * from "./typings/base";
