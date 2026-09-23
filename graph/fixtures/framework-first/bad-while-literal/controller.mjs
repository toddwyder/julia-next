// Bad fixture using while with literal constant condition
export function whileLiteral() {
  while (1) {
    break;
  }
}
