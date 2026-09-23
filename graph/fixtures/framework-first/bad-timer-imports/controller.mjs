// Bad fixture importing setTimeout and setInterval from timer modules
import { setTimeout as pTimeout } from 'node:timers/promises';
import { setInterval as pInterval } from 'timers/promises';
import { setTimeout as tTimeout } from 'timers';
import { setInterval as tInterval } from 'node:timers';

export function runTimerImports() {
  pTimeout(100);
  pInterval(100);
  tTimeout(() => {}, 100);
  tInterval(() => {}, 100);
}
