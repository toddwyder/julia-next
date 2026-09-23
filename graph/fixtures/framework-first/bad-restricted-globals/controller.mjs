// Bad fixture using setTimeout and setInterval directly instead of framework features
export function scheduleWork() {
  setTimeout(() => {
    // hand-built timer
  }, 1000);
  setInterval(() => {
    // hand-built interval
  }, 5000);
}
