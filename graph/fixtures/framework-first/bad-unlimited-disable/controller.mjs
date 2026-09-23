// Bad fixture using unlimited disable comment without naming specific rules
/* eslint-disable -- broad disable without specific rule names */
export function bypassEverything() {
  setTimeout(() => {}, 1000);
}
