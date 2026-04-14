import type { ReactNode } from 'react';

type EnamelChipProps = {
  children: ReactNode;
  tone?: 'gold' | 'moss' | 'rose' | 'burgundy';
};

export function EnamelChip({ children, tone = 'gold' }: EnamelChipProps) {
  return <span className={`enamel-chip enamel-chip--${tone}`}>{children}</span>;
}
