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
  initialText = "I'd love to see an artist or artwork added to the Vernissage catalog."
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
