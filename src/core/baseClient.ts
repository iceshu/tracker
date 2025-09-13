import { BasePlugin } from "../typings/base";
import { IOptionsParams } from "../typings/options";
import { getTimestamp, readonly } from "../utils";
import { Breadcrumb } from "./breadcrumb";
import { EVENT_TYPE, PLUGIN_TYPE, STATUS_CODE, DEFAULTS } from "./constant";
import { Global } from "./global";
import { ReportDataController } from "./report";

export class BaseBrowserClient {
  #breadcrumb: Breadcrumb;
  #options: IOptionsParams;
  #reportData: ReportDataController;
  #registeredPlugins: Map<string, BasePlugin>;
  #baseDeviceInfo = {};
  constructor(options: IOptionsParams, plugins: BasePlugin[]) {
    this.#options =
      process.env.NODE_ENV === "test" ? options : readonly(options);
    this.#registeredPlugins = new Map();
    const { maxBreadcrumbs = DEFAULTS.MAX_BREADCRUMBS, beforePushBreadcrumb } =
      options;
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
      },
    };
    Global.plugins = plugins.map((Plugin: any) => {
      const plugin = new Plugin(PluginPrams);
      this.#registeredPlugins.set(plugin.name, plugin);
      // 调用插件的 setup 方法来初始化插件
      if (typeof plugin.setup === "function") {
        plugin.setup();
      }
      return plugin;
    });
  }
  getOptions(): Readonly<IOptionsParams> {
    return this.#options;
  }

  getPlugin(name: string) {
    return this.#registeredPlugins.get(name);
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
