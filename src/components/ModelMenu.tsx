import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { OxenModel } from "../lib/api";
import { filterModels, groupPreferredModels, MAX_BATCH_MODELS, modelLabel } from "../lib/model-menu";

type Props = {
  models: OxenModel[];
  preferred: OxenModel[];
  value: string;
  query: string;
  onQueryChange: (value: string) => void;
  onChange: (value: string) => void;
  batchModels?: string[];
  onToggleBatch?: (id: string) => void;
  onReorderPreferred?: (fromId: string, toId: string) => void;
};

export function ModelMenu(props: Props) {
  const { models, preferred, value, query, onQueryChange, onChange } = props;
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(0);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [box, setBox] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
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

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const trigger = rootRef.current?.querySelector(".model-menu-trigger");
      if (!(trigger instanceof HTMLElement)) return;
      const rect = trigger.getBoundingClientRect();
      const spaceAbove = Math.max(160, rect.top - 12);
      setBox({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
        bottom: window.innerHeight - rect.top + 6,
        maxHeight: Math.min(320, spaceAbove),
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popRef.current?.contains(target)) return;
      close();
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

  const batch = props.batchModels?.length ? props.batchModels : value ? [value] : [];
  const extraCount = Math.max(0, batch.length - (value && batch.includes(value) ? 1 : 0));
  const triggerLabel = selected
    ? extraCount > 0
      ? `${modelLabel(selected)} +${extraCount}`
      : modelLabel(selected)
    : value || "Select a model";
  const canReorder = Boolean(props.onReorderPreferred) && !query.trim();
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
      {open && box
        ? createPortal(
        <div
          ref={popRef}
          className="model-menu-pop"
          style={{ left: box.left, bottom: box.bottom, maxHeight: box.maxHeight }}
        >
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
              <div className="model-menu-heading">
                Preferred{canReorder ? " · drag to reorder" : ""}
              </div>
            ) : null}
            {props.onToggleBatch ? (
              <div className="model-menu-note">Check a model to run this prompt on it too. Up to {MAX_BATCH_MODELS}.</div>
            ) : null}
            {grouped.preferred.map((model, index) => (
              <ModelOption
                key={`fav-${model.id}`}
                model={model}
                index={index}
                selected={model.id === value}
                included={batch.includes(model.id)}
                batchFull={batch.length >= MAX_BATCH_MODELS}
                hot={index === activeHot}
                draggable={canReorder}
                dropTarget={dragOver === model.id}
                onHot={() => setHot(index)}
                onChoose={() => choose(model.id)}
                onToggleBatch={
                  props.onToggleBatch ? () => props.onToggleBatch?.(model.id) : undefined
                }
                onDragStart={() => undefined}
                onDragOver={() => setDragOver(model.id)}
                onDrop={(fromId) => {
                  setDragOver(null);
                  if (fromId) props.onReorderPreferred?.(fromId, model.id);
                }}
                onDragEnd={() => setDragOver(null)}
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
                  included={batch.includes(model.id)}
                  batchFull={batch.length >= MAX_BATCH_MODELS}
                  hot={optionIndex === activeHot}
                  onHot={() => setHot(optionIndex)}
                  onChoose={() => choose(model.id)}
                  onToggleBatch={
                    props.onToggleBatch ? () => props.onToggleBatch?.(model.id) : undefined
                  }
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
                  included={batch.includes(model.id)}
                  batchFull={batch.length >= MAX_BATCH_MODELS}
                  hot={optionIndex === activeHot}
                  onHot={() => setHot(optionIndex)}
                  onChoose={() => choose(model.id)}
                  onToggleBatch={
                    props.onToggleBatch ? () => props.onToggleBatch?.(model.id) : undefined
                  }
                />
              );
            })}
            {options.length === 0 ? <div className="model-menu-empty">{emptyLabel}</div> : null}
          </div>
        </div>,
        document.body,
      )
        : null}
    </div>
  );
}

function ModelOption({
  model,
  index,
  selected,
  included,
  batchFull,
  hot,
  draggable,
  dropTarget,
  onHot,
  onChoose,
  onToggleBatch,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  model: OxenModel;
  index: number;
  selected: boolean;
  included?: boolean;
  batchFull?: boolean;
  hot: boolean;
  draggable?: boolean;
  dropTarget?: boolean;
  onHot: () => void;
  onChoose: () => void;
  onToggleBatch?: () => void;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: (fromId: string) => void;
  onDragEnd?: () => void;
}) {
  const label = modelLabel(model);
  return (
    <div
      className={`model-menu-row${dropTarget ? " is-drop" : ""}`}
      onDragOver={(event) => {
        if (!draggable) return;
        event.preventDefault();
        onDragOver?.();
      }}
      onDrop={(event) => {
        if (!draggable) return;
        event.preventDefault();
        onDrop?.(event.dataTransfer.getData("text/plain"));
      }}
    >
      {draggable ? (
        <button
          type="button"
          className="model-menu-grip"
          aria-label={`Drag to reorder ${label}`}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", model.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => onDragEnd?.()}
        >
          ⋮⋮
        </button>
      ) : null}
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
        {label}
      </button>
      {onToggleBatch ? (
        <input
          type="checkbox"
          className="model-menu-check"
          checked={Boolean(included)}
          disabled={Boolean(batchFull) && !included}
          aria-label={`Include ${label} in this run`}
          onMouseDown={(event) => event.stopPropagation()}
          onChange={() => onToggleBatch()}
        />
      ) : null}
    </div>
  );
}
