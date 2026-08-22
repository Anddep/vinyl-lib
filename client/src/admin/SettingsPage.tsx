import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, getSettings, updateSettings } from '../api/client';
import { Button } from '../components/ui/Button';
import type { SiteSettings } from '../types/collection';
import { ImageField } from './components/ImageField';
import styles from './components/ResourceScreen.module.css';

type TextKey = Exclude<keyof SiteSettings, 'heroImageUrl' | 'setupImageUrl'>;

interface TextFieldDef {
  key: TextKey;
  label: string;
  hint?: string;
  multiline?: boolean;
  placeholder?: string;
}

const HERO_FIELDS: TextFieldDef[] = [
  { key: 'heroEyebrow', label: 'Eyebrow', placeholder: 'Personal vinyl library · est. 2009' },
  {
    key: 'heroHeadline',
    label: 'Headline',
    multiline: true,
    hint: 'One line per line break — the design splits this across three.',
    placeholder: 'Andriy keeps\nthe records\nspinning',
  },
  {
    key: 'heroLede',
    label: 'Intro',
    multiline: true,
    hint: 'The record count is added automatically in front of this.',
  },
];

const SETUP_FIELDS: TextFieldDef[] = [
  { key: 'setupEyebrow', label: 'Eyebrow', placeholder: 'The setup' },
  { key: 'setupHeading', label: 'Heading', placeholder: 'What it all plays on' },
];

export default function SettingsPage(): JSX.Element {
  const [values, setValues] = useState<SiteSettings>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((settings) => {
        if (!cancelled) {
          setValues(settings);
        }
      })
      .catch(() => setStatus('Could not load settings.'));
    return () => {
      cancelled = true;
    };
  }, []);

  function set(key: keyof SiteSettings, value: string): void {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: '' }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setStatus(null);

    try {
      // Blank values are sent through: clearing a field should fall back to
      // the design default, not keep the old text.
      const saved = await updateSettings(values);
      setValues(saved);
      setStatus('Saved.');
    } catch (caught) {
      if (caught instanceof ApiError && Object.keys(caught.fields).length > 0) {
        setFieldErrors(caught.fields);
      } else {
        setStatus('Could not save that.');
      }
    } finally {
      setSaving(false);
    }
  }

  function renderText(field: TextFieldDef): JSX.Element {
    const error = fieldErrors[field.key];
    const id = `setting-${field.key}`;

    return (
      <div
        className={[styles.field, error ? styles.invalid : null].filter(Boolean).join(' ')}
        key={field.key}
      >
        <label className={styles.label} htmlFor={id}>
          {field.label}
        </label>
        {field.multiline ? (
          <textarea
            id={id}
            className={styles.control}
            rows={3}
            value={values[field.key] ?? ''}
            placeholder={field.placeholder}
            aria-invalid={error ? true : undefined}
            onChange={(event) => set(field.key, event.target.value)}
          />
        ) : (
          <input
            id={id}
            className={styles.control}
            type="text"
            value={values[field.key] ?? ''}
            placeholder={field.placeholder}
            aria-invalid={error ? true : undefined}
            onChange={(event) => set(field.key, event.target.value)}
          />
        )}
        {field.hint && !error && <span className={styles.sub}>{field.hint}</span>}
        {error && (
          <span className={styles.error} role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.heading}>Site content</h1>
        <p className={styles.sub}>
          Copy and imagery the homepage cannot work out from the records themselves. Leave a field
          empty to fall back to the original wording.
        </p>
      </div>

      <form className={styles.page} onSubmit={handleSubmit} noValidate>
        <section className={styles.panel}>
          <h2 className={styles.panelHeading}>Hero</h2>
          <div className={styles.grid}>{HERO_FIELDS.map(renderText)}</div>
          <ImageField
            label="Hero image"
            value={values.heroImageUrl ?? null}
            onChange={(next) => set('heroImageUrl', next ?? '')}
          />
          {fieldErrors.heroImageUrl && (
            <span className={styles.error} role="alert">
              {fieldErrors.heroImageUrl}
            </span>
          )}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelHeading}>Setup section</h2>
          <div className={styles.grid}>{SETUP_FIELDS.map(renderText)}</div>
          <ImageField
            label="Setup image"
            value={values.setupImageUrl ?? null}
            onChange={(next) => set('setupImageUrl', next ?? '')}
          />
          {fieldErrors.setupImageUrl && (
            <span className={styles.error} role="alert">
              {fieldErrors.setupImageUrl}
            </span>
          )}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelHeading}>Collection</h2>
          <div className={styles.grid}>
            {renderText({
              key: 'collectingSince',
              label: 'Collecting since',
              placeholder: '2009',
              hint: 'Stored, not derived: the earliest added date is when a record was entered here, not when you started collecting.',
            })}
          </div>
        </section>

        <div className={styles.actions}>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {status && (
            <p className={styles.message} role="status">
              {status}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
