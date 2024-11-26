import { BasePlugin } from "../typings/base";
import { IOptionsParams } from "../typings/options";
import { getTimestamp, readonly } from "../utils";
import { Breadcrumb } from "./breadcrumb";
import { EVENT_TYPE, PLUGIN_TYPE, STATUS_CODE } from "./constant";
import { Global } from "./global";
import { ReportDataController } from "./report";

export class BaseBrowserClient {
  #breadcrumb: Breadcrumb;
  #options: IOptionsParams;
  #reportData: ReportDataController;
  #registeredPlugins: Map<string, BasePlugin>;
  #baseDeviceInfo = {}
  constructor(options: IOptionsParams, plugins: BasePlugin[]) {
    this.#options = readonly(options);
    this.#registeredPlugins = new Map();
    const { maxBreadcrumbs = 20, beforePushBreadcrumb } = options;
    this.#breadcrumb = new Breadcrumb(maxBreadcrumbs, beforePushBreadcrumb);
    this.#reportData = new ReportDataController({
      options,
      breadcrumb: this.#breadcrumb,
    });
    Global.options = options;
    Global.breadcrumb = this.#breadcrumb;
    Global.reportData = this.#reportData;
    this.initializePlugins(plugins);
  }

  protected initializePlugins(plugins: BasePlugin[]): void {
    const PluginPrams = {
      breadcrumb: this.#breadcrumb,
      options: this.#options,
      reportData: this.#reportData,
      baseDeviceInfo: this.#baseDeviceInfo,
      setBaseDeviceInfo: (deviceInfo: any) => {
        this.#baseDeviceInfo = deviceInfo;

      }
    };
    Global.plugins = plugins.map((Plugin: any) => {
      const plugin = new Plugin(PluginPrams);
      this.#registeredPlugins.set(plugin.name, plugin);
    });
  }
  getOptions(): Readonly<IOptionsParams> {
    throw this.#options;
  }
  log(value: any) {
    this.#reportData?.send({
      type: EVENT_TYPE.CUSTOM,
      status: STATUS_CODE.OK,
      name: EVENT_TYPE.CUSTOM,
      data: {
        value,
      },
      time: getTimestamp(),
    });
  }

  errorBoundary(err: Error) {
    const errorPlugin = this.#registeredPlugins.get(PLUGIN_TYPE.ERROR_PLUGIN);
    //@ts-ignore
    errorPlugin?.handleError(err);
  }
}
