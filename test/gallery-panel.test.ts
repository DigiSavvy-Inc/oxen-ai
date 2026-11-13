import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { escapeTaken } from "../src/lib/escape-layer";
import { galleryChordTaken } from "../src/lib/shortcut-layer";
import { keepDraftIds } from "../src/lib/gallery-draft";
import { moveItem } from "../src/lib/mentions";
import { insertBeforeAt, reorderTarget, tileDropSide } from "../src/lib/tile-reorder";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("gallery tile reorder", () => {
  it("picks the gap from the half of the tile under the pointer", () => {
    expect(insertBeforeAt(3, 100, 80, 110)).toBe(3);
    expect(insertBeforeAt(3, 100, 80, 139)).toBe(3);
    expect(insertBeforeAt(3, 100, 80, 140)).toBe(4);
    expect(insertBeforeAt(3, 100, 80, 179)).toBe(4);
  });

  it("moves a tile to the gap and leaves it when the gap is its own", () => {
    const tiles = ["a", "b", "c", "d", "e"];
    const drop = (from: number, gap: number) => {
      const to = reorderTarget(from, gap, tiles.length);
      return to == null ? null : moveItem(tiles, from, to).join("");
    };
    expect(drop(0, 3)).toBe("bcade");
    expect(drop(4, 0)).toBe("eabcd");
    expect(drop(1, 5)).toBe("acdeb");
    expect(drop(3, 1)).toBe("adbce");
    expect(drop(2, 2)).toBeNull();
    expect(drop(2, 3)).toBeNull();
  });

  it("ignores a drag it does not know and clamps a gap past the end", () => {
    expect(reorderTarget(-1, 2, 5)).toBeNull();
    expect(reorderTarget(5, 2, 5)).toBeNull();
    expect(reorderTarget(Number.NaN, 2, 5)).toBeNull();
    expect(reorderTarget(0, 99, 5)).toBe(4);
    expect(reorderTarget(4, -3, 5)).toBe(0);
  });

  it("shows the drop line on the edge the tile will land against", () => {
    expect(tileDropSide(3, 0, 3)).toBe("before");
    expect(tileDropSide(3, 0, 4)).toBe("after");
    expect(tileDropSide(3, 0, null)).toBeNull();
    expect(tileDropSide(3, 3, 3)).toBeNull();
    expect(tileDropSide(2, 3, 3)).toBeNull();
    expect(tileDropSide(3, 3, 4)).toBeNull();
    expect(tileDropSide(1, 0, 4)).toBeNull();
  });
});

describe("gallery save", () => {
  const sent = [
    { id: "local-1", key: "u/1/a.png" },
    { id: "local-2", key: "u/1/b.png" },
  ];

  it("keeps the ids on screen when the saved list is the list that was sent", () => {
    const saved = [
      { id: "row-1", key: "u/1/a.png", name: "a" },
      { id: "row-2", key: "u/1/b.png", name: "b" },
    ];
    expect(keepDraftIds(sent, saved)).toEqual([
      { id: "local-1", key: "u/1/a.png", name: "a" },
      { id: "local-2", key: "u/1/b.png", name: "b" },
    ]);
  });

  it("takes the saved ids when the server kept a different list", () => {
    const shorter = [{ id: "row-1", key: "u/1/a.png" }];
    expect(keepDraftIds(sent, shorter)).toEqual(shorter);
    const reordered = [
      { id: "row-1", key: "u/1/b.png" },
      { id: "row-2", key: "u/1/a.png" },
    ];
    expect(keepDraftIds(sent, reordered)).toEqual(reordered);
  });
});

describe("escape closes the topmost layer first", () => {
  it("leaves the panel open when something above it claimed the key", () => {
    expect(escapeTaken({ defaultPrevented: true, target: null })).toBe(true);
  });

  it("leaves the panel open while a select's list is showing", () => {
    const select = (open: boolean) => ({ tagName: "SELECT", matches: () => open });
    expect(escapeTaken({ defaultPrevented: false, target: select(true) })).toBe(true);
    expect(escapeTaken({ defaultPrevented: false, target: select(false) })).toBe(false);
  });

  it("closes the panel for a plain key press, and for a browser without :open", () => {
    expect(escapeTaken({ defaultPrevented: false, target: null })).toBe(false);
    expect(escapeTaken({ defaultPrevented: false, target: { tagName: "INPUT", matches: () => true } })).toBe(false);
    const old = {
      tagName: "select",
      matches: () => {
        throw new Error("':open' is not a valid selector");
      },
    };
    expect(escapeTaken({ defaultPrevented: false, target: old })).toBe(false);
  });

  it("is what the app asks before it closes a panel", () => {
    const app = source("../src/App.tsx");
    const handler = app.slice(app.indexOf('if (event.key === "Escape") {'), app.indexOf('event.code === "KeyL"'));
    expect(handler.indexOf("if (escapeTaken(event)) return;")).toBeGreaterThan(-1);
    expect(handler.indexOf("if (escapeTaken(event)) return;")).toBeLessThan(handler.indexOf("closeLibrary()"));
  });
});

