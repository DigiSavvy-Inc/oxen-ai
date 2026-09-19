import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { OxenModel } from "../lib/api";
import { filterModels, groupPreferredModels, modelLabel } from "../lib/model-menu";

type Props = {
  models: OxenModel[];
  preferred: OxenModel[];
  value: string;
  query: string;
  onQueryChange: (value: string) => void;
  onChange: (value: string) => void;
};

export function ModelMenu(props: Props) {
  const { models, preferred, value, query, onQueryChange, onChange } = props;
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = models.find((model) => model.id === value) ?? null;
  const visible = useMemo(() => filterModels(models, query), [models, query]);
  const grouped = useMemo(
    () => groupPreferredModels(visible, preferred),
    [visible, preferred],
  );
  const extra =
    value && !visible.some((model) => model.id === value) && !query.trim()
      ? [selected ?? { id: value }]
      : [];
  const options = [...grouped.preferred, ...grouped.rest, ...extra];
  const activeHot = options.length === 0 ? 0 : Math.min(hot, options.length - 1);

  const close = useCallback(() => {
    setOpen(false);
    onQueryChange("");
  }, [onQueryChange]);

  function choose(id: string) {
    onChange(id);
    close();
  }

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }
    function onDocumentKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onDocumentKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onDocumentKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector("[data-hot='true']");
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest" });
  }, [open, activeHot]);

  function moveHot(delta: number) {
    if (options.length === 0) return;
    setHot((current) => {
      const next = current + delta;
      if (next < 0) return options.length - 1;
      if (next >= options.length) return 0;
      return next;
    });
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveHot(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveHot(-1);
        break;
      case "Home":
        event.preventDefault();
        setHot(0);
        break;
      case "End":
        event.preventDefault();
        if (options.length > 0) setHot(options.length - 1);
        break;
      case "Enter":
        event.preventDefault();
        if (options[activeHot]) choose(options[activeHot].id);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      default:
        break;
    }
  }

  const triggerLabel = selected ? modelLabel(selected) : value || "Select a model";
  const headingRest = grouped.preferred.length > 0 ? "All" : "Models";
  const emptyLabel = query.trim()
    ? `No models match “${query.trim()}”`
    : "No models";

  return (
    <div className="model-menu" ref={rootRef}>
      <button
        type="button"
        className={`select select-model model-menu-trigger${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="model-menu-list"
        aria-label="Model"
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
        onKeyDown={(event) => {
          if (open) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="model-menu-value">{triggerLabel}</span>
        <span className="model-menu-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="model-menu-pop">
          <input
            ref={searchRef}
            className="field model-menu-search"
            type="search"
            placeholder="Search models"
            value={query}
            aria-label="Filter models"
            aria-controls="model-menu-list"
            aria-activedescendant={options[activeHot] ? `model-option-${activeHot}` : undefined}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setHot(0);
            }}
            onKeyDown={onSearchKeyDown}
          />
          <div
            ref={listRef}
            id="model-menu-list"
            className="model-menu-list"
            role="listbox"
            aria-label="Models"
          >
            {grouped.preferred.length > 0 ? (
              <div className="model-menu-heading">Preferred</div>
            ) : null}
            {grouped.preferred.map((model, index) => (
              <ModelOption
                key={`fav-${model.id}`}
                model={model}
                index={index}
                selected={model.id === value}
                hot={index === activeHot}
                onHot={() => setHot(index)}
                onChoose={() => choose(model.id)}
              />
            ))}
            {grouped.rest.length > 0 ? (
              <div className="model-menu-heading">{headingRest}</div>
            ) : null}
            {grouped.rest.map((model, index) => {
              const optionIndex = grouped.preferred.length + index;
              return (
                <ModelOption
                  key={model.id}
                  model={model}
                  index={optionIndex}
                  selected={model.id === value}
                  hot={optionIndex === activeHot}
                  onHot={() => setHot(optionIndex)}
                  onChoose={() => choose(model.id)}
                />
              );
            })}
            {extra.map((model, index) => {
              const optionIndex = grouped.preferred.length + grouped.rest.length + index;
              return (
                <ModelOption
                  key={`extra-${model.id}`}
                  model={model}
                  index={optionIndex}
                  selected={model.id === value}
                  hot={optionIndex === activeHot}
                  onHot={() => setHot(optionIndex)}
                  onChoose={() => choose(model.id)}
                />
              );
            })}
            {options.length === 0 ? <div className="model-menu-empty">{emptyLabel}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModelOption({
  model,
  index,
  selected,
  hot,
  onHot,
  onChoose,
}: {
  model: OxenModel;
  index: number;
  selected: boolean;
  hot: boolean;
  onHot: () => void;
  onChoose: () => void;
}) {
  return (
    <button
      id={`model-option-${index}`}
      type="button"
      role="option"
      aria-selected={selected}
      data-hot={hot ? "true" : undefined}
      className={`model-menu-option${hot ? " is-hot" : ""}${selected ? " is-selected" : ""}`}
      onPointerEnter={onHot}
      onMouseDown={(event) => {
        event.preventDefault();
        onChoose();
      }}
    >
      {modelLabel(model)}
    </button>
  );
}
