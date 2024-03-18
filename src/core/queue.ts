import { _global } from "./global";
import { voidFun } from "./typing";
export class Queue {
  private static instance: Queue;
  private stack: Function[];
  private isFlushing: boolean;

  constructor() {
    this.stack = [];
    this.isFlushing = false;

    // 在这里添加代码，实现单例模式
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
    const temp = this.stack.slice(0);
    this.stack = [];
    this.isFlushing = false;
    for (let i = 0; i < temp.length; i++) {
      temp[i]();
    }
  }
}

// 使用单例模式
