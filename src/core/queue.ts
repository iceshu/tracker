import { _global } from "./global";
import { voidFun } from "./typing";
export class Queue {
  private static instance: Queue;
  private stack: Function[];
  private isFlushing: boolean;

  constructor() {
    this.stack = [];
    this.isFlushing = false;
  }

  static getInstance(): Queue {
    if (!Queue.instance) {
      Queue.instance = new Queue();
    }
    return Queue.instance;
  }

  // 添加方法到队列
  addFn(fn: voidFun): void {
    if (typeof fn !== "function") return;
    if (!("requestIdleCallback" in _global || "Promise" in _global)) {
      fn();
      return;
    }
    this.stack.push(fn);
    if (!this.isFlushing) {
      this.isFlushing = true;
      // 优先使用requestIdleCallback
      if ("requestIdleCallback" in _global) {
        requestIdleCallback(() => this.flushStack());
      } else {
        // 其次使用微任务上报
        Promise.resolve().then(() => this.flushStack());
      }
    }
  }

  clear(): void {
    this.stack = [];
  }

  get allStack(): Function[] {
    return this.stack;
  }

  flushStack(): void {
    if (this.stack.length === 0) return;

    const temp = this.stack;
    this.stack = [];
    this.isFlushing = false;

    // 使用 for...of 更高效
    for (const fn of temp) {
      try {
        fn();
      } catch (error) {
        console.error("Queue execution error:", error);
      }
    }
  }
}
