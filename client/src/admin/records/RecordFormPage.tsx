import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, createRecord, getRecord, updateRecord } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { ImageField } from '../components/ImageField';
import styles from './RecordFormPage.module.css';

interface FormState {
  title: string;
  artist: string;
  year: string;
  format: string;
  genre: string;
  url: string;
  slug: string;
  position: string;
  addedAt: string;
  coverUrl: string | null;
}

const EMPTY: FormState = {
  title: '',
  artist: '',
  year: '',
  format: '',
  genre: '',
  url: '',
  slug: '',
  position: '0',
  addedAt: '',
  coverUrl: null,
};

/** Everything is a string in the DOM; the API wants real types. */
function toPayload(form: FormState): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: form.title,
    artist: form.artist,
    year: Number(form.year),
    format: form.format,
    genre: form.genre,
    position: Number(form.position) || 0,
    coverUrl: form.coverUrl,
  };

  // Blank optionals are omitted, not sent as "". An empty string would fail
  // the URL protocol allowlist and reject an otherwise valid record.
  for (const key of ['url', 'slug', 'addedAt'] as const) {
    const value = form[key].trim();
    if (value.length > 0) {
      payload[key] = value;
    }
  }

  return payload;
}

export default function RecordFormPage(): JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const recordId = id ? Number(id) : null;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (recordId === null) {
      return;
    }
    let cancelled = false;

    getRecord(recordId)
      .then((record) => {
        if (cancelled) {
          return;
        }
        setForm({
          title: record.title,
          artist: record.artist,
          year: String(record.year),
          format: record.format,
          genre: record.genre,
          url: record.url ?? '',
          slug: record.slug,
          position: String(record.position ?? 0),
          addedAt: record.addedAt ? record.addedAt.slice(0, 10) : '',
          coverUrl: record.coverUrl ?? null,
        });
      })
      .catch(() => setFormError('Could not load that record.'));

    return () => {
      cancelled = true;
    };
  }, [recordId]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: '' }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const payload = toPayload(form);
      if (recordId === null) {
        await createRecord(payload);
      } else {
        await updateRecord(recordId, payload);
      }
      navigate('/admin/records');
    } catch (caught) {
      if (caught instanceof ApiError && Object.keys(caught.fields).length > 0) {
        setFieldErrors(caught.fields);
      } else {
        setFormError(caught instanceof Error ? caught.message : 'Could not save that record.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>{recordId === null ? 'New record' : 'Edit record'}</h1>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <Field
          label="Title"
          name="title"
          value={form.title}
          onChange={(v) => set('title', v)}
          error={fieldErrors.title}
        />
        <Field
          label="Artist"
          name="artist"
          value={form.artist}
          onChange={(v) => set('artist', v)}
          error={fieldErrors.artist}
        />

        <div className={styles.pair}>
          <Field
            label="Year"
            name="year"
            value={form.year}
            onChange={(v) => set('year', v)}
            placeholder="1970"
            error={fieldErrors.year}
          />
          <Field
            label="Format"
            name="format"
            value={form.format}
            onChange={(v) => set('format', v)}
            placeholder="LP"
            error={fieldErrors.format}
          />
        </div>

        <div className={styles.pair}>
          <Field
            label="Genre"
            name="genre"
            value={form.genre}
            onChange={(v) => set('genre', v)}
            placeholder="Jazz"
            error={fieldErrors.genre}
          />
        </div>
        <Field
          label="URL"
          name="url"
          type="url"
          value={form.url}
          onChange={(v) => set('url', v)}
          placeholder="https://www.discogs.com/release/…"
          error={fieldErrors.url}
        />

        <ImageField label="Cover" value={form.coverUrl} onChange={(v) => set('coverUrl', v)} />

        <div className={styles.pair}>
          <Field
            label="Slug"
            name="slug"
            value={form.slug}
            onChange={(v) => set('slug', v)}
            placeholder="derived from the title"
            error={fieldErrors.slug}
          />
          <Field
            label="Sort order"
            name="position"
            value={form.position}
            onChange={(v) => set('position', v)}
            error={fieldErrors.position}
          />
        </div>

        <div className={styles.pair}>
          <Field
            label="Added"
            name="addedAt"
            type="date"
            value={form.addedAt}
            onChange={(v) => set('addedAt', v)}
            error={fieldErrors.addedAt}
          />
        </div>

        {formError && (
          <p className={styles.error} role="alert">
            {formError}
          </p>
        )}

        <div className={styles.actions}>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="secondary" onClick={() => navigate('/admin/records')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
