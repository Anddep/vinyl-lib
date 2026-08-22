import {
  createWishlistItem,
  deleteWishlistItem,
  getWishlist,
  updateWishlistItem,
} from '../api/client';
import type { WishlistItem } from '../types/collection';
import { ResourceScreen, type FieldDef } from './components/ResourceScreen';
import type { Column } from './components/DataTable';
import styles from './components/ResourceScreen.module.css';

const fields: FieldDef[] = [
  { key: 'title', label: 'Title', kind: 'text', required: true, placeholder: 'Karma' },
  { key: 'artist', label: 'Artist', kind: 'text', required: true, placeholder: 'Pharoah Sanders' },
  { key: 'url', label: 'URL', kind: 'text', placeholder: 'https://…' },
  { key: 'coverUrl', label: 'Cover', kind: 'image' },
  { key: 'position', label: 'Sort order', kind: 'number' },
];

const columns: Column<WishlistItem>[] = [
  {
    key: 'cover',
    header: 'Cover',
    render: (row) =>
      row.coverUrl ? (
        <img className={styles.thumb} src={row.coverUrl} alt="" />
      ) : (
        <span className={styles.thumbEmpty} />
      ),
  },
  { key: 'title', header: 'Title', render: (row) => row.title },
  { key: 'artist', header: 'Artist', render: (row) => row.artist },
  { key: 'position', header: 'Order', render: (row) => row.position ?? 0 },
];

export default function WishlistPage(): JSX.Element {
  return (
    <ResourceScreen<WishlistItem>
      title="Wishlist"
      description="Records you are still hunting. Shown in the Looking For section."
      noun="wishlist item"
      fields={fields}
      columns={columns}
      load={getWishlist}
      create={createWishlistItem}
      update={updateWishlistItem}
      remove={deleteWishlistItem}
      toForm={(row) => ({
        title: row.title,
        artist: row.artist,
        url: row.url ?? '',
        coverUrl: row.coverUrl ?? '',
        position: String(row.position ?? 0),
      })}
      describe={(row) => row.title}
    />
  );
}
