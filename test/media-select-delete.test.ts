import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DELETE_BATCH_MAX,
  DELETE_MENU_ARM_MS,
  deleteBatches,
  deleteChoices,
  deleteMenuArmed,
  deleteOutcome,
  itemCount,
  oxenFilesNote,
  readDeleteReply,
  tallyDelete,
  type DeleteResult,
} from "../src/lib/media-delete";
import {
  actionLabel,
  actionTargets,
  addToGalleryLabel,
  pickedInGroup,
  prunePicked,
  selectionInsideGroup,
  selectionSummary,
  togglePicked,
} from "../src/lib/media-selection";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const group = ["a1", "a2", "a3", "a4"];

describe("selection in an opened group", () => {
  it("ticks any image, the shown one included, and unticks it again", () => {
    let picked = togglePicked([], ["a1"]);
    picked = togglePicked(picked, ["a3"]);
    expect(picked).toEqual(["a1", "a3"]);
    expect(togglePicked(picked, ["a1"])).toEqual(["a3"]);
  });

  it("ticks a whole tile, and clears it only when all of it is ticked", () => {
    expect(togglePicked(["a2"], group)).toEqual(["a2", "a1", "a3", "a4"]);
    expect(togglePicked(["x", ...group], group)).toEqual(["x"]);
    expect(togglePicked(["x"], [])).toEqual(["x"]);
  });

  it("acts on the ticked images in the group's order", () => {
    const targets = actionTargets(group, ["a3", "zz", "a1"], "a2");
    expect(targets).toEqual({ ids: ["a1", "a3"], fromSelection: true });
    expect(pickedInGroup(group, ["a4", "a2"])).toEqual(["a2", "a4"]);
  });

  it("acts on the image being shown when nothing is ticked", () => {
    expect(actionTargets(group, [], "a2")).toEqual({ ids: ["a2"], fromSelection: false });
    expect(actionTargets(group, ["other"], "a2")).toEqual({ ids: ["a2"], fromSelection: false });
    expect(actionTargets(group, [], null).ids).toEqual([]);
    expect(actionTargets(group, [], "gone").ids).toEqual([]);
  });

  it("puts the count on every label once something is ticked", () => {
    const two = actionTargets(group, ["a1", "a3"], "a1");
    expect(actionLabel("Delete", two)).toBe("Delete 2");
    expect(actionLabel("Download", two)).toBe("Download 2");
    expect(actionLabel("Attach", two)).toBe("Attach 2");
    expect(addToGalleryLabel(two)).toBe("Add 2 to gallery");
    expect(selectionSummary(two, 4)).toBe("2 of 4 selected");

    const shown = actionTargets(group, [], "a1");
    expect(actionLabel("Delete", shown)).toBe("Delete");
    expect(addToGalleryLabel(shown)).toBe("Add to gallery");
    expect(selectionSummary(shown, 4)).toBe("This image");
    expect(selectionSummary(shown, 2, "video")).toBe("This video");
    expect(selectionSummary(shown, 2, "audio")).toBe("This clip");
  });

  it("hands the selection to the group bar only when every tick is inside the group", () => {
    expect(selectionInsideGroup(group, ["a1", "a4"])).toBe(true);
    expect(selectionInsideGroup(group, ["a1", "b1"])).toBe(false);
    expect(selectionInsideGroup(group, [])).toBe(false);
    expect(selectionInsideGroup([], ["a1"])).toBe(false);
  });

  it("forgets ticks for items that were deleted", () => {
    expect(prunePicked(["a1", "a2", "b1"], ["a2", "b1", "c1"])).toEqual(["a2", "b1"]);
  });

  it("puts Clear right after Attach on the library selection bar, and it drops every tick", () => {
    const sidebar = source("../src/components/Sidebar.tsx");
    const clear = sidebar.slice(sidebar.indexOf("function clearPicked"), sidebar.indexOf("function pickGroup"));
    expect(clear).toContain("setPicked([])");
    const bar = sidebar.slice(sidebar.indexOf('className="history-bulk"'), sidebar.indexOf('ref={historyRef}'));
    // Rendered only while something is ticked, with the same button style as Download and Attach.
    expect(sidebar).toContain("{livePicked.length > 0 && !groupOwnsPicks ? (\n        <div className=\"history-bulk\">");
    expect(bar).toContain('<button type="button" className="ghost-btn" title="Clear the selection" onClick={clearPicked}>');
    const order = ["Download\"}", "onClick={attachPicked}", "onClick={clearPicked}", "<HistoryGalleryActions", "<DeleteMenu"].map(
      (mark) => bar.indexOf(mark),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("puts the same Clear after Attach on an open gallery's selection bar", () => {
    const gallery = source("../src/components/GalleryBrowser.tsx");
    const clear = gallery.slice(gallery.indexOf("function clearSelected"), gallery.indexOf("function toggleAll"));
    expect(clear).toContain("setSelected([])");
    const bar = gallery.slice(gallery.indexOf('className="gallery-bulk"'), gallery.indexOf("Destination gallery"));
    expect(gallery).toContain("{selectedItems.length > 0 ? (\n        <div className=\"gallery-bulk\">");
    const attach = bar.indexOf("props.onAttach(selectedItems)");
    const cleared = bar.indexOf("onClick={clearSelected}");
    const remove = bar.indexOf("Remove from gallery");
    expect(attach).toBeGreaterThan(-1);
    expect(cleared).toBeGreaterThan(attach);
    expect(remove).toBeGreaterThan(cleared);
  });

  it("gives every image in the opened group a checkbox and one action bar", () => {
    const sidebar = source("../src/components/Sidebar.tsx");
    const frame = sidebar.slice(
      sidebar.indexOf('className="history-expand-frame"'),
      sidebar.indexOf('className="history-expand-versions"'),
    );
    expect(frame).toContain("history-select");
    expect(frame).toContain("toggleIds([preview.id])");
    expect(sidebar).toContain("<HistoryGroupBar");
    expect(sidebar).toContain("!groupOwnsPicks");

    const bar = source("../src/components/HistoryGroupBar.tsx");
    expect(bar).toContain("actionTargets(");
    expect(bar).toContain("Select all {items.length}");
    expect(bar).toContain("Clear");
    expect(bar).toContain("addToGalleryLabel(targets)");
    expect(bar).toContain('actionLabel("Download", targets)');
    expect(bar).toContain('actionLabel("Delete", targets)');
    expect(bar).toContain("<DeleteMenu");
    expect(bar).toContain("wholeSet={targets.fromSelection ? undefined");
  });
});

describe("the Delete menu", () => {
  it("offers Studio first and the permanent choice last, with the count in both", () => {
    const [studio, everywhere] = deleteChoices(3);
    expect(studio).toMatchObject({ scope: "studio", title: "Remove from Studio", danger: false });
    expect(studio.detail).toBe("Takes 3 items out of Studio. Oxen keeps its copies.");
    expect(everywhere).toMatchObject({ scope: "everywhere", title: "Delete everywhere", danger: true });
    expect(everywhere.detail).toBe("Deletes 3 items from Studio and Oxen. Can’t be undone.");
    expect(deleteChoices(1)[0].detail).toBe("Takes 1 item out of Studio. Oxen keeps its copy.");
    expect(itemCount(1)).toBe("1 item");
    expect(itemCount(12)).toBe("12 items");
  });

  it("does not promise freed Oxen storage", () => {
    const text = deleteChoices(2)
      .map((choice) => `${choice.title} ${choice.detail}`)
      .join(" ")
      .toLowerCase();
    expect(text).not.toContain("storage");
    expect(text).not.toContain("free");
  });

  it("ignores a choice made in the same double-click that opened it", () => {
    expect(deleteMenuArmed(1000, 1000 + DELETE_MENU_ARM_MS - 1)).toBe(false);
    expect(deleteMenuArmed(1000, 1000 + DELETE_MENU_ARM_MS)).toBe(true);
  });

  it("only opens on the first click and deletes nothing without a choice", () => {
    const menu = source("../src/components/DeleteMenu.tsx");
    expect(menu).toContain("deleteMenuArmed(openedAt.current, at)");
    expect(menu).toContain("choose(choice.scope, event.timeStamp)");
    expect(menu).toContain('role="menu"');
    expect(menu).toContain("createPortal(");
    expect(menu).not.toContain("confirm(");
    const toggle = menu.slice(menu.indexOf("function toggle"), menu.indexOf("function choose"));
    expect(toggle).not.toContain("onChoose");
  });

  it("is the only delete control on tiles, the bulk bar, the canvas, and the peek", () => {
    const sidebar = source("../src/components/Sidebar.tsx");
    const canvas = source("../src/components/Canvas.tsx");
    const peek = source("../src/components/LibraryPeek.tsx");
    for (const file of [sidebar, canvas, peek]) {
      expect(file).toContain("<DeleteMenu");
      expect(file).not.toContain("MediaDeleteGroup");
      expect(file).not.toContain("fromOxen");
      expect(file).not.toContain("window.confirm");
    }
    expect(peek).not.toContain("Delete + Oxen");
    expect(sidebar).toContain('className="media-delete"');
  });

  it("keeps the hover control unclickable until it is shown", () => {
    const css = source("../src/index.css");
    const hover = css.slice(css.indexOf("@media (hover: hover)"));
    expect(hover).toMatch(/\.media-download,\s*\.media-delete\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/);
    expect(hover).toContain(".history-tile:hover .media-delete");
    expect(hover).toContain(".media-delete.is-open");
  });

  it("names removing from a gallery as its own action, with the Delete menu after it for the files", () => {
    const gallery = source("../src/components/GalleryBrowser.tsx");
    expect(gallery).toContain("Remove from gallery");
    expect(gallery).toContain("The files stay in the library.");
    const bulk = gallery.slice(gallery.indexOf('className="gallery-bulk"'), gallery.indexOf("Destination gallery"));
    const remove = bulk.indexOf("Remove from gallery");
    const menu = bulk.indexOf("<DeleteMenu");
    expect(remove).toBeGreaterThan(-1);
    expect(menu).toBeGreaterThan(remove);
    expect(bulk).toContain("count={deletable.length}");
    expect(bulk).toContain(".onDeleteFiles(ids, scope)");
    expect(gallery).not.toContain("fromOxen");
    expect(gallery).not.toContain("window.confirm");
  });
});

describe("delete requests", () => {
  it("sends one request per 200 ids, in order, without repeats", () => {
    expect(DELETE_BATCH_MAX).toBe(200);
    expect(deleteBatches([])).toEqual([]);
    expect(deleteBatches(["a", "b", "a"])).toEqual([["a", "b"]]);
    const ids = Array.from({ length: 450 }, (_, index) => `g${index}`);
    const batches = deleteBatches(ids);
    expect(batches.map((batch) => batch.length)).toEqual([200, 200, 50]);
    expect(batches.flat()).toEqual(ids);
  });

  it("uses the bulk route for a selection and the single route for one item", () => {
    const app = source("../src/App.tsx");
    const body = app.slice(app.indexOf("async function deleteMedia"), app.indexOf("async function onClearFailed"));
    expect(body).toContain("for (const batch of deleteBatches(ids))");
    expect(body).toContain("api.deleteGenerations(batch, { fromOxen })");
    expect(body).toContain("api.deleteGeneration(batch[0], { fromOxen })");
    expect(body).not.toContain("Promise.all(\n      ids.map");
    expect(body).not.toContain("confirm(");
    const api = source("../src/lib/api.ts");
    expect(api).toContain('fetch("/api/generations/delete"');
  });
});

describe("delete outcome", () => {
  it("reads the Oxen counts the server sends", () => {
    expect(readDeleteReply({ ok: true, oxenDeleted: 2, oxenAlreadyGone: 1, oxenFailed: 0 })).toEqual({
      oxenDeleted: 2,
      oxenGone: 1,
      oxenFailed: 0,
    });
    expect(readDeleteReply({ ok: true })).toEqual({ oxenDeleted: 0, oxenGone: 0, oxenFailed: 0 });
  });

  it("reads other spellings and ignores junk", () => {
    expect(readDeleteReply({ oxen_deleted: 1, oxenMissing: 2, oxen_failed: 3 })).toEqual({
      oxenDeleted: 1,
      oxenGone: 2,
      oxenFailed: 3,
    });
    expect(readDeleteReply({ oxen: "already_gone" }).oxenGone).toBe(1);
    expect(readDeleteReply({ oxen: { deleted: 2, missing: 1, failed: 1 } })).toEqual({
      oxenDeleted: 2,
      oxenGone: 1,
      oxenFailed: 1,
    });
    for (const junk of [null, undefined, "ok", 7, [], { oxenDeleted: "3", oxenFailed: -1, oxenAlreadyGone: Number.NaN }]) {
      expect(readDeleteReply(junk)).toEqual({ oxenDeleted: 0, oxenGone: 0, oxenFailed: 0 });
    }
  });

  function outcome(scope: "studio" | "everywhere", results: DeleteResult[]) {
    return deleteOutcome(tallyDelete(scope, results));
  }

  it("says what left Studio and leaves Oxen out of it", () => {
    expect(outcome("studio", [{ ok: true, count: 3, reply: { ok: true, oxenFailed: 3 } }])).toEqual({
      tone: "ok",
      text: "Removed 3 items from Studio.",
    });
    expect(outcome("studio", [{ ok: true, count: 1, reply: { ok: true } }]).text).toBe("Removed 1 item from Studio.");
  });

  it("confirms a delete that reached both places", () => {
    expect(
      outcome("everywhere", [{ ok: true, count: 3, reply: { ok: true, deleted: 3, missing: 0, oxenDeleted: 3 } }]),
    ).toEqual({ tone: "ok", text: "Deleted 3 items from Studio and Oxen." });
  });

  it("reports an Oxen copy that was already gone calmly", () => {
    const gone = outcome("everywhere", [{ ok: true, count: 1, reply: { ok: true, oxenAlreadyGone: 1 } }]);
    expect(gone).toEqual({ tone: "ok", text: "Removed 1 item from Studio. There was no Oxen copy to delete." });
    // A failed job never saved a file, so the server names no Oxen copy at all.
    expect(outcome("everywhere", [{ ok: true, count: 1, reply: { ok: true, oxenDeleted: 0 } }])).toEqual(gone);
    for (const word of ["error", "fail", "couldn", "warning"]) expect(gone.text.toLowerCase()).not.toContain(word);
  });

  it("gives all three counts for a mixed selection", () => {
    const mixed = outcome("everywhere", [
      { ok: true, count: 6, reply: { ok: true, deleted: 6, oxenDeleted: 3, oxenAlreadyGone: 2, oxenFailed: 1 } },
    ]);
    expect(mixed.tone).toBe("warn");
    expect(mixed.text).toBe(
      "Removed 6 items from Studio. Deleted 3 Oxen copies. 2 had no Oxen copy to delete. Oxen still has 1 of them. Delete it from your Oxen account.",
    );
  });

  it("says when Oxen kept every copy", () => {
    expect(outcome("everywhere", [{ ok: true, count: 1, reply: { ok: true, oxenFailed: 1 } }])).toEqual({
      tone: "warn",
      text: "Removed 1 item from Studio. Oxen still has its copy. Delete it from your Oxen account.",
    });
    expect(outcome("everywhere", [{ ok: true, count: 2, reply: { ok: true, oxenFailed: 2 } }]).text).toBe(
      "Removed 2 items from Studio. Oxen still has their copies. Delete them from your Oxen account.",
    );
  });

  it("adds up several requests and never counts more copies than items", () => {
    const tally = tallyDelete("everywhere", [
      { ok: true, count: 200, reply: { oxenDeleted: 200 } },
      { ok: true, count: 50, reply: { oxenDeleted: 90, oxenFailed: 4 } },
    ]);
    expect(tally).toMatchObject({ requested: 250, removed: 250, failed: 0, oxenDeleted: 246, oxenGone: 0, oxenFailed: 4 });
  });

  it("says which items are still in the library when a request is refused", () => {
    expect(outcome("studio", [{ ok: false, count: 1 }])).toEqual({
      tone: "warn",
      text: "Couldn’t delete that item. Nothing changed.",
    });
    expect(outcome("everywhere", [{ ok: false, count: 4 }]).text).toBe("Couldn’t delete those 4 items. Nothing changed.");
    const part = outcome("studio", [
      { ok: true, count: 200, reply: { ok: true } },
      { ok: false, count: 50 },
    ]);
    expect(part.tone).toBe("warn");
    expect(part.text).toBe("Removed 200 items from Studio. Couldn’t delete 50 of 250. They are still in the library.");
  });

  it("never says deleting from Oxen frees storage", () => {
    const texts = [
      outcome("everywhere", [{ ok: true, count: 2, reply: { oxenDeleted: 2 } }]).text,
      outcome("everywhere", [{ ok: true, count: 2, reply: { oxenAlreadyGone: 2 } }]).text,
      oxenFilesNote({ oxenDeleted: 4, oxenAlreadyGone: 1, oxenFailed: 2 }),
    ];
    for (const text of texts) {
      expect(text.toLowerCase()).not.toContain("storage");
      expect(text.toLowerCase()).not.toContain("free");
    }
  });

  it("writes the cleanup note from the same counts", () => {
    expect(oxenFilesNote({ oxenDeleted: 4, oxenAlreadyGone: 1, oxenFailed: 2 })).toBe(
      "Removed 4 Oxen files. 1 Oxen file was already gone. 2 Oxen files could not be removed.",
    );
    expect(oxenFilesNote({ oxenAlreadyGone: 3 })).toBe("3 Oxen files were already gone.");
    expect(oxenFilesNote({ ok: true })).toBe("");
  });
});
