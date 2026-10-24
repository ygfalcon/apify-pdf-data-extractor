// Simulates catastrophic regex backtracking: blocks its thread forever.
// eslint-disable-next-line no-constant-condition
while (true) { /^(a+)+$/.test('a'.repeat(40) + 'b'); }