describe("gallery chord", () => {
  function field(tagName: string) {
    return { tagName, closest: () => null };
  }

  it("stays with a text field, the prompt, and any input", () => {
    expect(galleryChordTaken({ defaultPrevented: false, target: field("TEXTAREA") })).toBe(true);
    expect(galleryChordTaken({ defaultPrevented: false, target: field("input") })).toBe(true);
    expect(galleryChordTaken({ defaultPrevented: false, target: field("SELECT") })).toBe(true);
    expect(galleryChordTaken({ defaultPrevented: false, target: { isContentEditable: true } })).toBe(true);
    expect(
      galleryChordTaken({
        defaultPrevented: false,
        target: { tagName: "DIV", getAttribute: (name: string) => (name === "role" ? "textbox" : null) },
      }),
    ).toBe(true);
    expect(
      galleryChordTaken({
        defaultPrevented: false,
        target: { closest: (selector: string) => (selector.includes("textarea") ? field("TEXTAREA") : null) },
      }),
    ).toBe(true);
  });

  it("stays with an open menu that already uses the key, and takes a plain key otherwise", () => {
    const menu = (shortcut: string | null) => ({
      tagName: "DIV",
      closest: (selector: string) => (selector.includes("role='menu'") ? menu(shortcut) : null),
      getAttribute: (name: string) => (name === "aria-keyshortcuts" ? shortcut : null),
      querySelectorAll: () => [],
    });
    expect(galleryChordTaken({ defaultPrevented: true, target: { tagName: "BUTTON" } })).toBe(true);
    expect(galleryChordTaken({ defaultPrevented: false, target: menu("Meta+Shift+G") })).toBe(true);
    expect(galleryChordTaken({ defaultPrevented: false, target: menu("Control+G") })).toBe(true);
    expect(galleryChordTaken({ defaultPrevented: false, target: menu("Meta+Shift+Comma") })).toBe(false);
    expect(galleryChordTaken({ defaultPrevented: false, target: menu(null) })).toBe(false);
    expect(galleryChordTaken({ defaultPrevented: false, target: { tagName: "BUTTON", closest: () => null } })).toBe(false);
    expect(galleryChordTaken({ defaultPrevented: false, target: null })).toBe(false);
  });

  it("is what the window handler asks before it takes the key, and the gallery control shows the chord", () => {
    const app = source("../src/App.tsx");
    const composer = source("../src/components/Composer.tsx");
    const docs = source("../src/lib/docs.ts");
    const branch = app.slice(app.indexOf('event.code === "KeyG"'), app.indexOf('window.addEventListener("keydown", onKey)'));
    expect(branch.indexOf("if (galleryChordTaken(event)) return;")).toBeGreaterThan(-1);
    expect(branch.indexOf("if (galleryChordTaken(event)) return;")).toBeLessThan(branch.indexOf("event.preventDefault()"));
    expect(branch).toContain("toggleGalleryPanelRef.current()");
    expect(composer).toContain('aria-keyshortcuts="Meta+Shift+G"');
    expect(composer).toContain("Gallery (⌘⇧G)");
    expect(composer).toContain("<kbd>G</kbd>");
    expect(docs).toContain("⌘⇧G opens and closes the gallery.");
  });
});

