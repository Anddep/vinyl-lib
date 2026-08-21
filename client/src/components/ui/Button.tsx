import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'lg' | 'md' | 'sm';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}

type ButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
    href?: undefined;
  };

type LinkProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children' | 'href'> & {
    href: string;
  };

type Props = ButtonProps | LinkProps;

/**
 * Renders an <a> when `href` is passed and a <button> otherwise, so anchor
 * navigation (the hero CTAs, the nav Contact link) keeps real link semantics
 * instead of a button with a click handler.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: Props): JSX.Element {
  const classes = [styles.base, styles[variant], styles[size], className].filter(Boolean).join(' ');

  if (typeof rest.href === 'string') {
    const { href, ...anchorProps } = rest as LinkProps;
    return (
      <a className={classes} href={href} {...anchorProps}>
        {children}
      </a>
    );
  }

  const { type = 'button', ...buttonProps } = rest as ButtonProps;
  return (
    <button className={classes} type={type} {...buttonProps}>
      {children}
    </button>
  );
}
