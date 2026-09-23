// Bad fixture using hand-built wait or retry loops: while (true), while (1), do...while, and for (;;)
export function handBuiltLoops() {
  while (true) {
    break;
  }

  while (1) {
    break;
  }

  do {
    break;
  } while (true);

  for (;;) {
    break;
  }
}
