import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth/AuthContext";
import { AccountMenu } from "./components/AccountMenu";
import { Canvas } from "./components/Canvas";
import { Composer } from "./components/Composer";
import { CreditMeter } from "./components/CreditMeter";
import { LibraryPeek } from "./components/LibraryPeek";
import { LoginPage } from "./components/LoginPage";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import {
  api,
  firstSupportedMode,
  mentionToken,
  modelSupportsMode,
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
import { completedMedia, downloadAllMedia, downloadFilename, downloadMedia } from "./lib/download";
import { filesFromList, kindFromFile } from "./lib/files";
import { libraryRefFromGeneration, mergeLibraryRefs, releasePreview } from "./lib/library-refs";
import { moveItem } from "./lib/mentions";
import { generationCountForModelChange, pickModel } from "./lib/model-menu";

type StagedMedia = {
  file?: File;
  preview: string;
  kind: "image" | "video" | "audio";
  name: string;
  url?: string;
  generationId?: string;
};

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
  const [mode, setMode] = useState<GenerationMode | null>(null);
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
  const [staged, setStaged] = useState<StagedMedia[]>([]);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [keepCanvasClear, setKeepCanvasClear] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(initialLibraryOpen);
  const [peekId, setPeekId] = useState<string | null>(null);
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

  const peek = useMemo(
    () => generations.find((g) => g.id === peekId) ?? null,
    [generations, peekId],
  );

  const peekVariants = useMemo(() => {
    if (!peek) return [];
    const batches = groupGenerationBatches(generations);
    const batch = batches.find((entry) => entry.items.some((item) => item.id === peek.id));
    return batch?.items ?? [peek];
  }, [generations, peek]);

  const attachedIds = useMemo(
    () => new Set(staged.map((item) => item.generationId).filter((id): id is string => Boolean(id))),
    [staged],
  );

  const closeLibrary = useCallback(() => {
    setLibraryOpen(false);
    if (window.matchMedia("(max-width: 860px)").matches) setPeekId(null);
  }, []);

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
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (peekId) {
        event.preventDefault();
        setPeekId(null);
        return;
      }
      if (libraryOpen) {
        event.preventDefault();
        closeLibrary();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peekId, libraryOpen, closeLibrary]);

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
          const next = pickModel(
            data.models,
            favorites,
            mode ? settings?.defaultModelByMode[mode] : undefined,
            prev,
            Boolean(mode),
          );
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
          if (!next.includes(item)) releasePreview(item.preview);
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

  function capForKind(kind: "image" | "video" | "audio") {
    return Math.max(
      slotMax(controls, kind),
      kind === "image" && (mode === "image-to-image" || mode === "reference-to-video") ? 1 : 0,
      kind === "video" && mode === "video-to-video" ? 1 : 0,
      1,
    );
  }

  function appendMentionTokens(kind: "image" | "video" | "audio", existingCount: number, addedCount: number) {
    const mentionsOn = Boolean(controls?.mentions || controls?.slots.some((slot) => slot.kind === kind));
    if (!mentionsOn || addedCount <= 0) return;
    setPrompt((current) => {
      let next = current;
      for (let offset = 0; offset < addedCount; offset += 1) {
        const token = mentionToken(kind, existingCount + offset);
        if (!next.includes(token)) next = next.trim() ? `${next.trim()} ${token}` : token;
      }
      return next;
    });
  }

  function addFilesOfKind(kind: "image" | "video" | "audio", incoming: File[]) {
    if (incoming.length === 0) return;
    const cap = capForKind(kind);
    const existingCount = staged.filter((item) => item.kind === kind).length;
    setStaged((prev) => {
      const others = prev.filter((item) => item.kind !== kind);
      const existing = prev.filter((item) => item.kind === kind);
      const added = incoming.map((file) => ({
        file,
        kind,
        name: file.name,
        preview: kind === "audio" ? "" : URL.createObjectURL(file),
      }));
      const merged = [...existing, ...added].slice(0, cap);
      for (const item of existing) {
        if (!merged.includes(item)) releasePreview(item.preview);
      }
      return [...others, ...merged];
    });
    appendMentionTokens(kind, existingCount, Math.min(incoming.length, Math.max(0, cap - existingCount)));
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

  function addLibraryItem(generation: Generation) {
    const ref = libraryRefFromGeneration(generation);
    if (!ref) return;
    const existingCount = staged.filter((item) => item.kind === ref.kind).length;
    let added = 0;
    setStaged((prev) => {
      const next = mergeLibraryRefs(
        prev,
        [
          {
            kind: ref.kind,
            name: ref.name,
            preview: ref.preview,
            url: ref.url,
            generationId: ref.generationId,
          },
        ],
        capForKind,
      );
      added = next.length - prev.length;
      return next;
    });
    appendMentionTokens(ref.kind, existingCount, added);
  }

  function startNew() {
    setStaged((prev) => {
      for (const item of prev) releasePreview(item.preview);
      return [];
    });
    setKeepCanvasClear(true);
    setSelectedId(null);
    setPeekId(null);
    setError(null);
    setNumGenerations(1);
  }

  function onClearAttachment(kind: "image" | "video" | "audio", index: number) {
    setStaged((prev) => {
      const ofKind = prev.filter((item) => item.kind === kind);
      const target = ofKind[index];
      if (target?.preview) releasePreview(target.preview);
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
    setStaged(next);
  }

  const imageCount = staged.filter((item) => item.kind === "image").length;
  const videoCount = staged.filter((item) => item.kind === "video").length;
  const readyMedia = useMemo(() => completedMedia(generations), [generations]);

  const canGenerate = Boolean(
    user?.hasOxenKey &&
      prompt.trim() &&
      mode &&
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

  function handleModeChange(next: GenerationMode) {
    setMode(next);
    const selected = models.find((item) => item.id === model);
    if (selected && !modelSupportsMode(selected, next)) {
      setModel("");
    }
  }

  function handleModelChange(next: string) {
    setNumGenerations((count) => generationCountForModelChange(model, next, count));
    setModel(next);
    const selected = models.find((item) => item.id === next);
    if (!selected) return;
    if (mode && modelSupportsMode(selected, mode)) return;
    const inferred = firstSupportedMode(selected, mode ?? "text-to-image");
    if (inferred) setMode(inferred);
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
    setPeekId((prev) => (prev && removing.has(prev) ? null : prev));
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
    if (!canGenerate || !mode) {
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
        const url = item.url ?? (item.file ? (await api.upload(item.file)).url : "");
        if (!url) continue;
        if (item.kind === "image") images.push(url);
        else if (item.kind === "video") videos.push(url);
        else audios.push(url);
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
      setPeekId(null);
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
    <div className={`app-shell${libraryOpen ? " library-open" : ""}${peek ? " has-peek" : ""}`}>
      <Sidebar
        generations={generations}
        selectedId={peekId}
        loading={libraryLoading}
        downloadingAll={downloadingAll}
        onSelect={setPeekId}
        onClose={closeLibrary}
        onDownloadAll={() => void onDownloadAll()}
        onDelete={(ids) => void onDeleteGenerations(ids)}
      />
      {libraryOpen ? (
        <button
          type="button"
          className="library-backdrop"
          aria-label="Close library"
          onClick={closeLibrary}
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
              onClick={() => {
                if (libraryOpen) closeLibrary();
                else setLibraryOpen(true);
              }}
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
        <div className={`workspace${peek ? " has-peek" : ""}`}>
          <Canvas
            generation={selected}
            variants={selectedVariants}
            onSelect={setSelectedId}
            onTagsChange={(id, tags) => void onSaveTags(id, tags)}
          />
          {peek ? (
            <LibraryPeek
              generation={peek}
              variants={peekVariants}
              attachedIds={attachedIds}
              onClose={() => setPeekId(null)}
              onAttach={addLibraryItem}
              onSelectVariant={setPeekId}
              onDownload={() => {
                if (!peek.resultUrl) return;
                void downloadMedia(peek.resultUrl, downloadFilename(peek));
              }}
              onRemove={() => {
                void onDeleteGenerations(peekVariants.map((item) => item.id));
              }}
            />
          ) : null}
        </div>
        <Composer
          mode={mode}
          onModeChange={handleModeChange}
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
            name: item.name,
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
