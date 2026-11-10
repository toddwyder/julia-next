import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [modulePath, directory, mode] = process.argv.slice(2);
const originalExists = fs.existsSync;
if (mode === 'pause-after-recheck') {
  let checks = 0;
  fs.existsSync = function existsSync(path) {
    const answer = originalExists(path);
    if (path === join(directory, 'stop.lock') && ++checks === 2) {
      fs.writeFileSync(join(directory, 'ready'), 'checked');
      const deadline = Date.now() + 10000;
      while (!originalExists(join(directory, 'resume'))) {
        if (Date.now() > deadline) throw new Error('Race orchestrator timed out');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
    return answer;
  };
  syncBuiltinESMExports();
}
const { createSliceControl } = await import(pathToFileURL(modulePath));
const controller = createSliceControl({ directory, dollarCap: 4, tokenCap: 2000000 });
try {
  if (mode === 'post-stop') controller.stop('planted_formal_stop');
  controller.assertStart();
  console.log(JSON.stringify({ admitted: true, record: controller.snapshot() }));
} catch (error) {
  console.log(JSON.stringify({ admitted: false, message: error.message }));
}
