import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth/AuthContext";
import { AccountMenu } from "./components/AccountMenu";
import { Canvas } from "./components/Canvas";
import { Composer } from "./components/Composer";
import { CreditMeter } from "./components/CreditMeter";
import { LoginPage } from "./components/LoginPage";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import {
  api,
  mentionToken,
  slotMax,
  slotRequired,
  type CreditBalance,
  type Generation,
  type GenerationMode,
  type ModelControls,
  type OxenModel,
  type StudioSettings,
} from "./lib/api";
import { groupGenerationBatches, isActiveGeneration, mergeGenerations } from "./lib/batches";
import { completedMedia, downloadAllMedia } from "./lib/download";
import { filesFromList, kindFromFile } from "./lib/files";
import { moveItem, remapMentionTokens } from "./lib/mentions";
import { generationCountForModelChange } from "./lib/model-menu";

type StagedFile = {
  file: File;
  preview: string;
  kind: "image" | "video" | "audio";
};

function pickModel(
  models: OxenModel[],
  favorites: OxenModel[],
  settings: StudioSettings | null,
  mode: GenerationMode,
  previous: string,
): string {
  const ids = new Set(models.map((model) => model.id));
  const preferred = settings?.defaultModelByMode[mode];
  if (preferred && ids.has(preferred)) return preferred;
  if (previous && ids.has(previous)) return previous;
  const favoriteInMode = favorites.find((model) => ids.has(model.id));
  if (favoriteInMode) return favoriteInMode.id;
  return previous && ids.has(previous) ? previous : "";
}

function initialLibraryOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("ds-studio-library-open") === "1";
  } catch {
    return false;
  }
}