describe("one gallery panel, two ways in", () => {
  const app = source("../src/App.tsx");
  const composer = source("../src/components/Composer.tsx");
  const sidebar = source("../src/components/Sidebar.tsx");
  const browser = source("../src/components/GalleryBrowser.tsx");
  const css = source("../src/index.css");

  it("has no second gallery view", () => {
    expect(existsSync(new URL("../src/components/GalleryDrawer.tsx", import.meta.url))).toBe(false);
    for (const file of [app, composer, sidebar, browser]) {
      expect(file).not.toContain("GalleryDrawer");
      expect(file).not.toContain("gallery-drawer");
    }
    expect(css).not.toContain("gallery-drawer");
    expect(css).not.toMatch(/\.gallery-(search|scroll|grid|actions|new)\b/);
    expect(css).not.toMatch(/\.gallery-tile(-frame)?[\s.,{:>]/);
    expect(composer).not.toContain("galleryForMode");
    expect(composer).not.toContain("createPortal(drawer");
  });

  it("opens the library panel from the prompt, on the gallery last opened or on the list", () => {
    expect(composer).toContain('aria-controls="media-library"');
    expect(composer).toContain("onClick={() => props.onGalleryToggle?.()}");
    expect(sidebar).toContain('<aside className="sidebar" id="media-library">');
    expect(app).toContain("onGalleryToggle={toggleGalleryPanel}");
    expect(app).toContain('const galleryPanelOpen = libraryOpen && libraryPane === "galleries";');
    expect(app).toContain("galleryOpen={galleryPanelOpen}");
    const toggle = app.slice(app.indexOf("function toggleGalleryPanel()"), app.indexOf("function openProjectsPane()"));
    expect(toggle).toContain("closeLibrary();");
    expect(toggle).toContain("setManagingGallery(Boolean(galleryId));");
    expect(toggle).toContain('setLibraryPane("galleries");');
    expect(toggle).toContain("setLibraryOpen(true);");
  });

  it("closes by X, by Escape, and by a click on the scrim", () => {
    expect(sidebar).toContain('aria-label="Close library"\n              onClick={onClose}');
    expect(app).toMatch(/className="slide-backdrop"\s+aria-label="Close library"\s+onClick=\{closeLibrary\}/);
    expect(css).toMatch(/\.slide-backdrop\s*\{[^}]*inset:\s*52px 0 0 0/);
  });

  it("lets a tile on its way to the prompt pass through the scrim", () => {
    expect(app).toContain('galleryTileDrag ? " is-tile-drag" : ""');
    expect(sidebar).toContain("onTileDrag={onGalleryTileDrag}");
    expect(css).toMatch(/\.app-shell\.is-tile-drag \.slide-backdrop\s*\{[^}]*pointer-events:\s*none/);
    const close = app.slice(app.indexOf("const closeLibrary = useCallback"), app.indexOf("const chooseLibraryPane"));
    expect(close).toContain("setGalleryTileDrag(false);");
  });

  it("drags tiles into order and saves that order with the gallery", () => {
    expect(browser).toContain("useTileReorder({");
    expect(browser).toContain("{...reorder.set}");
    expect(browser).toContain("{...drag.handlers}");
    expect(css).toMatch(/\.gallery-manage-tile\.is-dragging\s*\{[^}]*opacity/);
    expect(css).toMatch(/\.gallery-manage-tile\.is-drop-before::after\s*\{[^}]*left:\s*0/);
    expect(css).toMatch(/\.gallery-manage-tile\.is-drop-after::after\s*\{[^}]*right:\s*0/);
    expect(sidebar).toContain("onReorder={onGalleryReorder}");
    const reorder = app.slice(app.indexOf("function editGalleryItems("), app.indexOf("async function onGalleryRename"));
    expect(reorder).toContain("editGalleryItems(moveItem(galleryItems, from, to));");
    expect(reorder).toContain("galleryAutosave.current = Boolean(galleryId && galleryName.trim());");
    expect(reorder).toContain("if (gallerySaving || !galleryAutosave.current) return;");
    const hook = source("../src/lib/tile-reorder.ts");
    expect(hook).toContain("event.dataTransfer.setData(GALLERY_ITEM_DRAG_TYPE, item.id);");
    expect(hook).not.toContain("text/plain");
  });

  it("keeps a newer order when an older save returns", () => {
    const save = app.slice(app.indexOf("async function onGallerySave("), app.indexOf("function onDropHistoryMedia("));
    expect(save).toContain("const edit = galleryEdit.current;");
    expect(save).toContain("if (galleryEdit.current === edit) {");
    expect(save).toContain("keepDraftIds(items, saved.gallery.items.map(draftFromGalleryItem))");
  });

  it("keeps a file added or removed while a save is in flight", () => {
    const change = app.slice(app.indexOf("function changeGallerySet("), app.indexOf("async function onGallerySave("));
    expect(change).toContain("galleryEdit.current += 1;");
    expect(app).toContain("changeGallerySet((prev) => [...prev, ...added].slice(0, GALLERY_ITEM_CAP));");
    expect(app).toContain("changeGallerySet(() => result.items);");
    expect(app).toContain("onGalleryRemove={(index) => changeGallerySet(");
  });

  it("keeps a canvas result above the scrim while a gallery is open, so it can be dragged in", () => {
    expect(app).toContain('${galleryPanelOpen && managingGallery ? " is-gallery-open" : ""}');
    const scrim = Number(css.match(/\.slide-backdrop\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
    const raised = css.match(
      /\.app-shell\.is-gallery-open \.result-media,\s*\.app-shell\.is-gallery-open \.variation-thumb\s*\{[^}]*z-index:\s*(\d+)/,
    );
    const panel = Number(css.match(/\.sidebar\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
    expect(Number(raised?.[1])).toBe(scrim);
    expect(panel).toBeGreaterThan(scrim);
    // Equal z-index: the canvas wins only because it comes after the scrim in the page.
    expect(app.indexOf('className="slide-backdrop"')).toBeLessThan(app.indexOf("<Canvas"));
  });

  it("keeps every tile control and the selection bar", () => {
    for (const piece of [
      "Attach all",
      "onAttach(selectedItems)",
      "onAttach([item])",
      "GalleryRoleSelect",
      "gallery-feature",
      "is-attached",
      'className="gallery-bulk"',
      "Choose a gallery",
      'void place("copy")',
      'void place("move")',
      "props.onDropHistory(ids)",
      "props.onAddFiles(event.dataTransfer.files)",
      "props.skipped.join",
    ]) {
      expect(browser).toContain(piece);
    }
    expect(css).toMatch(/\.gallery-bulk\s*\{[^}]*position:\s*sticky/);
  });

  it("attaches at the caret the prompt remembers", () => {
    expect(composer).toContain("caret: promptCaret,");
    expect(app).toContain(": (field?.caret() ?? null);");
    expect(composer).toContain("props.onGalleryAttach?.(picked, promptCaret());");
  });
});
