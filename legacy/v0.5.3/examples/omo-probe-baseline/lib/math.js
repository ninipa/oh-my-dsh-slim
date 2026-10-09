function add(a, b) { return a + b; }
function mul(a, b) { return a * b; }
function percentage(part, whole) {
  if (whole === 0) return null;
  return Math.round((part / whole) * 100 * 100) / 100;
}
module.exports = { add, mul, percentage };
