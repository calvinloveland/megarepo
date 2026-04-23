'use client';

import type { ReactNode } from 'react';

type OpenFeedbackButtonProps = {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  initialText?: string;
};

export function OpenFeedbackButton({
  children,
  variant = 'primary',
  initialText = 'I found a gap in the Vernissage catalog and want to point it out.'
}: OpenFeedbackButtonProps) {
  return (
    <a
      href="#vernissage-feedback-request"
      className={`enamel-button enamel-button--${variant}`}
      onClick={(event) => {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent('vernissage-feedback:open', {
            detail: {
              initialText
            }
          })
        );
      }}
    >
      {children}
    </a>
  );
}
