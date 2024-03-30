import {
  DomPlugin,
  ConsolePlugin,
  HistoryPlugin,
  ErrorPlugin,
  PerformancePlugin,
  VuePlugin,
  RequestPlugin,
} from "./plugins";
import { IOptionsParams, ViewModel, VueInstance } from "./core/options";
import { BaseClient } from "./core";
const defaultPlugins: any = [
  RequestPlugin,
  DomPlugin,
  HistoryPlugin,
  ErrorPlugin,
  ConsolePlugin,
  PerformancePlugin,
];
const GLOBAL: any = window;
export const TrackInit = (rawOptions: IOptionsParams) => {
  if (rawOptions.vue) {
    defaultPlugins.push(VuePlugin);
  }
  const baseClient = new BaseClient(rawOptions, defaultPlugins);
  GLOBAL.__TRACK__ = baseClient;
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
