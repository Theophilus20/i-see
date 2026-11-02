/**
 * The I SEE logo: the round mark (an open book with a magnifying glass) and the name.
 *
 * The mark is `mark.png` in this folder. To replace the whole logo with one image instead,
 * save it here as `logo.svg` (or `logo.png`) and restart the dev server.
 */
import mark from './mark.png';

const files = import.meta.glob<string>('./logo.{svg,png}', { eager: true, query: '?url', import: 'default' });
const custom = Object.values(files)[0];

export function Logo({ height = 28 }: { height?: number }) {
  if (custom) return <img src={custom} alt="I SEE" height={height} style={{ height, width: 'auto' }} />;
  return (
    <span className="logo" translate="no">
      <img className="logo-mark" src={mark} alt="" width={height} height={height} draggable={false} />
      <span className="wordmark" aria-label="I SEE">
        I SEE
      </span>
    </span>
  );
}
