export default async function run({ page, frame }) {
  const snap = await (frame ?? page).evaluate(() => window.__thyra?.snapshot());
  return snap;
}
