import { createContext, useContext, type ReactNode } from "react";

export type PanelPlace = "left" | "bottom" | "right";

const STORAGE_KEY = "ds-studio-panel-place";

export function readPanelPlace(): PanelPlace {
  if (typeof window === "undefined") return "left";
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "left" || value === "bottom" || value === "right") return value;
  } catch {
    /* storage unavailable */
  }
  return "left";
}

export function storePanelPlace(place: PanelPlace) {
  try {
    window.localStorage.setItem(STORAGE_KEY, place);
  } catch {
    /* storage unavailable */
  }
}

type PanelPlaceContextValue = {
  place: PanelPlace;
  setPlace: (place: PanelPlace) => void;
};

const PanelPlaceContext = createContext<PanelPlaceContextValue>({
  place: "left",
  setPlace: () => {},
});

export function PanelPlaceProvider({
  place,
  setPlace,
  children,
}: PanelPlaceContextValue & { children: ReactNode }) {
  return <PanelPlaceContext.Provider value={{ place, setPlace }}>{children}</PanelPlaceContext.Provider>;
}

export function usePanelPlace() {
  return useContext(PanelPlaceContext);
}

function DockLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.25 2.5v11" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function DockBottomIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 10.25h12" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function DockRightIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9.75 2.5v11" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

const PLACES: { id: PanelPlace; label: string; icon: () => ReactNode }[] = [
  { id: "left", label: "Dock left", icon: DockLeftIcon },
  { id: "bottom", label: "Rise from the bottom", icon: DockBottomIcon },
  { id: "right", label: "Dock right", icon: DockRightIcon },
];

export function PanelPlaceSwitch() {
  const { place, setPlace } = usePanelPlace();
  return (
    <div className="panel-place" role="radiogroup" aria-label="Panel position">
      {PLACES.map((item) => {
        const Icon = item.icon;
        const on = place === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={item.label}
            title={item.label}
            className={on ? "is-on" : ""}
            onClick={() => setPlace(item.id)}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
