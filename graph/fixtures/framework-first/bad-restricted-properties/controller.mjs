// Bad fixture calling file write properties on an fs object and timers on global objects
import fs from 'node:fs';

export function writeSyncProgress() {
  fs.writeFileSync('progress.txt', 'working');
  fs.createWriteStream('stream.log');
  globalThis.setTimeout(() => {}, 100);
  global.setInterval(() => {}, 100);
  window.setTimeout(() => {}, 100);
}
