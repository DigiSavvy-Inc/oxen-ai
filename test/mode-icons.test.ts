import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModeIcon, ModeIcons, ModelName } from "../src/components/ModeIcon";
import { ModelMenu } from "../src/components/ModelMenu";
import { ALL_MODES, MODE_LABELS, modelSupportsMode, type GenerationMode } from "../src/lib/api";
import {
  MODE_GLYPHS,
  MODE_ICON_LABELS,
  MODE_ICON_ROW_MAX,
  isGenerationMode,
  modeIconRow,
  modeIconsLabel,
  modelModes,
  runModes,
} from "../src/lib/mode-icons";

const seedreamGenerate = {
  id: "bytedance-seedream-5-pro-text-to-image",
  display_name: "Seedream 5.0 Pro",
  endpoint: "/images/generate",
  capabilities: { input: ["text"], output: ["image"] },
};
const gptImage = {
  id: "gpt-image-2-5-flare",
  display_name: "GPT Image 2.5 Flare",
  endpoint: "/images/edit",
  capabilities: { input: ["text", "image"], output: ["image"] },
};
const fluxErase = {
  id: "flux-erase",
  display_name: "FLUX Erase",
  endpoint: "/images/edit",
  capabilities: { input: ["image"], output: ["image"] },
};
const seedanceText = {
  id: "bytedance-seedance-2-5-text-to-video",
  display_name: "Seedance 2.5 - Text to Video",
  endpoint: "/videos/generate",
  capabilities: { input: ["text"], output: ["video"] },
};
const seedanceImage = {
  id: "bytedance-seedance-2-5-image-to-video",
  display_name: "Seedance 2.5 - Image to Video",
  endpoint: "/videos/generate",
  capabilities: { input: ["text", "image"], output: ["video"] },
};
const seedanceReference = {
  id: "bytedance-seedance-2-5-reference-to-video",
  display_name: "Seedance 2.5 - Reference to Video",
  endpoint: "/videos/generate",
  capabilities: { input: ["text", "image", "video", "audio"], output: ["video"] },
};
const flux3Video = {
  id: "flux-3-video",
  display_name: "FLUX 3 Video",
  endpoint: "/videos/generate",
  capabilities: { input: ["text", "image", "video"], output: ["video"] },
};
const elevenV4 = {
  id: "elevenlabs-eleven-v4",
  display_name: "Eleven v4",
  endpoint: "/audio/generate",
  capabilities: { input: ["text"], output: ["audio"] },
};
const chatModel = {
  id: "claude-fable-5-2",
  display_name: "Claude Fable 5.2",
  endpoint: "/chat/completions",
  capabilities: { input: ["text", "image"], output: ["text"] },
};
const voiceChanger = {
  id: "elevenlabs-voice-changer",
  display_name: "Eleven Voice Changer",
  endpoint: "/audio/transform",
  capabilities: { input: ["audio"], output: ["audio"] },
};

const catalog = [
  seedreamGenerate,
  gptImage,
  fluxErase,
  seedanceText,
  seedanceImage,
  seedanceReference,
  flux3Video,
  elevenV4,
  chatModel,
  voiceChanger,
];

