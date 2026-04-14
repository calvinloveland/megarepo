type BotanicalDividerProps = {
  label: string;
};

export function BotanicalDivider({ label }: BotanicalDividerProps) {
  return (
    <div className="botanical-divider" aria-hidden="true">
      <span className="botanical-divider__line" />
      <span className="botanical-divider__label">{label}</span>
      <span className="botanical-divider__line" />
    </div>
  );
}
