import { Button } from '../components/ui/Button';
import { ImagePlaceholder } from '../components/ui/ImagePlaceholder';
import { VinylDisc } from '../components/ui/VinylDisc';
import styles from './Hero.module.css';

export function Hero(): JSX.Element {
  return (
    <header className={styles.hero} id="top">
      <div className={styles.copy}>
        <span className={styles.eyebrow}>Personal vinyl library · est. 2009</span>
        {/* Line breaks are part of the design's composition, not wrapping. */}
        <h1 className={styles.title}>
          Andriy keeps
          <br />
          the records
          <br />
          spinning
        </h1>
        <p className={styles.lede}>
          324 records · Jazz, Electronic, Ukrainian · Lviv, Ukraine. Every sleeve here has been
          played at least twice — no shrink-wrap investments.
        </p>
        <div className={styles.actions}>
          <Button href="#featured" size="lg">
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
          className={styles.photo}
        />
        <VinylDisc size={168} className={styles.disc} />
      </div>
    </header>
  );
}
