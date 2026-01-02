import { getTimestamp } from "../utils";
import { BREADCRUMB_TYPE, EVENT_TYPE, DEFAULTS } from "./constant";
import { BreadcrumbData } from "./typing";

export class Breadcrumb {
  maxBreadcrumbs: number; // 用户行为存放的最大长度
  beforePushBreadcrumb: unknown = null;
  stack: BreadcrumbData[];
  constructor(
    maxStackSize: number = DEFAULTS.MAX_BREADCRUMBS,
    private beforePushCallback:
      | ((data: BreadcrumbData) => BreadcrumbData)
      | null = null
  ) {
    this.stack = [];
    this.maxBreadcrumbs = maxStackSize;
  }
  /**
   * Pushes a breadcrumb to the breadcrumb stack.
   */
  push(data: BreadcrumbData): void {
    if (this.beforePushCallback) {
      const prepared = this.beforePushCallback(data);
      if (prepared) {
        this.immediatePush(prepared);
      }
    } else {
      this.immediatePush(data);
    }
  }
  immediatePush(data: BreadcrumbData): void {
    data.time ??= getTimestamp();
    if (this.stack.length >= this.maxBreadcrumbs) {
      this.shift();
    }
    const insertIndex = this.findInsertIndex(data.time);
    this.stack.splice(insertIndex, 0, data);
  }
  private findInsertIndex(time: number): number {
    // 小数组时直接遍历更快（避免二分查找的开销）
    if (this.stack.length < 10) {
      let i = this.stack.length - 1;
      while (i >= 0 && this.stack[i].time! > time) {
        i--;
      }
      return i + 1;
    }

    // 大数组时使用二分查找
    let left = 0;
    let right = this.stack.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this.stack[mid].time! <= time) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return left;
  }
  shift(): boolean {
    return this.stack.shift() !== undefined;
  }
  clear(): void {
    this.stack = [];
  }
  getStack(): BreadcrumbData[] {
    return this.stack;
  }
  getCategory(type: EVENT_TYPE): BREADCRUMB_TYPE {
    switch (type) {
      // 接口请求
      case EVENT_TYPE.XHR:
      case EVENT_TYPE.FETCH:
        return BREADCRUMB_TYPE.HTTP;

      // 用户点击
      case EVENT_TYPE.CLICK:
        return BREADCRUMB_TYPE.CLICK;

      // 路由变化
      case EVENT_TYPE.HISTORY:
      case EVENT_TYPE.HASHCHANGE:
        return BREADCRUMB_TYPE.ROUTE;

      // 加载资源
      case EVENT_TYPE.RESOURCE:
        return BREADCRUMB_TYPE.RESOURCE;

      // Js代码报错
      case EVENT_TYPE.UNHANDLEDREJECTION:
      case EVENT_TYPE.ERROR:
        return BREADCRUMB_TYPE.CODE_ERROR;

      case EVENT_TYPE.CONSOLE:
        return BREADCRUMB_TYPE.CONSOLE;
      // 用户自定义
      default:
        return BREADCRUMB_TYPE.CUSTOM;
    }
  }
}
