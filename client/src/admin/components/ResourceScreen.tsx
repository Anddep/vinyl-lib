import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from './ConfirmDialog';
import { ImageField } from './ImageField';
import { DataTable, type Column } from './DataTable';
import styles from './ResourceScreen.module.css';

export interface FieldDef {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'number' | 'checkbox' | 'select' | 'image';
  options?: readonly string[];
  placeholder?: string;
  /** Blank optional fields are omitted from the payload rather than sent as "". */
  required?: boolean;
}

type FormValues = Record<string, string | boolean>;

interface ResourceScreenProps<T extends { id: number }> {
  title: string;
  description?: string;
  /** Singular noun used in the delete dialog, e.g. "wishlist item". */
  noun: string;
  fields: FieldDef[];
  columns: Column<T>[];
  load: () => Promise<T[]>;
  create: (data: unknown) => Promise<T>;
  update: (id: number, data: unknown) => Promise<T>;
  remove: (id: number) => Promise<void>;
  /** Pulls form values out of an existing row when editing. */
  toForm: (row: T) => FormValues;
  describe: (row: T) => string;
}

function emptyValues(fields: FieldDef[]): FormValues {
  return Object.fromEntries(fields.map((f) => [f.key, f.kind === 'checkbox' ? false : '']));
}

/**
 * List + inline create/edit for the small ordered resources.
 *
 * Wishlist and setup differ only in their fields and endpoints, so they share
 * this rather than carrying two near-identical copies of the same
 * fetch/validate/confirm cycle.
 */
export function ResourceScreen<T extends { id: number }>({
  title,
  description,
  noun,
  fields,
  columns,
  load,
  create,
  update,
  remove,
  toForm,
  describe,
}: ResourceScreenProps<T>): JSX.Element {
  const [rows, setRows] = useState<T[]>([]);
  const [values, setValues] = useState<FormValues>(() => emptyValues(fields));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<T | null>(null);

  const refresh = useCallback(() => {
    load()
      .then(setRows)
      .catch(() => setMessage(`Could not load ${title.toLowerCase()}.`));
  }, [load, title]);

  useEffect(refresh, [refresh]);

  function reset(): void {
    setValues(emptyValues(fields));
    setEditingId(null);
    setFieldErrors({});
  }

  function toPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    for (const field of fields) {
      const value = values[field.key];

      if (field.kind === 'checkbox') {
        payload[field.key] = Boolean(value);
        continue;
      }

      const text = String(value ?? '').trim();
      if (field.kind === 'number') {
        payload[field.key] = Number(text) || 0;
        continue;
      }

      // Omit blank optionals: an empty string would fail a URL or min-length
      // check on a field the collector simply left alone.
      if (text.length > 0 || field.required) {
        payload[field.key] = text;
      }
    }

    return payload;
  }

  async function handleSubmit(): Promise<void> {
    setSaving(true);
    setFieldErrors({});
    setMessage(null);

    try {
      if (editingId === null) {
        await create(toPayload());
      } else {
        await update(editingId, toPayload());
      }
      reset();
      refresh();
    } catch (caught) {
      if (caught instanceof ApiError && Object.keys(caught.fields).length > 0) {
        setFieldErrors(caught.fields);
      } else {
        setMessage(caught instanceof Error ? caught.message : 'Could not save that.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) {
      return;
    }
    try {
      await remove(pendingDelete.id);
      if (editingId === pendingDelete.id) {
        reset();
      }
      refresh();
    } catch {
      setMessage(`Could not delete that ${noun}.`);
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.heading}>{title}</h1>
        {description && <p className={styles.sub}>{description}</p>}
      </div>

      {message && <p className={styles.message}>{message}</p>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        emptyMessage={`No ${title.toLowerCase()} yet.`}
        actions={(row) => (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setValues(toForm(row));
                setEditingId(row.id);
                setFieldErrors({});
              }}
            >
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(row)}>
              Delete
            </Button>
          </>
        )}
      />

      <form
        className={styles.panel}
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
        noValidate
      >
        <h2 className={styles.panelHeading}>
          {editingId === null ? `Add a ${noun}` : `Edit ${noun}`}
        </h2>

        <div className={styles.grid}>
          {fields.map((field) => {
            const error = fieldErrors[field.key];
            const id = `${title}-${field.key}`;

            if (field.kind === 'image') {
              return (
                <ImageField
                  key={field.key}
                  label={field.label}
                  className={styles.fullWidth}
                  value={String(values[field.key] ?? '') || null}
                  onChange={(next) => setValues((c) => ({ ...c, [field.key]: next ?? '' }))}
                />
              );
            }

            if (field.kind === 'checkbox') {
              return (
                <label className={styles.checkbox} key={field.key}>
                  <input
                    type="checkbox"
                    checked={Boolean(values[field.key])}
                    onChange={(e) => setValues((c) => ({ ...c, [field.key]: e.target.checked }))}
                  />
                  {field.label}
                </label>
              );
            }

            return (
              <div
                className={[styles.field, error ? styles.invalid : null].filter(Boolean).join(' ')}
                key={field.key}
              >
                <label className={styles.label} htmlFor={id}>
                  {field.label}
                </label>

                {field.kind === 'textarea' ? (
                  <textarea
                    id={id}
                    className={styles.control}
                    rows={3}
                    value={String(values[field.key] ?? '')}
                    placeholder={field.placeholder}
                    aria-invalid={error ? true : undefined}
                    onChange={(e) => setValues((c) => ({ ...c, [field.key]: e.target.value }))}
                  />
                ) : field.kind === 'select' ? (
                  <select
                    id={id}
                    className={styles.control}
                    value={String(values[field.key] ?? '')}
                    aria-invalid={error ? true : undefined}
                    onChange={(e) => setValues((c) => ({ ...c, [field.key]: e.target.value }))}
                  >
                    <option value="">Choose…</option>
                    {field.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    className={styles.control}
                    type="text"
                    inputMode={field.kind === 'number' ? 'numeric' : undefined}
                    value={String(values[field.key] ?? '')}
                    placeholder={field.placeholder}
                    aria-invalid={error ? true : undefined}
                    onChange={(e) => setValues((c) => ({ ...c, [field.key]: e.target.value }))}
                  />
                )}

                {error && (
                  <span className={styles.error} role="alert">
                    {error}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className={styles.actions}>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editingId === null ? 'Add' : 'Save changes'}
          </Button>
          {editingId !== null && (
            <Button variant="secondary" onClick={reset}>
              Cancel
            </Button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${noun}`}
        message={`"${pendingDelete ? describe(pendingDelete) : ''}" will be removed permanently. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
