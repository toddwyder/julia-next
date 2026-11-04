export const drain = (items) => {
  let left = items;
  while (left.length > 0) left = left.slice(1);
  return left;
};
