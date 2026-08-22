import type { Stats } from '../api/client';
import { Button } from '../components/ui/Button';
import { ImagePlaceholder } from '../components/ui/ImagePlaceholder';
import { VinylDisc } from '../components/ui/VinylDisc';
import type { SiteSettings } from '../types/collection';
import styles from './Hero.module.css';

/**
 * Used until the collector sets their own copy. Keeping the design's words as
 * the fallback means an empty settings table still renders the page as drawn,
 * rather than a hero full of blanks.
 */
const FALLBACK = {
  eyebrow: 'Personal vinyl library · est. 2009',
  headline: 'Andriy keeps\nthe records\nspinning',
  lede: 'Every sleeve here has been played at least twice — no shrink-wrap investments.',
};

interface HeroProps {
  stats: Stats | null;
  settings: SiteSettings | null;
}

export function Hero({ stats, settings }: HeroProps): JSX.Element {
  const eyebrow = settings?.heroEyebrow || FALLBACK.eyebrow;
  const headline = settings?.heroHeadline || FALLBACK.headline;
  const lede = settings?.heroLede || FALLBACK.lede;

  return (
    <header className={styles.hero} id="top">
      <div className={styles.copy}>
        <span className={styles.eyebrow}>{eyebrow}</span>
        {/* Line breaks are composition, not wrapping: the headline is split
            exactly where the collector typed a newline. */}
        <h1 className={styles.title}>
          {headline.split('\n').map((line, index) => (
            <span key={line + String(index)}>
              {index > 0 && <br />}
              {line}
            </span>
          ))}
        </h1>
        <p className={styles.lede}>
          {stats
            ? `${stats.totalRecords} ${stats.totalRecords === 1 ? 'record' : 'records'} · `
            : ''}
          {lede}
        </p>
        <div className={styles.actions}>
          <Button href="#collection" size="lg">
            Browse Collection
          </Button>
          <Button href="#setup" variant="secondary" size="lg">
            The Setup
          </Button>
        </div>
      </div>

      <div className={styles.media}>
        <ImagePlaceholder
          ratio="4 / 5"
          caption="hero photo · record shelf wall · 1200×1500"
          src={settings?.heroImageUrl}
          alt="The collector's record shelf"
          className={styles.photo}
        />
        <VinylDisc size={168} className={styles.disc} />
      </div>
    </header>
  );
}
