import { Link } from 'react-router-dom';
import { DiscIcon } from '../components/ui/icons';
import styles from './NotFoundPage.module.css';

/**
 * One screen for three different server answers.
 *
 * A collection that does not exist, one set to private and one that has been
 * suspended all return the same 404, so the client cannot tell them apart —
 * which is the point. Saying "this collection is private" here would leak
 * exactly what the server refused to.
 */
export function NotFoundPage(): JSX.Element {
  return (
    <div className={styles.screen}>
      <DiscIcon size={32} />
      <h1 className={styles.heading}>Collection not found</h1>
      <p className={styles.lede}>There is nothing at this address.</p>
      <Link className={styles.home} to="/">
        Back to Grooves &amp; Dust
      </Link>
    </div>
  );
}
