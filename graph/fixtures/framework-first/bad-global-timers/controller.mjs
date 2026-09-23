// Bad fixture calling setTimeout and setInterval on global objects
export function scheduleWithGlobals() {
  globalThis.setTimeout(() => {}, 1000);
  globalThis.setInterval(() => {}, 2000);
  global.setTimeout(() => {}, 1000);
  global.setInterval(() => {}, 2000);
  window.setTimeout(() => {}, 1000);
  window.setInterval(() => {}, 2000);
}
