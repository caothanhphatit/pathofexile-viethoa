interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder?: string;
  right?: React.ReactNode;
}

export function FilterBar({ query, onQueryChange, placeholder = "Tìm kiếm...", right }: Props) {
  return (
    <div className="filterbar">
      <label className="searchbox">
        <span className="material-symbols-rounded" aria-hidden="true">search</span>
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={placeholder} />
      </label>
      {right}
    </div>
  );
}
