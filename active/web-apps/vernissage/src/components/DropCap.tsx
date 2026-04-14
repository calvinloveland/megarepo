type DropCapProps = {
  text: string;
};

export function DropCap({ text }: DropCapProps) {
  if (!text) {
    return null;
  }

  const first = text.at(0);
  const rest = text.slice(1);

  return (
    <p className="drop-cap-paragraph">
      <span className="drop-cap-letter">{first}</span>
      {rest}
    </p>
  );
}
