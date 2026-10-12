import { useEffect, useId, useRef, useState } from "react";
import { DOC_ARTICLES, DOC_CATEGORIES, filterDocs, type DocCategory } from "../lib/docs";

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function HelpDock() {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<DocCategory | "All">("All");
  const matches = filterDocs(DOC_ARTICLES, query, category);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const field = searchRef.current;
    field?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="help-fab"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Help"
        title="Help (?)"
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      {open ? (
        <div className="modal-backdrop help-backdrop" onClick={() => setOpen(false)}>
          <div
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="help-head">
              <h2 id={titleId}>Docs</h2>
              <button type="button" className="ghost-btn" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <div className="help-tools">
              <input
                ref={searchRef}
                className="field"
                type="search"
                value={query}
                placeholder="Search docs"
                aria-label="Search docs"
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="help-filters" role="group" aria-label="Filter docs">
                <button
                  type="button"
                  className={`help-filter${category === "All" ? " is-on" : ""}`}
                  aria-pressed={category === "All"}
                  onClick={() => setCategory("All")}
                >
                  All
                </button>
                {DOC_CATEGORIES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`help-filter${category === item ? " is-on" : ""}`}
                    aria-pressed={category === item}
                    onClick={() => setCategory(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div className="help-docs">
              {matches.length === 0 ? (
                <p className="help-empty">No docs match that search.</p>
              ) : (
                matches.map((article) => (
                  <article key={article.id} className="help-article">
                    <p className="help-kicker">{article.category}</p>
                    <h3>{article.title}</h3>
                    {article.blocks.map((block, index) => {
                      switch (block.type) {
                        case "p":
                          return <p key={`${article.id}-${index}`}>{block.text}</p>;
                        case "ul":
                          return (
                            <ul key={`${article.id}-${index}`}>
                              {block.items.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          );
                        default: {
                          const _exhaustive: never = block;
                          return _exhaustive;
                        }
                      }
                    })}
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
