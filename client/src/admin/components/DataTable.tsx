import type { ReactNode } from 'react';
import styles from './DataTable.module.css';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  actions?: (row: T) => ReactNode;
  emptyMessage?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  actions,
  emptyMessage = 'Nothing here yet.',
}: DataTableProps<T>): JSX.Element {
  if (rows.length === 0) {
    return <p className={styles.empty}>{emptyMessage}</p>;
  }

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th className={styles.th} key={column.key} scope="col">
                {column.header}
              </th>
            ))}
            {actions && (
              <th className={styles.th} scope="col">
                <span className="srOnly">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className={styles.row} key={rowKey(row)}>
              {columns.map((column) => (
                <td className={styles.td} key={column.key}>
                  {column.render(row)}
                </td>
              ))}
              {actions && (
                <td className={styles.td}>
                  <div className={styles.actions}>{actions(row)}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