describe("mode icons", () => {
  it("gives every mode its own drawing and a plain-word name", () => {
    const glyphs = ALL_MODES.map((mode) => MODE_GLYPHS[mode]);
    expect(new Set(glyphs).size).toBe(ALL_MODES.length);
    expect(Object.keys(MODE_GLYPHS).sort()).toEqual([...ALL_MODES].sort());
    expect(MODE_GLYPHS).toEqual({
      "text-to-image": "image",
      "image-to-image": "image-pencil",
      "text-to-video": "film",
      "reference-to-video": "image-play",
      "video-to-video": "film-pencil",
      "text-to-audio": "waveform",
      chat: "bubble",
    });
    for (const mode of ALL_MODES) {
      const label = MODE_ICON_LABELS[mode];
      expect(label).not.toContain("\u2192");
      // The spoken name starts with the pill's words, so the icon and the pill read as one thing.
      const pill = MODE_LABELS[mode].replace(" \u2192 ", " to ").toLowerCase();
      expect(label.toLowerCase().startsWith(pill)).toBe(true);
    }
    expect(MODE_ICON_LABELS["image-to-image"]).toBe("Image to image (edit)");
    expect(MODE_ICON_LABELS["reference-to-video"]).toBe("Image to video");
  });

  it("reads a model's kinds from the check that ghosts the mode pills", () => {
    for (const model of catalog) {
      expect(modelModes(model)).toEqual(ALL_MODES.filter((mode) => modelSupportsMode(model, mode)));
    }
    expect(modelModes(seedreamGenerate)).toEqual(["text-to-image"]);
    expect(modelModes(gptImage)).toEqual(["text-to-image", "image-to-image"]);
    expect(modelModes(fluxErase)).toEqual(["image-to-image"]);
    expect(modelModes(seedanceText)).toEqual(["text-to-video"]);
    expect(modelModes(seedanceImage)).toEqual(["reference-to-video"]);
    expect(modelModes(seedanceReference)).toEqual(["reference-to-video", "video-to-video"]);
    expect(modelModes(flux3Video)).toEqual(["text-to-video", "reference-to-video", "video-to-video"]);
    expect(modelModes(elevenV4)).toEqual(["text-to-audio"]);
    expect(modelModes(chatModel)).toEqual(["chat"]);
    expect(modelModes(voiceChanger)).toEqual([]);
  });

  it("keeps the row in pill order and counts what does not fit", () => {
    expect(MODE_ICON_ROW_MAX).toBe(3);
    expect(modeIconRow(["video-to-video", "text-to-image", "video-to-video"])).toEqual({
      shown: ["text-to-image", "video-to-video"],
      more: [],
    });
    expect(modeIconRow(["text-to-video", "reference-to-video", "video-to-video"]).more).toEqual([]);
    expect(modeIconRow(ALL_MODES)).toEqual({
      shown: ["text-to-image", "image-to-image", "text-to-video"],
      more: ["reference-to-video", "video-to-video", "text-to-audio", "chat"],
    });
    expect(modeIconRow([])).toEqual({ shown: [], more: [] });
    expect(modeIconsLabel(["image-to-image", "text-to-image"])).toBe("Text to image, Image to image (edit)");
  });

  it("shows a finished run as the one mode it used", () => {
    expect(runModes("reference-to-video")).toEqual(["reference-to-video"]);
    expect(runModes("text-to-hologram")).toEqual([]);
    expect(runModes(null)).toEqual([]);
    expect(runModes("toString")).toEqual([]);
    expect(isGenerationMode("chat")).toBe(true);
    expect(isGenerationMode(undefined)).toBe(false);
  });

  it("draws each icon with a tooltip and an accessible name", () => {
    const drawings = new Set<string>();
    for (const mode of ALL_MODES) {
      const html = renderToStaticMarkup(createElement(ModeIcon, { mode }));
      const label = MODE_ICON_LABELS[mode];
      expect(html).toContain('role="img"');
      expect(html).toContain(`aria-label="${label}"`);
      expect(html).toContain(`<title>${label}</title>`);
      expect(html).toContain(`data-mode="${mode}"`);
      expect(html).toContain('viewBox="0 0 16 16"');
      expect(html).toContain('stroke="currentColor"');
      drawings.add(html.slice(html.indexOf("</title>")));
    }
    expect(drawings.size).toBe(ALL_MODES.length);
  });

  it("renders a row in pill order, a count past the limit, and nothing for no modes", () => {
    const row = renderToStaticMarkup(
      createElement(ModeIcons, { modes: ["video-to-video", "reference-to-video"] as GenerationMode[] }),
    );
    expect(row.indexOf('data-mode="reference-to-video"')).toBeGreaterThan(-1);
    expect(row.indexOf('data-mode="reference-to-video"')).toBeLessThan(row.indexOf('data-mode="video-to-video"'));
    expect(row).not.toContain("mode-icons-more");

    const crowded = renderToStaticMarkup(createElement(ModeIcons, { modes: ALL_MODES }));
    expect(crowded.match(/<svg/g)).toHaveLength(MODE_ICON_ROW_MAX);
    expect(crowded).toContain("+4");
    expect(crowded).toContain('title="Image to video, Video to video, Text to audio, Chat"');

    expect(renderToStaticMarkup(createElement(ModeIcons, { modes: [] }))).toBe("");
    const unknown = renderToStaticMarkup(
      createElement(ModelName, { name: "retired-model", modes: runModes("text-to-hologram") }),
    );
    expect(unknown).toContain("retired-model");
    expect(unknown).not.toContain("<svg");
  });

  it("puts the selected model's kinds on the picker and none before a model is picked", () => {
    const menu = (value: string) =>
      renderToStaticMarkup(
        createElement(ModelMenu, { models: catalog, preferred: [], value, onChange: () => {} }),
      );
    const empty = menu("");
    expect(empty).toContain("Select a model");
    expect(empty).toContain('aria-label="Model"');
    expect(empty).not.toContain("<svg");

    const picked = menu(gptImage.id);
    expect(picked).toContain("GPT Image 2.5 Flare");
    expect(picked).toContain('aria-label="Model: GPT Image 2.5 Flare. Text to image, Image to image (edit)"');
    expect(picked.match(/<svg/g)).toHaveLength(2);
    expect(picked.indexOf('data-mode="text-to-image"')).toBeLessThan(picked.indexOf('data-mode="image-to-image"'));

    const retired = menu("retired-model");
    expect(retired).toContain("retired-model");
  });

  it("uses the icons wherever a model is picked or named", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const menu = read("../src/components/ModelMenu.tsx");
    expect(menu).toContain("<ModeIcons modes={modelModes(model)} />");
    expect(menu).toContain("<ModeIcons modes={modelModes(triggerModel)} />");

    const settings = read("../src/components/SettingsModal.tsx");
    expect(settings).toContain("<ModelMenu");
    expect(settings).toContain('emptyOption="None"');
    expect(settings).toContain("<ModeIcon mode={mode} />");
    expect(settings).toContain("defaultModelChoices(");
    expect(settings.match(/<ModeIcons modes=\{kindsOf\(item\)\} \/>/g)).toHaveLength(2);
    expect(settings).toContain("modelModes(catalogById.get(item.id) ?? item)");

    const brief = read("../src/components/ProjectBrief.tsx");
    expect(brief).toContain("<ModelMenu");
    expect(brief).toContain('label="Project model"');
    expect(brief).not.toContain('aria-label="Project model"');

    expect(read("../src/components/Sidebar.tsx")).toContain("modes={runModes(mode)}");
    expect(read("../src/components/ProjectJobs.tsx")).toContain("modes={runModes(job.mode)}");
    expect(read("../src/components/Canvas.tsx")).toContain("modes={runModes(generation.mode)}");

    const css = read("../src/index.css");
    expect(css).toMatch(/\.mode-icons\s*\{[^}]*color:\s*var\(--text-muted\)/);
    expect(css).toMatch(/\.mode-icon\s*\{[^}]*width:\s*15px/);
  });
});
