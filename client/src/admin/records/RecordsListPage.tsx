import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteRecord, getRecords } from '../../api/client';
import { Button } from '../../components/ui/Button';
import type { VinylRecord } from '../../types/collection';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable, type Column } from '../components/DataTable';
import styles from './RecordsListPage.module.css';

export default function RecordsListPage(): JSX.Element {
  const navigate = useNavigate();
  const [records, setRecords] = useState<VinylRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<VinylRecord | null>(null);

  const refresh = useCallback(() => {
    getRecords()
      .then(setRecords)
      .catch(() => setError('Could not load records.'));
  }, []);

  useEffect(refresh, [refresh]);

  // Derived during render — a stored filtered list would drift from `records`.
  const term = search.trim().toLowerCase();
  const visible = records.filter(
    (record) =>
      term.length === 0 ||
      record.title.toLowerCase().includes(term) ||
      record.artist.toLowerCase().includes(term),
  );

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) {
      return;
    }
    try {
      await deleteRecord(pendingDelete.id);
      // Refetch rather than splicing local state: the list is small and a
      // refetch cannot drift from the server.
      refresh();
    } catch {
      setError('Could not delete that record.');
    } finally {
      setPendingDelete(null);
    }
  }

  const columns: Column<VinylRecord>[] = [
    {
      key: 'cover',
      header: 'Cover',
      render: (record) =>
        record.coverUrl ? (
          <img className={styles.thumb} src={record.coverUrl} alt="" />
        ) : (
          <span className={styles.thumbEmpty} />
        ),
    },
    {
      key: 'title',
      header: 'Title',
      render: (record) => <span className={styles.title}>{record.title}</span>,
    },
    { key: 'artist', header: 'Artist', render: (record) => record.artist },
    { key: 'year', header: 'Year', render: (record) => record.year },
    { key: 'genre', header: 'Genre', render: (record) => record.genre },
    { key: 'position', header: 'Order', render: (record) => record.position ?? 0 },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>Records</h1>
          <span className={styles.count}>
            {visible.length} of {records.length}
          </span>
        </div>
        <Button href="/admin/records/new">New record</Button>
      </div>

      <div className={styles.filters}>
        <input
          className={styles.search}
          type="search"
          placeholder="Search title or artist"
          aria-label="Search records"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {error && <p className={styles.message}>{error}</p>}

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(record) => record.id}
        emptyMessage={
          records.length === 0 ? 'No records yet. Add the first one.' : 'Nothing matches that.'
        }
        actions={(record) => (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/admin/records/${record.id}`)}
            >
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(record)}>
              Delete
            </Button>
          </>
        )}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete record"
        message={`"${pendingDelete?.title ?? ''}" will be removed permanently. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
