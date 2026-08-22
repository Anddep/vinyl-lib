import { ImagePlaceholder } from '../components/ui/ImagePlaceholder';
import { SetupIcon } from '../components/ui/icons';
import type { SetupItem, SiteSettings } from '../types/collection';
import styles from './AudioSetup.module.css';

/** Design defaults, used until the collector sets their own copy. */
const FALLBACK = { eyebrow: 'The setup', heading: 'What it all plays on' };

interface AudioSetupProps {
  items: SetupItem[];
  settings: SiteSettings | null;
  error: string | null;
}

export function AudioSetup({ items, settings, error }: AudioSetupProps): JSX.Element {
  return (
    <section className={styles.section} id="setup" aria-labelledby="setup-heading">
      <div className={styles.copy}>
        <div className={styles.headingGroup}>
          <span className={styles.eyebrow}>{settings?.setupEyebrow || FALLBACK.eyebrow}</span>
          <h2 className={styles.heading} id="setup-heading">
            {settings?.setupHeading || FALLBACK.heading}
          </h2>
        </div>

        {error && <p className={styles.message}>Could not load the setup just now.</p>}

        <ul className={styles.list}>
          {items.map((item) => (
            <li className={styles.row} key={item.id}>
              <span className={styles.icon}>
                <SetupIcon name={item.icon} />
              </span>
              <span className={styles.label}>{item.label}</span>
              <span className={styles.value}>{item.value}</span>
            </li>
          ))}
        </ul>
      </div>

      <ImagePlaceholder
        ratio="1"
        caption="setup photo · turntable + amp · 1000×1000"
        src={settings?.setupImageUrl}
        alt="The listening setup"
      />
    </section>
  );
}
