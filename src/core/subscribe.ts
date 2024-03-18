export class PubSub {
  private static _pubSubMap = new WeakMap<object, Set<Function>>();
  static on(obj: object, listener: Function): void {
    let listeners = PubSub._pubSubMap.get(obj);
    if (!listeners) {
      listeners = new Set<Function>();
      PubSub._pubSubMap.set(obj, listeners);
    }
    listeners.add(listener);
  }
  static off(obj: object, listener: Function): void {
    const listeners = PubSub._pubSubMap.get(obj);
    if (listeners) {
      listeners.delete(listener);
    }
  }
  static emit(obj: object, ...args: any[]): void {
    const listeners = PubSub._pubSubMap.get(obj);
    if (listeners) {
      listeners.forEach((listener) => listener(...args));
    }
  }
}
