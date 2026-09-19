import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth/AuthContext";
import { Canvas } from "./components/Canvas";
import { Composer } from "./components/Composer";
import { LoginPage } from "./components/LoginPage";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import {
  api,
  slotMax,
  slotRequired,
  type Generation,
  type GenerationMode,
  type ModelControls,
  type OxenModel,
  type StudioSettings,
} from "./lib/api";

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

  const selected = useMemo(
    () => generations.find((g) => g.id === selectedId) ?? null,
    [generations, selectedId],
  );

  const favoriteIds = useMemo(
    () => new Set(favorites.map((item) => item.id)),
    [favorites],
  );

  const refreshHistory = useCallback(async () => {
    const data = await api.listGenerations();
    setGenerations(data.generations);
    setSelectedId((prev) => prev ?? data.generations[0]?.id ?? null);
  }, []);

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
    void refreshHistory().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load history"),
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
  }, [user, refreshHistory, refreshFavorites]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.models(mode);
        if (cancelled) return;
        setModels(data.models);
        setModel((prev) => pickModel(data.models, favorites, settings, mode, prev));
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
    const active = generations.filter(
      (g) => !["succeeded", "failed", "cancelled"].includes(g.status),
    );
    if (active.length === 0) return;

    const timer = window.setInterval(() => {
      void (async () => {
        for (const g of active) {
          try {
            const { generation } = await api.getGeneration(g.id);
            setGenerations((prev) =>
              prev.map((row) => (row.id === generation.id ? generation : row)),
            );
          } catch {
            // ignore transient poll errors
          }
        }
      })();
    }, 4000);

    return () => window.clearInterval(timer);
  }, [generations]);

  function onPickFiles(kind: "image" | "video" | "audio", files: FileList | null) {
    if (!files || files.length === 0) return;
    const max = Math.max(
      slotMax(controls, kind),
      kind === "image" && (mode === "image-to-image" || mode === "reference-to-video") ? 1 : 0,
      kind === "video" && mode === "video-to-video" ? 1 : 0,
    );
      const incoming = Array.from(files);
      const cap = Math.max(max, 1);
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

  const imageCount = staged.filter((item) => item.kind === "image").length;
  const videoCount = staged.filter((item) => item.kind === "video").length;

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
      setGenerations((prev) => [...created, ...prev]);
      setSelectedId(created[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="loading-screen">Loading Oxen Studio…</div>;
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        generations={generations}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onOpenSettings={() => setShowSettings(true)}
        onLogout={() => void logout()}
        userLogin={user.login}
        avatarUrl={user.avatarUrl}
        isAdmin={user.isAdmin}
        hasOxenKey={user.hasOxenKey}
      />
      <main className="main">
        <Canvas generation={selected} />
        <Composer
          mode={mode}
          onModeChange={setMode}
          models={models}
          preferred={favorites}
          model={model}
          onModelChange={setModel}
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
          onPickFiles={onPickFiles}
          onClearAttachment={onClearAttachment}
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
