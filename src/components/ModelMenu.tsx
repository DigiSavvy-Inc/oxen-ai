import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { OxenModel } from "../lib/api";
import {
  filterModels,
  groupPreferredModels,
  modelLabel,
  modelMenuCssBox,
  modelMenuKeyAction,
  placeModelMenu,
  type ModelMenuKeyAction,
} from "../lib/model-menu";

type Props = {
  models: OxenModel[];
  preferred: OxenModel[];
  value: string;
  query: string;
  onQueryChange: (value: string) => void;
  onChange: (value: string) => void;
};

type MenuBox = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  return target.isContentEditable;
}

function finePointer(): boolean {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function ModelMenu(props: Props) {
  const { models, preferred, value, query, onQueryChange, onChange } = props;
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(0);
  const [box, setBox] = useState<MenuBox | null>(null);
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

  const optionsRef = useRef(options);
  const hotRef = useRef(activeHot);
  const queryRef = useRef(query);
  const applyRef = useRef<(action: ModelMenuKeyAction) => void>(() => {});

  const close = useCallback(() => {
    setOpen(false);
    setBox(null);
    onQueryChange("");
  }, [onQueryChange]);

  function choose(id: string) {
    onChange(id);
    close();
  }

  const chooseRef = useRef(choose);
  const closeRef = useRef(close);

  function openMenu() {
    const index = options.findIndex((model) => model.id === value);
    setHot(index >= 0 ? index : 0);
    setBox(null);
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const trigger = rootRef.current?.querySelector(".model-menu-trigger");
      if (!(trigger instanceof HTMLElement)) return;
      const rect = trigger.getBoundingClientRect();
      const vv = window.visualViewport;
      const frame = {
        width: vv?.width ?? window.innerWidth,
        height: vv?.height ?? window.innerHeight,
        offsetTop: vv?.offsetTop ?? 0,
        offsetLeft: vv?.offsetLeft ?? 0,
        layoutHeight: window.innerHeight,
      };
      const placement = placeModelMenu({
        trigger: { top: rect.top, bottom: rect.bottom, left: rect.left },
        viewport: { width: frame.width, height: frame.height },
      });
      const next = modelMenuCssBox(placement, {
        offsetTop: frame.offsetTop,
        offsetLeft: frame.offsetLeft,
        layoutHeight: frame.layoutHeight,
        visualHeight: frame.height,
      });
      setBox((prev) =>
        prev &&
        prev.left === next.left &&
        prev.width === next.width &&
        prev.maxHeight === next.maxHeight &&
        prev.top === next.top &&
        prev.bottom === next.bottom
          ? prev
          : next,
      );
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popRef.current?.contains(target)) return;
      closeRef.current();
    }
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const placed = box !== null;
  useEffect(() => {
    if (!open || !placed || !finePointer()) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [open, placed]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const el = list?.querySelector("[data-hot='true']");
    if (!(list instanceof HTMLElement) || !(el instanceof HTMLElement)) return;
    const listRect = list.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top < listRect.top) list.scrollTop -= listRect.top - elRect.top;
    else if (elRect.bottom > listRect.bottom) list.scrollTop += elRect.bottom - listRect.bottom;
  }, [open, activeHot, query]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (isTextEntry(event.target)) return;
      const action = modelMenuKeyAction(event.key, queryRef.current, {
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        isComposing: event.isComposing,
      });
      if (!action) return;
      event.preventDefault();
      applyRef.current(action);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function moveHot(delta: number) {
    const count = optionsRef.current.length;
    if (count === 0) return;
    setHot((current) => {
      const next = current + delta;
      if (next < 0) return count - 1;
      if (next >= count) return 0;
      return next;
    });
  }

  function applyMenuAction(action: ModelMenuKeyAction) {
    switch (action.type) {
      case "query":
        onQueryChange(action.query);
        setHot(0);
        break;
      case "move":
        moveHot(action.delta);
        break;
      case "home":
        setHot(0);
        break;
      case "end":
        setHot(Math.max(0, optionsRef.current.length - 1));
        break;
      case "choose": {
        const option = optionsRef.current[hotRef.current];
        if (option) chooseRef.current(option.id);
        break;
      }
      case "close":
        closeRef.current();
        break;
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  }

  useEffect(() => {
    optionsRef.current = options;
    hotRef.current = activeHot;
    queryRef.current = query;
    chooseRef.current = choose;
    closeRef.current = close;
    applyRef.current = applyMenuAction;
  });

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    const action = modelMenuKeyAction(event.key, query, {
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      isComposing: event.nativeEvent.isComposing,
    });
    if (!action || action.type === "query") return;
    event.preventDefault();
    applyMenuAction(action);
  }

  const triggerLabel = selected ? modelLabel(selected) : value || "Select a model";
  const headingRest = grouped.preferred.length > 0 ? "All" : "Models";
  const emptyLabel = query.trim()
    ? `No models match “${query.trim()}”`
    : "No models";
  const activeId = options[activeHot] ? `model-option-${activeHot}` : undefined;

  return (
    <div className="model-menu" ref={rootRef}>
      <button
        type="button"
        className={`select select-model model-menu-trigger${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="model-menu-list"
        aria-activedescendant={open ? activeId : undefined}
        aria-label="Model"
        onClick={() => {
          if (open) close();
          else openMenu();
        }}
        onKeyDown={(event) => {
          if (open) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
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
              style={{
                left: box.left,
                width: box.width,
                maxHeight: box.maxHeight,
                top: box.top,
                bottom: box.bottom,
              }}
            >
              <div
                className="model-menu-search-row"
                onPointerDown={(event) => {
                  if (event.target === searchRef.current) return;
                  event.preventDefault();
                  searchRef.current?.focus({ preventScroll: true });
                }}
              >
                <SearchIcon />
                <input
                  ref={searchRef}
                  className="model-menu-search"
                  type="search"
                  placeholder="Search models"
                  value={query}
                  aria-label="Filter models"
                  aria-autocomplete="list"
                  aria-controls="model-menu-list"
                  aria-activedescendant={activeId}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(event) => {
                    onQueryChange(event.target.value);
                    setHot(0);
                  }}
                  onKeyDown={onSearchKeyDown}
                />
              </div>
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="model-menu-search-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <circle cx="7" cy="7" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5 L13.5 13.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
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
      onPointerDown={(event) => {
        event.preventDefault();
        onChoose();
      }}
    >
      {modelLabel(model)}
    </button>
  );
}
