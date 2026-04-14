type Option = {
  value: string;
  label: string;
};

type OrnateInputProps = {
  label: string;
  name: string;
  placeholder?: string;
  hint?: string;
  type?: string;
  multiline?: boolean;
  options?: Option[];
  defaultValue?: string;
};

export function OrnateInput({
  label,
  name,
  placeholder,
  hint,
  type = 'text',
  multiline = false,
  options,
  defaultValue
}: OrnateInputProps) {
  return (
    <label className="ornate-field">
      <span className="ornate-field__label">{label}</span>
      {options ? (
        <select name={name} defaultValue={defaultValue} className="ornate-field__control">
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : multiline ? (
        <textarea
          name={name}
          rows={5}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className="ornate-field__control ornate-field__control--textarea"
        />
      ) : (
        <input
          type={type}
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className="ornate-field__control"
        />
      )}
      {hint ? <span className="ornate-field__hint">{hint}</span> : null}
    </label>
  );
}
