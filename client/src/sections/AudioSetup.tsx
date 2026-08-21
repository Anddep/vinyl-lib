import { ImagePlaceholder } from '../components/ui/ImagePlaceholder';
import { SetupIcon } from '../components/ui/icons';
import { setupItems } from '../data/collection';
import styles from './AudioSetup.module.css';

export function AudioSetup(): JSX.Element {
  return (
    <section className={styles.section} id="setup" aria-labelledby="setup-heading">
      <div className={styles.copy}>
        <div className={styles.headingGroup}>
          <span className={styles.eyebrow}>The setup</span>
          <h2 className={styles.heading} id="setup-heading">
            What it all plays on
          </h2>
        </div>

        <ul className={styles.list}>
          {setupItems.map((item) => (
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

      <ImagePlaceholder ratio="1" caption="setup photo · turntable + amp · 1000×1000" />
    </section>
  );
}
