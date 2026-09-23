// Valid fixture using an ESLint comment with a reason and docs link for JUL-115 tracking
// eslint-disable-next-line no-restricted-globals -- permitted wait loop per JUL-115 docs https://example.com/docs/retry
export const scheduledId = setTimeout(() => {
  // legitimate exception
}, 1000);
