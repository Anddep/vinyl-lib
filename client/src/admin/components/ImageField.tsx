import { useId, useState } from 'react';
import type { ChangeEvent } from 'react';
import { uploadCover } from '../../api/client';
import { Button } from '../../components/ui/Button';
import styles from './ImageField.module.css';

interface ImageFieldProps {
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
  className?: string;
}

/**
 * Cover art by upload or by pasted URL.
 *
 * Both write to the same string field — the API accepts either an
 * /uploads/ path or an external URL — so the mode toggle is purely how the
 * value gets there.
 */
export function ImageField({ label, value, onChange, className }: ImageFieldProps): JSX.Element {
  const groupId = useId();
  const urlId = `${groupId}-url`;
  const fileId = `${groupId}-file`;
  // Default to whichever mode matches the current value.
  const [mode, setMode] = useState<'upload' | 'url'>(
    value && !value.startsWith('/uploads/') ? 'url' : 'upload',
  );
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadCover(file);
      setPreviewFailed(false);
      onChange(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className={[styles.field, className].filter(Boolean).join(' ')}
      role="group"
      aria-labelledby={groupId}
    >
      <span className={styles.label} id={groupId}>
        {label}
      </span>

      <div className={styles.modes} role="radiogroup" aria-label={`${label} source`}>
        {(['upload', 'url'] as const).map((option) => (
          <label className={styles.mode} key={option}>
            <input
              type="radio"
              name={`${groupId}-mode`}
              checked={mode === option}
              onChange={() => setMode(option)}
            />
            {option === 'upload' ? 'Upload' : 'URL'}
          </label>
        ))}
      </div>

      <div className={styles.body}>
        {value && !previewFailed ? (
          <img
            className={styles.preview}
            src={value}
            alt=""
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <span className={styles.empty}>{previewFailed ? 'broken' : 'none'}</span>
        )}

        <div className={styles.controls}>
          {mode === 'url' ? (
            <>
              <label className={styles.label} htmlFor={urlId}>
                Image URL
              </label>
              <input
                id={urlId}
                className={styles.input}
                type="url"
                placeholder="https://…"
                value={value ?? ''}
                onChange={(event) => {
                  setPreviewFailed(false);
                  onChange(event.target.value || null);
                }}
              />
            </>
          ) : (
            <>
              <label className={styles.label} htmlFor={fileId}>
                Choose a file
              </label>
              <input
                id={fileId}
                className={styles.fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                onChange={handleFile}
                disabled={uploading}
              />
            </>
          )}

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          {value && (
            <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
