import { useState } from 'react';
import type { FormEvent } from 'react';
import { sendContactMessage } from '../api/client';
import { Accordion } from '../components/ui/Accordion';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { CONTACT_CHANNELS, faqItems } from '../data/collection';
import styles from './Contact.module.css';

interface FormValues {
  name: string;
  email: string;
  message: string;
}

type FormErrors = Partial<Record<keyof FormValues, string>>;

const EMPTY: FormValues = { name: '', email: '', message: '' };

// Deliberately permissive — the server is the real validator; this only catches
// obvious typos before a round trip.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};

  if (values.name.trim().length < 2) {
    errors.name = 'Please enter at least 2 characters.';
  }
  if (!EMAIL_PATTERN.test(values.email.trim())) {
    errors.email = 'Please enter a valid email address.';
  }
  if (values.message.trim().length < 10) {
    errors.message = 'Please write at least 10 characters.';
  }

  return errors;
}

export function Contact(): JSX.Element {
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  function update(field: keyof FormValues, value: string): void {
    setValues((current) => ({ ...current, [field]: value }));
    // Clear the error for a field as soon as the user starts fixing it.
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setStatus('idle');
      return;
    }

    setStatus('sending');
    try {
      await sendContactMessage(values);
      setValues(EMPTY);
      setStatus('sent');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <section className={styles.band} id="contact" aria-labelledby="contact-heading">
      <div className={styles.inner}>
        <div className={styles.left}>
          <div className={styles.headingGroup}>
            <span className={styles.eyebrow}>Get in touch</span>
            <h2 className={styles.heading} id="contact-heading">
              Talk records
            </h2>
            <p className={styles.intro}>
              Trades, listening sessions in Lviv, or a lead on something from the wishlist — all
              welcome.
            </p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <Field
              label="Name"
              name="name"
              value={values.name}
              onChange={(value) => update('name', value)}
              placeholder="Your name"
              error={errors.name}
              required
            />
            <Field
              label="Email"
              name="email"
              type="email"
              value={values.email}
              onChange={(value) => update('email', value)}
              placeholder="you@example.com"
              error={errors.email}
              required
            />
            <Field
              as="textarea"
              label="Message"
              name="message"
              rows={4}
              value={values.message}
              onChange={(value) => update('message', value)}
              placeholder="Which record caught your eye?"
              error={errors.message}
              required
            />

            <div className={styles.submitRow}>
              <Button
                type="submit"
                size="lg"
                className={styles.submit}
                disabled={status === 'sending'}
              >
                {status === 'sending' ? 'Sending…' : 'Send Message'}
              </Button>
              <span className={styles.channels}>{CONTACT_CHANNELS}</span>
            </div>

            {status === 'sent' && (
              <p className={[styles.status, styles.statusOk].join(' ')} role="status">
                Thanks — your message is on its way.
              </p>
            )}
            {status === 'failed' && (
              <p className={[styles.status, styles.statusError].join(' ')} role="alert">
                Could not send that just now. Email hello@groovesanddust.ua directly and it will get
                through.
              </p>
            )}
          </form>
        </div>

        <div className={styles.right}>
          <span className={styles.faqHeading}>Frequently asked</span>
          <Accordion items={faqItems} defaultOpenIds={[faqItems[0].id]} />
        </div>
      </div>
    </section>
  );
}
