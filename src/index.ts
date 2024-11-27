import { BaseBrowserClient } from "./core";
import { VueInstance } from "./core/options";
import {
  ConsolePlugin,
  DomPlugin,
  ErrorPlugin,
  HistoryPlugin,
  PerformancePlugin,
  RequestPlugin,
  VuePlugin
} from "./plugins";
import { BasePlugin } from "./typings/base";
import { IOptionsParams } from "./typings/options";
let defaultPlugins: BasePlugin[] = [
  RequestPlugin,
  DomPlugin,
  HistoryPlugin,
  ErrorPlugin,
  ConsolePlugin,
  PerformancePlugin,
];
export const TrackInit = (rawOptions: IOptionsParams) => {

  const supportPlugins = rawOptions.supportPlugins || [];
  if (supportPlugins.length) {
    defaultPlugins = defaultPlugins.filter((item) => supportPlugins.includes(item.name));
  }
  if (rawOptions.vue) {
    defaultPlugins.push(VuePlugin);
  }
  const baseClient = new BaseBrowserClient(rawOptions, defaultPlugins);
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
