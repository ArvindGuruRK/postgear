/**
 * Numbers as people read them: "1,440", "0.5". Written by hand rather than
 * with `Intl`, so the browser, the API and the tests print exactly the same
 * text whatever locale data the runtime carries.
 */

/** Groups the whole part with commas and keeps at most two decimals, without trailing zeros. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const negative = value < 0;
  const rounded = Math.round(Math.abs(value) * 100) / 100;
  const [whole, fraction] = rounded.toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimals = fraction.replace(/0+$/, '');
  const text = decimals ? `${grouped}.${decimals}` : grouped;
  return negative && rounded !== 0 ? `-${text}` : text;
}
