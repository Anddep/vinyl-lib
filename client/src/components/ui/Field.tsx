import { useId } from 'react';
import styles from './Field.module.css';

interface BaseFieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  error?: string;
}

interface InputFieldProps extends BaseFieldProps {
  as?: 'input';
  type?: 'text' | 'email';
  rows?: never;
}

interface TextareaFieldProps extends BaseFieldProps {
  as: 'textarea';
  type?: never;
  rows?: number;
}

type FieldProps = InputFieldProps | TextareaFieldProps;

/**
 * Label + control pair. `useId` keeps the label/control and error association
 * unique even if the form is rendered more than once on a page.
 */
export function Field(props: FieldProps): JSX.Element {
  const { label, name, value, onChange, placeholder, required, error } = props;
  const id = useId();
  const errorId = `${id}-error`;

  const controlProps = {
    id,
    name,
    value,
    placeholder,
    required,
    className: styles.control,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
  };

  return (
    <div className={[styles.field, error ? styles.invalid : null].filter(Boolean).join(' ')}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {props.as === 'textarea' ? (
        <textarea
          {...controlProps}
          rows={props.rows ?? 4}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          {...controlProps}
          type={props.type ?? 'text'}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error && (
        <span className={styles.error} id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
