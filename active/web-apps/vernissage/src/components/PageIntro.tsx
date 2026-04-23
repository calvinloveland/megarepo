import type { ReactNode } from 'react';

type PageIntroProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  titleAs?: 'h1' | 'h2';
  children?: ReactNode;
  className?: string;
};

export function PageIntro({
  eyebrow,
  title,
  titleAs = 'h1',
  children,
  className
}: PageIntroProps) {
  const Heading = titleAs;
  const classes = ['hero-shell', 'hero-shell--compact', className].filter(Boolean).join(' ');

  return (
    <section className={classes}>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <Heading>{title}</Heading>
      {children}
    </section>
  );
}
