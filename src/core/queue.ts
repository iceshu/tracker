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
    // 用 typeof 判断而非 `in`：`in` 只检查 key 是否存在、不看值，
    // polyfill 或混合容器把 requestIdleCallback 赋成 undefined 的环境
    // 会被判定为可用，随后调用直接抛 TypeError
    const hasIdleCallback = typeof _global.requestIdleCallback === "function";
    const hasPromise = typeof _global.Promise === "function";
    if (!hasIdleCallback && !hasPromise) {
      fn();
      return;
    }
    this.stack.push(fn);
    if (!this.isFlushing) {
      this.isFlushing = true;
      // 优先使用requestIdleCallback
      if (hasIdleCallback) {
        // 保持在 _global 上调用，避免脱离 this 触发 Illegal invocation
        _global.requestIdleCallback(() => this.flushStack());
      } else {
        // 其次使用微任务上报
        _global.Promise.resolve().then(() => this.flushStack());
      }
    }
  }

  clear(): void {
    this.stack = [];
    // 一并复位排队标记：否则已排期的 flushStack 会因栈空提前返回，
    // isFlushing 永久停在 true，此后 addFn 只入栈不再排期 ——
    // 上报静默停止，队列还会无限增长
    this.isFlushing = false;
  }

  get allStack(): Function[] {
    return this.stack;
  }

  flushStack(): void {
    // 栈空时也要复位，让「isFlushing 为真 ⇒ 确有一次 flush 在排期」这个不变式
    // 不依赖调用方是否用过 clear()
    if (this.stack.length === 0) {
      this.isFlushing = false;
      return;
    }

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
