import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { filterModels, groupPreferredModels, modelLabel, type MenuModel } from "../lib/model-menu";
import { modeIconsLabel, modelModes } from "../lib/mode-icons";
import { ModeIcons } from "./ModeIcon";

type Props = {
  models: MenuModel[];
  preferred: { id: string }[];
  value: string;
  onChange: (value: string) => void;
  /** Search text held by the caller, which may widen `models` from it. Left out, the menu keeps its own. */
  query?: string;
  onQueryChange?: (value: string) => void;
  /** Accessible name of the control. */
  label?: string;
  /** A first row that clears the choice. Its label also stands in on the trigger while nothing is picked. */
  emptyOption?: string;
  /** A second line under the name, such as what the model accepts. */
  detail?: (model: MenuModel) => string | null;
  disabled?: boolean;
  id?: string;
  /** Fill the row it sits in, and open toward whichever side has room. The composer's opens upward. */
  block?: boolean;
};

type Box = { left: number; width?: number; top?: number; bottom?: number; maxHeight: number };

const POP_WIDTH = 320;
const POP_HEIGHT = 320;

export function ModelMenu(props: Props) {
  const { models, preferred, value, onChange, emptyOption, detail, disabled = false, block = false } = props;
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(0);
  const [ownQuery, setOwnQuery] = useState("");
  const [box, setBox] = useState<Box | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = `model-menu-list-${useId()}`;

  const query = props.query ?? ownQuery;
  const reportQuery = props.onQueryChange;
  const setQuery = useCallback(
    (next: string) => {
      setOwnQuery(next);
      reportQuery?.(next);
    },
    [reportQuery],
  );

  const selected = models.find((model) => model.id === value) ?? null;
  const visible = useMemo(() => filterModels(models, query), [models, query]);
  const grouped = useMemo(
    () => groupPreferredModels(visible, preferred),
    [visible, preferred],
  );
  const searching = Boolean(query.trim());
  const extra: MenuModel[] =
    value && !visible.some((model) => model.id === value) && !searching
      ? [selected ?? { id: value }]
      : [];
  const clearRow: MenuModel[] = emptyOption != null && !searching ? [{ id: "" }] : [];
  const options = [...clearRow, ...grouped.preferred, ...grouped.rest, ...extra];
  const activeHot = options.length === 0 ? 0 : Math.min(hot, options.length - 1);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, [setQuery]);

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
      const width = block ? Math.min(Math.max(rect.width, POP_WIDTH), window.innerWidth - 16) : undefined;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - (width ?? POP_WIDTH) - 8));
      const above = rect.top - 12;
      const below = window.innerHeight - rect.bottom - 12;
      if (block && (below >= POP_HEIGHT || below >= above)) {
        setBox({ left, width, top: rect.bottom + 6, maxHeight: Math.min(POP_HEIGHT, Math.max(160, below)) });
        return;
      }
      setBox({
        left,
        width,
        bottom: window.innerHeight - rect.top + 6,
        maxHeight: Math.min(POP_HEIGHT, Math.max(160, above)),
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, block]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popRef.current?.contains(target)) return;
      close();
    }
    // Capture, and claim the key, so a panel holding this menu stays open while the list closes.
    function onDocumentKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    }
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onDocumentKey, true);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onDocumentKey, true);
    };
  }, [open, close]);

  // The list mounts once it has a place, which on the first open is one render after `open`.
  const placed = box != null;
  useEffect(() => {
    if (!open || !placed) return;
    searchRef.current?.focus();
  }, [open, placed]);

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

  const controlLabel = props.label ?? "Model";
  const triggerModel = selected ?? (value ? { id: value } : null);
  const triggerLabel = triggerModel ? modelLabel(triggerModel) : (emptyOption ?? "Select a model");
  const triggerKinds = triggerModel ? modeIconsLabel(modelModes(triggerModel)) : "";
  const triggerName = triggerModel
    ? `${controlLabel}: ${triggerLabel}${triggerKinds ? `. ${triggerKinds}` : ""}`
    : controlLabel;
  const headingRest = grouped.preferred.length > 0 ? "All" : "Models";
  const emptyLabel = searching ? `No models match “${query.trim()}”` : "No models";
  const offset = clearRow.length;

  function option(model: MenuModel, index: number, key: string) {
    return (
      <ModelOption
        key={key}
        id={`${listId}-${index}`}
        model={model}
        label={model.id ? modelLabel(model) : (emptyOption ?? "")}
        detail={model.id ? (detail?.(model) ?? null) : null}
        selected={model.id === value}
        hot={index === activeHot}
        onHot={() => setHot(index)}
        onChoose={() => choose(model.id)}
      />
    );
  }

  return (
    <div className={`model-menu${block ? " is-block" : ""}`} ref={rootRef}>
      <button
        type="button"
        id={props.id}
        className={`select select-model model-menu-trigger${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={triggerName}
        disabled={disabled}
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
        {triggerModel ? <ModeIcons modes={modelModes(triggerModel)} /> : null}
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
          style={{ left: box.left, width: box.width, top: box.top, bottom: box.bottom, maxHeight: box.maxHeight }}
        >
          <input
            ref={searchRef}
            className="field model-menu-search"
            type="search"
            placeholder="Search models"
            value={query}
            aria-label="Filter models"
            aria-controls={listId}
            aria-activedescendant={options[activeHot] ? `${listId}-${activeHot}` : undefined}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setHot(0);
            }}
            onKeyDown={onSearchKeyDown}
          />
          <div
            ref={listRef}
            id={listId}
            className="model-menu-list"
            role="listbox"
            aria-label={`${controlLabel} list`}
          >
            {clearRow.map((model) => option(model, 0, "none"))}
            {grouped.preferred.length > 0 ? (
              <div className="model-menu-heading">Preferred</div>
            ) : null}
            {grouped.preferred.map((model, index) => option(model, offset + index, `fav-${model.id}`))}
            {grouped.rest.length > 0 ? (
              <div className="model-menu-heading">{headingRest}</div>
            ) : null}
            {grouped.rest.map((model, index) =>
              option(model, offset + grouped.preferred.length + index, model.id),
            )}
            {extra.map((model, index) =>
              option(model, offset + grouped.preferred.length + grouped.rest.length + index, `extra-${model.id}`),
            )}
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
  id,
  model,
  label,
  detail,
  selected,
  hot,
  onHot,
  onChoose,
}: {
  id: string;
  model: MenuModel;
  label: string;
  detail: string | null;
  selected: boolean;
  hot: boolean;
  onHot: () => void;
  onChoose: () => void;
}) {
  return (
    <button
      id={id}
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
      <span className="model-menu-option-copy">
        <span className="model-menu-option-name">{label}</span>
        {detail ? <span className="model-menu-option-detail">{detail}</span> : null}
      </span>
      {model.id ? <ModeIcons modes={modelModes(model)} /> : null}
    </button>
  );
}
