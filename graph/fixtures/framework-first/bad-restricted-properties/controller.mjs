// Bad fixture calling file write properties on an fs object
import fs from 'node:fs';

export function writeSyncProgress() {
  fs.writeFileSync('progress.txt', 'working');
  fs.createWriteStream('stream.log');
}
