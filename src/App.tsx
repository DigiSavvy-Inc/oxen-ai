import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth/AuthContext";
import { Canvas } from "./components/Canvas";
import { Composer } from "./components/Composer";
import { LoginPage } from "./components/LoginPage";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import {
  api,
  modeNeedsImage,
  modeNeedsVideo,
  type Generation,
  type GenerationMode,
  type OxenModel,
} from "./lib/api";

export default function App() {
  const { user, loading, logout } = useAuth();
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<GenerationMode>("text-to-image");
  const [models, setModels] = useState<OxenModel[]>([]);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [duration, setDuration] = useState(5);
  const [seed, setSeed] = useState("");
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);

  const selected = useMemo(
    () => generations.find((g) => g.id === selectedId) ?? null,
    [generations, selectedId],
  );

  const refreshHistory = useCallback(async () => {
    const data = await api.listGenerations();
    setGenerations(data.generations);
    setSelectedId((prev) => prev ?? data.generations[0]?.id ?? null);
  }, []);

  useEffect(() => {
    if (!user) return;
    void refreshHistory().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load history"),
    );
  }, [user, refreshHistory]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.models(mode);
        if (cancelled) return;
        setModels(data.models);
        setModel((prev) =>
          data.models.some((m) => m.id === prev)
            ? prev
            : data.models[0]?.id || "",
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load models");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, mode]);

  useEffect(() => {
    if (modeNeedsImage(mode) === false) {
      // keep image for video-to-video optional refs
      if (mode !== "video-to-video") {
        setImageFile(null);
        setImagePreview(null);
      }
    }
    if (!modeNeedsVideo(mode)) {
      setVideoFile(null);
      setVideoPreview(null);
    }
    if (mode.startsWith("text-to-video") || mode.includes("video")) {
      setAspectRatio((r) => (["16:9", "9:16", "1:1"].includes(r) ? r : "16:9"));
    } else {
      setAspectRatio((r) => (r ? r : "1:1"));
    }
  }, [mode]);

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

  function onPickImage(file: File | null) {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  }

  function onPickVideo(file: File | null) {
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoFile(file);
    setVideoPreview(file ? URL.createObjectURL(file) : null);
  }

  const canGenerate = Boolean(
    user?.hasOxenKey &&
      prompt.trim() &&
      model &&
      (!modeNeedsImage(mode) || imageFile) &&
      (!modeNeedsVideo(mode) || videoFile),
  );

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
      let inputImage: string | undefined;
      let inputVideo: string | undefined;

      if (imageFile && (modeNeedsImage(mode) || mode === "video-to-video")) {
        const uploaded = await api.upload(imageFile);
        inputImage = uploaded.url;
      }
      if (videoFile && modeNeedsVideo(mode)) {
        const uploaded = await api.upload(videoFile);
        inputVideo = uploaded.url;
      }

      const payload: Record<string, unknown> = {
        mode,
        model,
        prompt: prompt.trim(),
        aspect_ratio: aspectRatio,
      };
      if (mode.includes("video")) payload.duration = duration;
      if (seed.trim()) payload.seed = Number(seed);
      if (inputImage) payload.input_image = inputImage;
      if (inputVideo) payload.input_video = inputVideo;

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
          model={model}
          onModelChange={setModel}
          prompt={prompt}
          onPromptChange={setPrompt}
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          duration={duration}
          onDurationChange={setDuration}
          seed={seed}
          onSeedChange={setSeed}
          imageName={imageFile?.name ?? null}
          videoName={videoFile?.name ?? null}
          imagePreview={imagePreview}
          videoPreview={videoPreview}
          onPickImage={onPickImage}
          onPickVideo={onPickVideo}
          onClearImage={() => onPickImage(null)}
          onClearVideo={() => onPickVideo(null)}
          busy={busy}
          error={error}
          onGenerate={() => void onGenerate()}
          canGenerate={canGenerate}
        />
      </main>
      {showSettings ? <SettingsModal onClose={() => setShowSettings(false)} /> : null}
    </div>
  );
}
