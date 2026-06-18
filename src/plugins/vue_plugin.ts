import { Breadcrumb } from "../core/breadcrumb";
import { ViewModel, VueInstance } from "../core/options";
import { ReportDataController } from "../core/report";
import { IPluginParams } from "./common";
import { _global } from "../core/global";
import { getLocationHref, getTimestamp, isObject } from "../utils";
import { EVENT_TYPE } from "../core/constant";
import { IAnyObject } from "../core/typing";
import { IOptionsParams } from "../typings/options";

type VueErrorHandler = (err: Error, vm: any, info: string) => void;

export class VuePlugin {
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  private vue: VueInstance | undefined;
  private originErrorHandler: VueErrorHandler | undefined;
  private isSetup = false;
  constructor(params: IPluginParams) {
    const { options, breadcrumb, reportData } = params;
    this.options = options;
    this.breadcrumb = breadcrumb;
    this.reportData = reportData;
    this.setup();
  }
  setup() {
    if (this.isSetup) return;
    const Vue = this.options?.vue;
    if (Vue && Vue.config) {
      this.isSetup = true;
      const that = this;
      this.vue = Vue;
      const originErrorHandle = Vue.config.errorHandler;
      this.originErrorHandler = originErrorHandle;

      Vue.config.errorHandler = function (
        err: Error,
        vm: ViewModel,
        info: string
      ): void {
        const data = {
          type: EVENT_TYPE.VUE,
          // 必须用闭包 that：运行时 this 是 Vue 调用上下文，this.breadcrumb 为 undefined 会抛错
          category: that.breadcrumb.getCategory(EVENT_TYPE.VUE),
          message: `${err.message}(${info})`,
          url: getLocationHref(),
          name: err.name,
          stack: err.stack || [],
          time: getTimestamp(),
        };

        that.handleData(data, vm);
        return originErrorHandle?.(err, vm, info);
      };
    }
  }
  // 还原 Vue 的 errorHandler，避免重复挂载
  destroy() {
    if (this.vue?.config) {
      this.vue.config.errorHandler = this.originErrorHandler;
    }
    this.isSetup = false;
  }
  handleData(collectedData: any, vm: ViewModel) {
    const sendData = this.transformData(collectedData, vm);
    this.reportData.send(sendData);
  }
  transformData(collectedData: any, vm: ViewModel) {
    const Vue = this.options.vue;
    if (Vue?.version) {
      switch (getBigVersion(Vue?.version)) {
        case 2:
          return { ...collectedData, ...vue2VmHandler(vm) };
        case 3:
          return { ...collectedData, ...vue3VmHandler(vm) };
        default:
          return collectedData;
      }
    }
  }
}
export function getBigVersion(version: string) {
  return Number(version.split(".")[0]);
}
export function vue2VmHandler(vm: ViewModel) {
  let componentName = "";
  if (vm.$root === vm) {
    componentName = "root";
  } else {
    const name = vm._isVue
      ? (vm.$options && vm.$options.name) ||
      (vm.$options && vm.$options._componentTag)
      : vm.name;
    componentName =
      (name ? "component <" + name + ">" : "anonymous component") +
      (vm._isVue && vm.$options && vm.$options.__file
        ? " at " + (vm.$options && vm.$options.__file)
        : "");
  }
  return {
    componentName,
    propsData: vm.$options && vm.$options.propsData,
  };
}
export function vue3VmHandler(vm: ViewModel) {
  let componentName = "";
  if (vm.$root === vm) {
    componentName = "root";
  } else {
    const name = vm.$options && vm.$options.name;
    componentName = name ? "component <" + name + ">" : "anonymous component";
  }
  return {
    componentName,
    propsData: getObjectWithForIn(vm.$props as any),
  };
}
/**
 * 解决Vue3抛出的proxy对象循环引用的问题
 *
 * @export
 * @template T
 * @param {IAnyObject} obj
 * @return {*}  {T}
 */
export function getObjectWithForIn<T = IAnyObject>(obj: IAnyObject): T {
  if (isObject(obj)) return obj as unknown as T;
  const result: IAnyObject = {};
  for (const key in obj) {
    result[key] = obj[key];
  }
  return result as T;
}