export default function App() {
  const { user, loading, logout } = useAuth();
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<GenerationMode>("text-to-image");
  const [models, setModels] = useState<OxenModel[]>([]);
  const [favorites, setFavorites] = useState<OxenModel[]>([]);
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [model, setModel] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [controls, setControls] = useState<ModelControls | null>(null);
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [duration, setDuration] = useState("5");
  const [seed, setSeed] = useState("");
  const [numGenerations, setNumGenerations] = useState(1);
  const [generateAudio, setGenerateAudio] = useState(false);
  const [quality, setQuality] = useState("");
  const [resolution, setResolution] = useState("");
  const [outputFormat, setOutputFormat] = useState("");
  const [background, setBackground] = useState("");
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [keepCanvasClear, setKeepCanvasClear] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(initialLibraryOpen);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const selected = useMemo(
    () => generations.find((g) => g.id === selectedId) ?? null,
    [generations, selectedId],
  );

  const selectedVariants = useMemo(() => {
    if (!selected) return [];
    const batches = groupGenerationBatches(generations);
    const batch = batches.find((entry) => entry.items.some((item) => item.id === selected.id));
    return batch?.items ?? [selected];
  }, [generations, selected]);

  const favoriteIds = useMemo(
    () => new Set(favorites.map((item) => item.id)),
    [favorites],
  );

  const refreshActive = useCallback(async () => {
    const data = await api.listGenerations("active");
    setGenerations((prev) => mergeGenerations(prev, data.generations));
    setSelectedId((prev) => {
      if (keepCanvasClear) return null;
      if (prev) return prev;
      return data.generations[0]?.id ?? null;
    });
  }, [keepCanvasClear]);

  const refreshLibrary = useCallback(async () => {
    const data = await api.listGenerations("library");
    setGenerations((prev) => mergeGenerations(prev, data.generations));
  }, []);

  const refreshCredits = useCallback(async () => {
    if (!user?.hasOxenKey) {
      setCredits(null);
      return;
    }
    try {
      setCredits(await api.credits());
    } catch {
      setCredits(null);
    }
  }, [user?.hasOxenKey]);

  const refreshFavorites = useCallback(async () => {
    if (!user?.hasOxenKey) {
      setFavorites([]);
      return;
    }
    try {
      const data = await api.favorites();
      setFavorites(data.models);
    } catch {
      setFavorites([]);
    }
  }, [user?.hasOxenKey]);

  useEffect(() => {
    if (!user) return;
    void refreshActive().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to resume jobs"),
    );
    void api
      .studioSettings()
      .then((data) => {
        setSettings(data);
        if (data.lastParams.aspect_ratio) setAspectRatio(data.lastParams.aspect_ratio);
        if (data.lastParams.duration != null) setDuration(String(data.lastParams.duration));
        if (data.lastParams.num_generations) setNumGenerations(data.lastParams.num_generations);
        if (typeof data.lastParams.generate_audio === "boolean") {
          setGenerateAudio(data.lastParams.generate_audio);
        }
        if (data.lastParams.quality) setQuality(data.lastParams.quality);
        if (data.lastParams.resolution) setResolution(data.lastParams.resolution);
        if (data.lastParams.output_format) setOutputFormat(data.lastParams.output_format);
        if (data.lastParams.background) setBackground(data.lastParams.background);
        if (typeof data.lastParams.seed === "number") setSeed(String(data.lastParams.seed));
      })
      .catch(() => {
        setSettings({ defaultModelByMode: {}, lastParams: {} });
      });
    void refreshFavorites();
    void refreshCredits();
  }, [user, refreshActive, refreshFavorites, refreshCredits]);

  useEffect(() => {
    if (!user?.hasOxenKey) return;
    const timer = window.setInterval(() => {
      void refreshCredits();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [user?.hasOxenKey, refreshCredits]);

  useEffect(() => {
    try {
      window.localStorage.setItem("ds-studio-library-open", libraryOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [libraryOpen]);

  useEffect(() => {
    if (!libraryOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setLibraryOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [libraryOpen]);

  useEffect(() => {
    if (!user || !libraryOpen) return;
    let cancelled = false;
    setLibraryLoading(true);
    void refreshLibrary()
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load library");
        }
      })
      .finally(() => {
        if (!cancelled) setLibraryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, libraryOpen, refreshLibrary]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.models(mode);
        if (cancelled) return;
        setModels(data.models);
        setModel((prev) => {
          const next = pickModel(data.models, favorites, settings, mode, prev);
          setNumGenerations((count) => generationCountForModelChange(prev, next, count));
          return next;
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load models");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, mode, favorites, settings]);

  useEffect(() => {
    if (!modelQuery.trim() || !user?.hasOxenKey) return;
    const handle = window.setTimeout(() => {
      void api
        .searchModels(mode, modelQuery.trim())
        .then((data) => {
          setModels((prev) => {
            const byId = new Map(prev.map((item) => [item.id, item]));
            for (const item of data.models) byId.set(item.id, item);
            return [...byId.values()];
          });
        })
        .catch(() => {
          /* keep current list */
        });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [modelQuery, mode, user?.hasOxenKey]);

  useEffect(() => {
    if (!user?.hasOxenKey || !model) {
      setControls(null);
      return;
    }
    let cancelled = false;
    void api
      .modelDetail(model)
      .then((data) => {
        if (cancelled) return;
        setControls(data.controls);
        if (data.controls.aspectRatios && data.controls.aspectRatios.length > 0) {
          setAspectRatio((prev) =>
            data.controls.aspectRatios?.includes(prev)
              ? prev
              : data.controls.aspectRatios?.[0] || prev,
          );
        }
        if (data.controls.duration?.kind === "enum") {
          setDuration((prev) =>
            data.controls.duration?.kind === "enum" && data.controls.duration.values.includes(prev)
              ? prev
              : (data.controls.duration?.kind === "enum"
                  ? (data.controls.duration.defaultValue ?? data.controls.duration.values[0] ?? prev)
                  : prev),
          );
        } else if (data.controls.duration?.kind === "int") {
          setDuration((prev) => {
            const numeric = Number(prev);
            if (!Number.isFinite(numeric) || data.controls.duration?.kind !== "int") {
              return String(data.controls.duration?.kind === "int"
                ? (data.controls.duration.defaultValue ?? data.controls.duration.min)
                : prev);
            }
            const clamped = Math.min(
              data.controls.duration.max,
              Math.max(data.controls.duration.min, numeric),
            );
            return String(clamped);
          });
        }
        if (data.controls.quality) {
          setQuality((prev) =>
            data.controls.quality?.includes(prev) ? prev : data.controls.quality?.[0] || "",
          );
        } else {
          setQuality("");
        }
        if (data.controls.resolution) {
          setResolution((prev) =>
            data.controls.resolution?.includes(prev) ? prev : data.controls.resolution?.[0] || "",
          );
        } else {
          setResolution("");
        }
        if (data.controls.outputFormat) {
          setOutputFormat((prev) =>
            data.controls.outputFormat?.includes(prev)
              ? prev
              : data.controls.outputFormat?.[0] || "",
          );
        } else {
          setOutputFormat("");
        }
        if (data.controls.background) {
          setBackground((prev) =>
            data.controls.background?.includes(prev) ? prev : data.controls.background?.[0] || "",
          );
        } else {
          setBackground("");
        }
      })
      .catch(() => {
        if (!cancelled) setControls(null);
      });
    return () => {
      cancelled = true;
    };
  }, [model, user?.hasOxenKey]);

  useEffect(() => {
    const imageMax = slotMax(controls, "image");
    const videoMax = slotMax(controls, "video");
    const audioMax = slotMax(controls, "audio");
    setStaged((prev) => {
      const next = prev.filter((item) => {
        if (item.kind === "image") return imageMax > 0 || mode === "image-to-image" || mode === "reference-to-video" || mode === "video-to-video";
        if (item.kind === "video") return videoMax > 0 || mode === "video-to-video";
        return audioMax > 0;
      });
      if (next.length !== prev.length) {
        for (const item of prev) {
          if (!next.includes(item)) URL.revokeObjectURL(item.preview);
        }
      }
      return next;
    });
  }, [mode, controls]);

  useEffect(() => {
    const active = generations.filter(isActiveGeneration);
    if (active.length === 0) return;

    const timer = window.setInterval(() => {
      void (async () => {
        for (const g of active) {
          try {
            const { generation } = await api.getGeneration(g.id);
            setGenerations((prev) => mergeGenerations(prev, [generation]));
            if (generation.status === "succeeded" || generation.status === "failed") {
              void refreshCredits();
            }
          } catch {
            // ignore transient poll errors
          }
        }
      })();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [generations, refreshCredits]);

  function addFilesOfKind(kind: "image" | "video" | "audio", incoming: File[]) {
    if (incoming.length === 0) return;
    const max = Math.max(
      slotMax(controls, kind),
      kind === "image" && (mode === "image-to-image" || mode === "reference-to-video") ? 1 : 0,
      kind === "video" && mode === "video-to-video" ? 1 : 0,
    );
    const cap = Math.max(max, 1);
    const existingCount = staged.filter((item) => item.kind === kind).length;
    setStaged((prev) => {
      const others = prev.filter((item) => item.kind !== kind);
      const existing = prev.filter((item) => item.kind === kind);
      const added = incoming.map((file) => ({
        file,
        kind,
        preview: kind === "audio" ? "" : URL.createObjectURL(file),
      }));
      const merged = [...existing, ...added].slice(0, cap);
      for (const item of existing) {
        if (!merged.includes(item) && item.preview) URL.revokeObjectURL(item.preview);
      }
      return [...others, ...merged];
    });
    const mentionsOn = Boolean(controls?.mentions || controls?.slots.some((slot) => slot.kind === kind));
    if (mentionsOn) {
      setPrompt((current) => {
        let next = current;
        const addedCount = Math.min(incoming.length, Math.max(0, cap - existingCount));
        for (let offset = 0; offset < addedCount; offset += 1) {
          const token = mentionToken(kind, existingCount + offset);
          if (!next.includes(token)) next = next.trim() ? `${next.trim()} ${token}` : token;
        }
        return next;
      });
    }
  }

  function onAddFiles(list: FileList | File[] | null) {
    const incoming = filesFromList(list);
    if (incoming.length === 0) return;
    const images = incoming.filter((file) => kindFromFile(file) === "image");
    const videos = incoming.filter((file) => kindFromFile(file) === "video");
    const audios = incoming.filter((file) => kindFromFile(file) === "audio");
    addFilesOfKind("image", images);
    addFilesOfKind("video", videos);
    addFilesOfKind("audio", audios);
  }

  function startNew() {
    setStaged((prev) => {
      for (const item of prev) {
        if (item.preview) URL.revokeObjectURL(item.preview);
      }
      return [];
    });
    setKeepCanvasClear(true);
    setSelectedId(null);
    setError(null);
  }

  function onClearAttachment(kind: "image" | "video" | "audio", index: number) {
    setStaged((prev) => {
      const ofKind = prev.filter((item) => item.kind === kind);
      const target = ofKind[index];
      if (target?.preview) URL.revokeObjectURL(target.preview);
      let seen = 0;
      return prev.filter((item) => {
        if (item.kind !== kind) return true;
        const current = seen;
        seen += 1;
        return current !== index;
      });
    });
  }

  function onReorderAttachments(from: number, to: number) {
    const next = moveItem(staged, from, to);
    if (next === staged) return;
    setPrompt(remapMentionTokens(prompt, staged, next));
    setStaged(next);
  }

  const imageCount = staged.filter((item) => item.kind === "image").length;
  const videoCount = staged.filter((item) => item.kind === "video").length;
  const readyMedia = useMemo(() => completedMedia(generations), [generations]);

  const canGenerate = Boolean(
    user?.hasOxenKey &&
      prompt.trim() &&
      model &&
      (!slotRequired(controls, "image", mode) || imageCount > 0) &&
      (!slotRequired(controls, "video", mode) || videoCount > 0),
  );

  async function onToggleFavorite() {
    if (!model) return;
    try {
      if (favoriteIds.has(model)) await api.unfavorite(model);
      else await api.favorite(model);
      await refreshFavorites();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update favorite");
    }
  }

  function handleModelChange(next: string) {
    setNumGenerations((count) => generationCountForModelChange(model, next, count));
    setModel(next);
  }

  async function onDownloadAll() {
    if (readyMedia.length === 0 || downloadingAll) return;
    setDownloadingAll(true);
    setError(null);
    try {
      await downloadAllMedia(readyMedia);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download media");
    } finally {
      setDownloadingAll(false);
    }
  }

  async function onDeleteGenerations(ids: string[]) {
    if (ids.length === 0) return;
    const removing = new Set(ids);
    setGenerations((prev) => prev.filter((row) => !removing.has(row.id)));
    setSelectedId((prev) => (prev && removing.has(prev) ? null : prev));
    setError(null);
    try {
      await Promise.all(ids.map((id) => api.cancelGeneration(id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove media");
      if (libraryOpen) void refreshLibrary();
    }
  }

  async function onSaveTags(id: string, tags: string[]) {
    setGenerations((prev) =>
      prev.map((row) => (row.id === id ? { ...row, tags } : row)),
    );
    try {
      const { generation } = await api.updateGenerationTags(id, tags);
      setGenerations((prev) =>
        prev.map((row) => (row.id === generation.id ? generation : row)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save tags");
      try {
        const { generation } = await api.getGeneration(id);
        setGenerations((prev) => mergeGenerations(prev, [generation]));
      } catch {
        /* keep optimistic tags until the next library refresh */
      }
    }
  }

  async function onGenerate() {
    if (!canGenerate) {
      if (!user?.hasOxenKey) {
        setShowSettings(true);
        setError("Add your Oxen API key in Settings first.");
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const images: string[] = [];
      const videos: string[] = [];
      const audios: string[] = [];
      for (const item of staged) {
        const uploaded = await api.upload(item.file);
        if (item.kind === "image") images.push(uploaded.url);
        else if (item.kind === "video") videos.push(uploaded.url);
        else audios.push(uploaded.url);
      }

      const payload: Record<string, unknown> = {
        mode,
        model,
        prompt: prompt.trim(),
        aspect_ratio: aspectRatio,
        num_generations: numGenerations,
      };
      if (duration.trim()) {
        payload.duration =
          controls?.duration?.kind === "enum" || Number.isNaN(Number(duration))
            ? duration
            : Number(duration);
      }
      if (seed.trim()) payload.seed = Number(seed);
      if (controls?.generateAudio) payload.generate_audio = generateAudio;
      if (quality) payload.quality = quality;
      if (resolution) payload.resolution = resolution;
      if (outputFormat) payload.output_format = outputFormat;
      if (background) payload.background = background;
      if (images.length) payload.images = images;
      if (videos.length) payload.videos = videos;
      if (audios.length) payload.audios = audios;

      const { generations: created } = await api.generate(payload);
      setKeepCanvasClear(false);
      setGenerations((prev) => mergeGenerations(prev, created));
      setSelectedId(created[0]?.id ?? null);
      void refreshCredits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="loading-screen">Loading DS Studio…</div>;
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className={`app-shell${libraryOpen ? " library-open" : ""}`}>
      <Sidebar
        generations={generations}
        selectedId={selectedId}
        loading={libraryLoading}
        downloadingAll={downloadingAll}
        onSelect={(id) => {
          setKeepCanvasClear(false);
          setSelectedId(id);
          if (window.matchMedia("(max-width: 860px)").matches) setLibraryOpen(false);
        }}
        onClose={() => setLibraryOpen(false)}
        onDownloadAll={() => void onDownloadAll()}
        onDelete={(ids) => void onDeleteGenerations(ids)}
      />
      {libraryOpen ? (
        <button
          type="button"
          className="library-backdrop"
          aria-label="Close library"
          onClick={() => setLibraryOpen(false)}
        />
      ) : null}
      <main className="main">
        <div className="main-top">
          <div className="main-top-left">
            <button
              type="button"
              className={`ghost-btn${libraryOpen ? " active" : ""}`}
              aria-expanded={libraryOpen}
              aria-controls="media-library"
              onClick={() => setLibraryOpen((open) => !open)}
            >
              Library
            </button>
            <button type="button" className="ghost-btn" onClick={startNew}>
              New
            </button>
          </div>
          <div className="main-top-right">
            <CreditMeter credits={credits} />
            <AccountMenu
              userLogin={user.login}
              avatarUrl={user.avatarUrl}
              isAdmin={user.isAdmin}
              hasOxenKey={user.hasOxenKey}
              onOpenSettings={() => setShowSettings(true)}
              onLogout={() => void logout()}
            />
          </div>
        </div>
        <Canvas
          generation={selected}
          variants={selectedVariants}
          onSelect={setSelectedId}
          onTagsChange={(id, tags) => void onSaveTags(id, tags)}
        />
        <Composer
          mode={mode}
          onModeChange={setMode}
          models={models}
          preferred={favorites}
          model={model}
          onModelChange={handleModelChange}
          modelQuery={modelQuery}
          onModelQueryChange={setModelQuery}
          isFavorite={favoriteIds.has(model)}
          onToggleFavorite={() => void onToggleFavorite()}
          controls={controls}
          prompt={prompt}
          onPromptChange={setPrompt}
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          duration={duration}
          onDurationChange={setDuration}
          seed={seed}
          onSeedChange={setSeed}
          numGenerations={numGenerations}
          onNumGenerationsChange={setNumGenerations}
          generateAudio={generateAudio}
          onGenerateAudioChange={setGenerateAudio}
          quality={quality}
          onQualityChange={setQuality}
          resolution={resolution}
          onResolutionChange={setResolution}
          outputFormat={outputFormat}
          onOutputFormatChange={setOutputFormat}
          background={background}
          onBackgroundChange={setBackground}
          attachments={staged.map((item) => ({
            name: item.file.name,
            preview: item.preview,
            kind: item.kind,
          }))}
          onAddFiles={onAddFiles}
          onClearAttachment={onClearAttachment}
          onReorderAttachments={onReorderAttachments}
          busy={busy}
          error={error}
          onGenerate={() => void onGenerate()}
          canGenerate={canGenerate}
        />
      </main>
      {showSettings ? (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          favorites={favorites}
          settings={settings}
          onSettingsChange={setSettings}
          onFavoritesChange={refreshFavorites}
        />
      ) : null}
    </div>
  );
}
