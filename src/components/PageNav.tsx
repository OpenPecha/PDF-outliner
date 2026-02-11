

function PageNav({
    pages,
    current,
    onSelect,
  }: {
    pages: number[];
    current: number;
    onSelect: (p: number) => void;
  }) {
    return (
      <div className="page-list">
        {pages.map((p) => (
          <button
            key={p}
            className={p === current ? "page-btn-active" : "page-btn"}
            onClick={() => onSelect(p)}
          >
            Page {p}
          </button>
        ))}
      </div>
    );
  }
  export default PageNav;