// Bad fixture using hand-built wait or retry loops: while (true) and for (;;)
export function handBuiltLoops() {
  while (true) {
    break;
  }

  for (;;) {
    break;
  }
}
