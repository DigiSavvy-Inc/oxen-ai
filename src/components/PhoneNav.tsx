import { useEffect, useState } from "react";

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M4 7h16M4 12h16M4 17h16"
      />
    </svg>
  );
}

export function PhoneNav({
  libraryActive,
  projectsActive,
  slotsActive,
  galleriesActive,
  onOpenLibrary,
  onOpenProjects,
  onOpenSlots,
  onOpenGalleries,
}: {
  libraryActive: boolean;
  projectsActive: boolean;
  slotsActive: boolean;
  galleriesActive: boolean;
  onOpenLibrary: () => void;
  onOpenProjects: () => void;
  onOpenSlots: () => void;
  onOpenGalleries: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="phone-nav">
      <button
        type="button"
        className={`phone-nav-hit${open ? " active" : ""}`}
        aria-expanded={open}
        aria-controls="phone-nav-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
      >
        <MenuIcon />
      </button>
      {open ? (
        <>
          <button type="button" className="phone-nav-backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />
          <nav id="phone-nav-menu" className="phone-nav-drawer" aria-label="Library, projects, slots, and galleries">
            <div className="phone-nav-head">
              <strong>Browse</strong>
              <button type="button" className="icon-btn phone-nav-close" aria-label="Close menu" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <button
              type="button"
              className={libraryActive ? "active" : undefined}
              aria-current={libraryActive ? "page" : undefined}
              onClick={() => choose(onOpenLibrary)}
            >
              Library
            </button>
            <button
              type="button"
              className={projectsActive ? "active" : undefined}
              aria-current={projectsActive ? "page" : undefined}
              onClick={() => choose(onOpenProjects)}
            >
              Projects
            </button>
            <button
              type="button"
              className={slotsActive ? "active" : undefined}
              aria-current={slotsActive ? "page" : undefined}
              onClick={() => choose(onOpenSlots)}
            >
              Slots
            </button>
            <button
              type="button"
              className={galleriesActive ? "active" : undefined}
              aria-current={galleriesActive ? "page" : undefined}
              onClick={() => choose(onOpenGalleries)}
            >
              Galleries
            </button>
          </nav>
        </>
      ) : null}
    </div>
  );
}
