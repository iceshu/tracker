import { Breadcrumb } from "./core/breadcrumb";
import { Global, global } from "./core/global";
import {
  DomPlugin,
  ConsolePlugin,
  HistoryPlugin,
  ErrorPlugin,
  PerformancePlugin,
  VuePlugin,
  RequestPlugin,
} from "./plugins";
import { IOptionsParams } from "./core/options";
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
  const baseClient = new BaseClient(rawOptions, defaultPlugins);
  GLOBAL.__TRACK__ = baseClient;
  return global;
};
export default Global;
