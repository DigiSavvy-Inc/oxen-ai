import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./auth/AuthContext";
import { AccountMenu } from "./components/AccountMenu";
import { Canvas } from "./components/Canvas";
import { Composer, type PromptField } from "./components/Composer";
import type { GalleryDraftItem } from "./components/GalleryDrawer";
import { CreditMeter } from "./components/CreditMeter";
import { LibraryPeek } from "./components/LibraryPeek";
import { LoginPage } from "./components/LoginPage";
import { Loader } from "./components/Loader";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import {
  api,
  firstSupportedMode,
  mentionToken,
  modeIsVideo,
  modelSupportsMode,
  slotRequired,
  type CreditBalance,
  type Generation,
  type GenerationMode,
  type ModelControls,
  type OxenModel,
  type GallerySummary,
  type SavedPrompt,
  type StudioSettings,
} from "./lib/api";
import { groupGenerationBatches, isActiveGeneration, mergeGenerations, siblingAfterRemoval } from "./lib/batches";
import { brandMarkClass, useInstanceBranding } from "./lib/branding";
import { notifyGenerationLocal } from "./lib/pwa";
import { completedMedia, downloadAllMedia, downloadFilename, downloadMedia } from "./lib/download";
import { filesFromList, partitionMediaFiles } from "./lib/files";
import {
  acceptedMediaKinds,
  attachKindCap,
  fileAcceptValue,
  kindFromMediaType,
  libraryRefFromGeneration,
  mediaKindPhrase,
  mergeLibraryRefs,
  releasePreview,
  supportedMediaNotice,
} from "./lib/library-refs";
import { planGalleryAttach } from "./lib/gallery-attach";
import { historyItemsForGallery, toggleHistoryInGallery } from "./lib/gallery-history";
import { insertAttachMentions, moveItem } from "./lib/mentions";
import { generationCountForModelChange, pickModel } from "./lib/model-menu";
import { captureVideoLastFrame } from "./lib/last-frame";
import { preferredAspectRatio, showGetLastFrame, takeStagedOfKind } from "./lib/params";
import {
  durationFieldValue,
  durationToSend,
  nearestDurationValue,
  safetyToleranceSelection,
} from "../worker/schema";

type StagedMedia = {
  file?: File;
  preview: string;
  kind: "image" | "video" | "audio";
  name: string;
  url?: string;
  key?: string;
  generationId?: string;
  role?: "character" | "scene";
};

const GALLERY_ITEM_CAP = 24;
const LIBRARY_LOAD_TIMEOUT_MS = 20_000;

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
  const { branding, setBranding } = useInstanceBranding();
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
  const [draft, setDraft] = useState(false);
  const [safetyTolerance, setSafetyTolerance] = useState("");
  const [getLastFrame, setGetLastFrame] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [gallerySummaries, setGallerySummaries] = useState<GallerySummary[]>([]);
  const [galleryId, setGalleryId] = useState<string | null>(null);
  const [galleryName, setGalleryName] = useState("");
  const [galleryItems, setGalleryItems] = useState<GalleryDraftItem[]>([]);
  const [gallerySaving, setGallerySaving] = useState(false);
  const [galleryAdding, setGalleryAdding] = useState(false);
  const [galleryStatus, setGalleryStatus] = useState<string | null>(null);
  const [createGalleryOpen, setCreateGalleryOpen] = useState(false);
  const [quality, setQuality] = useState("");
  const [resolution, setResolution] = useState("");
  const [outputFormat, setOutputFormat] = useState("");
  const [sampleRate, setSampleRate] = useState("");
  const [speed, setSpeed] = useState("");
  const [volume, setVolume] = useState("");
  const [pitch, setPitch] = useState("");
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
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const hydratedParamsUserId = useRef<string | null>(null);
  const controlsReady = useRef(false);
  const paramsTouched = useRef(false);
  const promptField = useRef<PromptField | null>(null);
  const attachDraft = useRef<{ text: string; caret: number } | null>(null);
  const lastFrameAttempted = useRef(new Set<string>());
  const createGalleryOpenRef = useRef(false);
  const cancelCreateGalleryRef = useRef<() => void>(() => {});

  function rememberParam<T>(setter: (value: T) => void) {
    return (value: T) => {
      paramsTouched.current = true;
      setter(value);
    };
  }

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
    cancelCreateGalleryRef.current();
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

  const refreshLibrary = useCallback(async (signal?: AbortSignal) => {
    const data = await api.listGenerations("library", signal);
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
    if (!user) {
      hydratedParamsUserId.current = null;
      paramsTouched.current = false;
      return;
    }
    void refreshActive().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to resume jobs"),
    );
    void api
      .studioSettings()
      .then((data) => {
        setSettings(data);
        if (hydratedParamsUserId.current === user.id || paramsTouched.current) return;
        hydratedParamsUserId.current = user.id;
        if (data.lastParams.aspect_ratio && data.lastParams.aspect_ratio !== "auto") {
          setAspectRatio(data.lastParams.aspect_ratio);
        }
        if (data.lastParams.duration != null) setDuration(String(data.lastParams.duration));
        if (!controlsReady.current && typeof data.lastParams.generate_audio === "boolean") {
          setGenerateAudio(data.lastParams.generate_audio);
        }
        if (data.lastParams.quality) setQuality(data.lastParams.quality);
        if (data.lastParams.resolution) setResolution(data.lastParams.resolution);
        if (data.lastParams.output_format) setOutputFormat(data.lastParams.output_format);
        if (data.lastParams.sample_rate != null) setSampleRate(String(data.lastParams.sample_rate));
        if (data.lastParams.speed != null) setSpeed(String(data.lastParams.speed));
        if (data.lastParams.volume != null) setVolume(String(data.lastParams.volume));
        if (data.lastParams.pitch != null) setPitch(String(data.lastParams.pitch));
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
    if (!user) {
      setSavedPrompts([]);
      return;
    }
    let cancelled = false;
    void api
      .savedPrompts()
      .then((data) => {
        if (!cancelled) setSavedPrompts(data.prompts);
      })
      .catch(() => {
        if (!cancelled) setSavedPrompts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setGallerySummaries([]);
      return;
    }
    let cancelled = false;
    void api
      .galleries()
      .then((data) => {
        if (!cancelled) setGallerySummaries(data.galleries);
      })
      .catch(() => {
        if (!cancelled) setGallerySummaries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

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
      if (event.key === "Escape") {
        const target = event.target;
        if (target instanceof Element && target.closest("#gallery-drawer")) return;
        if (createGalleryOpenRef.current) {
          event.preventDefault();
          cancelCreateGalleryRef.current();
          return;
        }
        if (peekId) {
          event.preventDefault();
          setPeekId(null);
          return;
        }
        if (libraryOpen) {
          event.preventDefault();
          closeLibrary();
        }
        return;
      }
      if (event.repeat || event.altKey || !(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.code === "KeyL") {
        event.preventDefault();
        if (libraryOpen) closeLibrary();
        else setLibraryOpen(true);
        return;
      }
      if (event.code === "Comma") {
        event.preventDefault();
        setShowSettings(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peekId, libraryOpen, closeLibrary]);

  useEffect(() => {
    if (!user || !libraryOpen) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), LIBRARY_LOAD_TIMEOUT_MS);
    let cancelled = false;
    setLibraryLoading(true);
    setLibraryError(null);
    void refreshLibrary(controller.signal)
      .then(() => {
        if (!cancelled) setLibraryError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = controller.signal.aborted
          ? "Library took too long to load."
          : err instanceof Error
            ? err.message
            : "Failed to load library";
        setLibraryError(message);
        setError(message);
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (!cancelled) setLibraryLoading(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [user, libraryOpen, refreshLibrary]);

  const pendingLastFrameKey = generations
    .filter(
      (item) =>
        item.captureLastFrame === true &&
        item.mediaType === "video" &&
        item.status === "succeeded" &&
        Boolean(item.resultUrl) &&
        !item.lastFrameUrl,
    )
    .map((item) => `${item.id}\t${item.resultUrl}`)
    .join("\n");

  useEffect(() => {
    if (!pendingLastFrameKey) return;
    let cancelled = false;
    for (const line of pendingLastFrameKey.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab <= 0) continue;
      const id = line.slice(0, tab);
      const src = line.slice(tab + 1);
      if (!src || lastFrameAttempted.current.has(id)) continue;
      lastFrameAttempted.current.add(id);
      void captureVideoLastFrame(src)
        .then((blob) => api.saveLastFrame(id, blob))
        .then((saved) => {
          if (cancelled || !saved.lastFrameUrl) return;
          setGenerations((prev) =>
            prev.map((row) =>
              row.id === id
                ? { ...row, lastFrameUrl: saved.lastFrameUrl, updatedAt: saved.updatedAt }
                : row,
            ),
          );
        })
        .catch((err) => {
          lastFrameAttempted.current.delete(id);
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Could not save the last frame");
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [pendingLastFrameKey]);

  useLayoutEffect(() => {
    attachDraft.current = null;
  }, [prompt]);

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
          setAspectRatio((prev) => preferredAspectRatio(data.controls.aspectRatios ?? [], prev));
        }
        const durationControl = data.controls.duration;
        if (durationControl) {
          setDuration((prev) => nearestDurationValue(prev, durationControl));
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
        if (data.controls.safetyTolerance) {
          setSafetyTolerance(safetyToleranceSelection(data.controls.safetyTolerance));
        } else {
          setSafetyTolerance("");
        }
        const rate = data.controls.sampleRate;
        if (rate) setSampleRate((prev) => nearestDurationValue(prev, rate));
        else setSampleRate("");
        const speedControl = data.controls.speed;
        if (speedControl) setSpeed((prev) => nearestDurationValue(prev, speedControl));
        else setSpeed("");
        const volumeControl = data.controls.volume;
        if (volumeControl) setVolume((prev) => nearestDurationValue(prev, volumeControl));
        else setVolume("");
        const pitchControl = data.controls.pitch;
        if (pitchControl) setPitch((prev) => nearestDurationValue(prev, pitchControl));
        else setPitch("");
        controlsReady.current = true;
        if (data.controls.generateAudio && typeof data.controls.generateAudioDefault === "boolean") {
          setGenerateAudio(data.controls.generateAudioDefault);
        } else if (!data.controls.generateAudio) {
          setGenerateAudio(false);
        }
        setDraft(data.controls.draft ? data.controls.draftDefault === true : false);
      })
      .catch(() => {
        if (!cancelled) setControls(null);
      });
    return () => {
      cancelled = true;
    };
  }, [model, user?.hasOxenKey]);

  useEffect(() => {
    const durationControl = controls?.duration;
    if (!durationControl || duration.trim() === "") return;
    const next = durationFieldValue(duration, durationControl);
    if (next !== duration) setDuration(next);
  }, [controls, duration]);

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
              void notifyGenerationLocal({
                id: generation.id,
                status: generation.status,
                prompt: generation.prompt,
                mediaType: generation.mediaType,
                errorMessage: generation.errorMessage,
              });
            }
          } catch {
            // ignore transient poll errors
          }
        }
      })();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [generations, refreshCredits]);

  function currentModel() {
    return models.find((item) => item.id === model) ?? null;
  }

  function capForKind(kind: "image" | "video" | "audio") {
    return attachKindCap(controls, mode, kind, currentModel());
  }

  function noteRejectedMedia(rejected: File[]) {
    if (rejected.length === 0) return;
    setError(supportedMediaNotice(acceptedMediaKinds(controls, mode, currentModel())));
  }

  function modelHasFaceSlot(kind: "image" | "video") {
    const field = kind === "image" ? "input_face_images" : "input_face_videos";
    return Boolean(controls?.slots.some((slot) => slot.field === field));
  }

  function mentionStart(kind: "image" | "video" | "audio", existing: StagedMedia[]) {
    if (kind === "audio" || !modelHasFaceSlot(kind)) return existing.length;
    return existing.filter((item) => item.role !== "scene").length;
  }

  function mentionAllowed(kind: "image" | "video" | "audio") {
    const kinds = controls?.mentionKinds;
    if (!kinds) return true;
    return kinds.includes(kind);
  }

  function appendMentionTokens(kind: "image" | "video" | "audio", existingCount: number, addedCount: number) {
    if (addedCount <= 0 || !mentionAllowed(kind)) return;
    const tokens: string[] = [];
    for (let offset = 0; offset < addedCount; offset += 1) {
      tokens.push(mentionToken(kind, existingCount + offset));
    }
    const field = promptField.current;
    const el = field?.element ?? null;
    const liveCaret = el && document.activeElement === el ? el.selectionStart : null;
    const base = attachDraft.current?.text ?? prompt;
    const caret = attachDraft.current ? attachDraft.current.caret : liveCaret;
    const result = insertAttachMentions(base, caret, tokens);
    attachDraft.current = { text: result.next, caret: result.caret };
    setPrompt(result.next);
    field?.place(result.caret, result.next);
  }

  function addFilesOfKind(kind: "image" | "video" | "audio", incoming: File[]) {
    if (incoming.length === 0) return;
    const cap = capForKind(kind);
    const existing = staged.filter((item) => item.kind === kind);
    const start = mentionStart(kind, existing);
    setStaged((prev) => {
      const others = prev.filter((item) => item.kind !== kind);
      const existingItems = prev.filter((item) => item.kind === kind);
      const added = incoming.map((file) => ({
        file,
        kind,
        name: file.name,
        preview: URL.createObjectURL(file),
        role: kind === "audio" ? undefined : ("character" as const),
      }));
      const merged = [...existingItems, ...added].slice(0, cap);
      for (const item of existingItems) {
        if (!merged.includes(item)) releasePreview(item.preview);
      }
      return [...others, ...merged];
    });
    appendMentionTokens(kind, start, Math.min(incoming.length, Math.max(0, cap - existing.length)));
  }

  function onAddFiles(list: FileList | File[] | null) {
    const incoming = filesFromList(list);
    if (incoming.length === 0) return;
    const { accepted, rejected } = partitionMediaFiles(
      incoming,
      acceptedMediaKinds(controls, mode, currentModel()),
    );
    const images = accepted.filter((item) => item.kind === "image").map((item) => item.file);
    const videos = accepted.filter((item) => item.kind === "video").map((item) => item.file);
    const audios = accepted.filter((item) => item.kind === "audio").map((item) => item.file);
    const exclusive = controls?.imageAudioExclusive === true;
    let nextImages = images;
    let nextVideos = videos;
    let nextAudios = audios;
    let exclusiveConflict = false;
    if (exclusive && nextAudios.length > 0 && (nextImages.length > 0 || staged.some((item) => item.kind === "image"))) {
      exclusiveConflict = true;
      rejected.push(...nextImages);
      nextImages = [];
      setStaged((prev) => {
        for (const item of prev) {
          if (item.kind === "image") releasePreview(item.preview);
        }
        return prev.filter((item) => item.kind !== "image");
      });
      setError("This model accepts a reference image or reference audio, not both.");
    } else if (exclusive && nextImages.length > 0 && staged.some((item) => item.kind === "audio")) {
      exclusiveConflict = true;
      rejected.push(...nextImages);
      nextImages = [];
      setError("This model accepts a reference image or reference audio, not both.");
    }
    if (controls?.imageVideoExclusive && nextImages.length > 0 && nextVideos.length > 0) {
      exclusiveConflict = true;
      if (mode === "video-to-video") {
        rejected.push(...nextImages);
        nextImages = [];
      } else {
        rejected.push(...nextVideos);
        nextVideos = [];
      }
      setError("Keyframes and a continuation clip can’t be used together.");
    }
    if (controls?.imageVideoExclusive && (nextImages.length > 0 || nextVideos.length > 0)) {
      const clearKind = nextImages.length > 0 ? "video" : "image";
      if (staged.some((item) => item.kind === clearKind)) {
        setStaged((prev) => {
          for (const item of prev) {
            if (item.kind === clearKind) releasePreview(item.preview);
          }
          return prev.filter((item) => item.kind !== clearKind);
        });
        setError("Keyframes and a continuation clip can’t be used together.");
      }
    }
    addFilesOfKind("image", nextImages);
    addFilesOfKind("video", nextVideos);
    addFilesOfKind("audio", nextAudios);
    if (!exclusiveConflict) noteRejectedMedia(rejected);
  }

  function addLibraryItem(generation: Generation) {
    const ref = libraryRefFromGeneration(generation);
    if (!ref) return;
    if (
      controls?.imageAudioExclusive &&
      ((ref.kind === "image" && staged.some((item) => item.kind === "audio")) ||
        (ref.kind === "audio" && staged.some((item) => item.kind === "image")))
    ) {
      setError("This model accepts a reference image or reference audio, not both.");
      return;
    }
    if (
      controls?.imageVideoExclusive &&
      ((ref.kind === "image" && staged.some((item) => item.kind === "video")) ||
        (ref.kind === "video" && staged.some((item) => item.kind === "image")))
    ) {
      const clearKind = ref.kind === "image" ? "video" : "image";
      setStaged((prev) => {
        for (const item of prev) {
          if (item.kind === clearKind) releasePreview(item.preview);
        }
        return prev.filter((item) => item.kind !== clearKind);
      });
      setError("Keyframes and a continuation clip can’t be used together.");
    }
    const cap = capForKind(ref.kind);
    if (cap <= 0) return;
    if (staged.some((item) => item.generationId === ref.generationId)) return;
    const existing = staged.filter((item) => item.kind === ref.kind);
    const start = mentionStart(ref.kind, existing);
    setStaged((prev) =>
      mergeLibraryRefs(
        prev,
        [
          {
            kind: ref.kind,
            name: ref.name,
            preview: ref.preview,
            url: ref.url,
            generationId: ref.generationId,
            role: ref.kind === "audio" ? undefined : ("character" as const),
          },
        ],
        capForKind,
      ),
    );
    if (existing.length < cap) appendMentionTokens(ref.kind, start, 1);
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

  function onToggleAttachmentRole(index: number) {
    setStaged((prev) =>
      prev.map((item, itemIndex) => {
        if (itemIndex !== index || item.kind === "audio") return item;
        return { ...item, role: item.role === "scene" ? "character" : "scene" };
      }),
    );
  }

  function onReorderAttachments(from: number, to: number) {
    const next = moveItem(staged, from, to);
    if (next === staged) return;
    setStaged(next);
  }

  const imageCount = staged.filter((item) => item.kind === "image").length;
  const videoCount = staged.filter((item) => item.kind === "video").length;
  const audioCount = staged.filter((item) => item.kind === "audio").length;
  const peekKind = peek ? kindFromMediaType(peek.mediaType) : null;
  const peekAttachSupported = peekKind ? capForKind(peekKind) > 0 : false;
  const readyMedia = useMemo(() => completedMedia(generations), [generations]);

  const selectedModel = models.find((item) => item.id === model);
  const lastFrameVisible = showGetLastFrame({
    modelId: model,
    displayName: selectedModel?.display_name,
    mode,
  });

  const canGenerate = Boolean(
    user?.hasOxenKey &&
      prompt.trim() &&
      mode &&
      model &&
      (!slotRequired(controls, "image", mode) || imageCount > 0) &&
      (!slotRequired(controls, "video", mode) || videoCount > 0) &&
      (!slotRequired(controls, "audio", mode) || audioCount > 0),
  );

  async function onSavePrompt(name: string, body: string) {
    try {
      const saved = await api.savePrompt(name, body);
      setSavedPrompts((prev) => [
        saved.prompt,
        ...prev.filter((item) => item.id !== saved.prompt.id),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save prompt");
      throw err;
    }
  }

  async function onUpdateSavedPrompt(id: string, name: string, body: string) {
    try {
      const saved = await api.updateSavedPrompt(id, name, body);
      setSavedPrompts((prev) =>
        prev.map((item) => (item.id === saved.prompt.id ? saved.prompt : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update prompt");
      throw err;
    }
  }

  function onGalleryNew() {
    setGalleryId(null);
    setGalleryName("");
    setGalleryItems([]);
    setGalleryStatus(null);
  }

  async function onDeleteSavedPrompt(id: string) {
    try {
      await api.deleteSavedPrompt(id);
      setSavedPrompts((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete prompt");
    }
  }

  async function onGalleryAddFiles(list: FileList | File[] | null) {
    const incoming = filesFromList(list);
    const { accepted, rejected } = partitionMediaFiles(
      incoming,
      acceptedMediaKinds(controls, mode, currentModel()),
    );
    if (rejected.length > 0) {
      setGalleryStatus(supportedMediaNotice(acceptedMediaKinds(controls, mode, currentModel())));
    }
    if (accepted.length === 0) return;
    const room = Math.max(0, GALLERY_ITEM_CAP - galleryItems.length);
    if (room === 0) {
      setGalleryStatus(`A gallery holds ${GALLERY_ITEM_CAP} items`);
      return;
    }
    setGalleryAdding(true);
    if (rejected.length === 0) setGalleryStatus(null);
    try {
      const added: GalleryDraftItem[] = [];
      for (const item of accepted.slice(0, room)) {
        const uploaded = await api.upload(item.file, { folder: "galleries" });
        added.push({
          id: crypto.randomUUID(),
          kind: item.kind,
          name: item.file.name || uploaded.name,
          preview: uploaded.url,
          key: uploaded.key,
          url: uploaded.url,
        });
      }
      setGalleryItems((prev) => [...prev, ...added].slice(0, GALLERY_ITEM_CAP));
      if (rejected.length > 0) {
        setGalleryStatus(supportedMediaNotice(acceptedMediaKinds(controls, mode, currentModel())));
      }
    } catch (err) {
      setGalleryStatus(err instanceof Error ? err.message : "Couldn’t add that file");
    } finally {
      setGalleryAdding(false);
    }
  }

  async function onGallerySave(): Promise<boolean> {
    const name = galleryName.trim();
    if (!name || gallerySaving) return false;
    setGallerySaving(true);
    setGalleryStatus(null);
    try {
      const saved = await api.saveGallery({
        id: galleryId,
        name,
        items: galleryItems.map((item) => ({
          kind: item.kind,
          name: item.name,
          key: item.key,
        })),
      });
      setGalleryId(saved.gallery.id);
      setGalleryName(saved.gallery.name);
      setGalleryItems(
        saved.gallery.items.map((item) => ({
          id: item.id,
          kind: item.kind,
          name: item.name,
          preview: item.url,
          key: item.key,
          url: item.url,
        })),
      );
      setGallerySummaries((prev) => [
        { id: saved.gallery.id, name: saved.gallery.name, updatedAt: saved.gallery.updatedAt },
        ...prev.filter((item) => item.id !== saved.gallery.id),
      ]);
      return true;
    } catch (err) {
      setGalleryStatus(err instanceof Error ? err.message : "Couldn’t save the gallery");
      return false;
    } finally {
      setGallerySaving(false);
    }
  }

  function onToggleHistory(batchItems: Generation[]) {
    const incoming = historyItemsForGallery(batchItems);
    if (incoming.length === 0) {
      setGalleryStatus("That media isn’t stored in Studio yet");
      return;
    }
    const result = toggleHistoryInGallery(galleryItems, incoming, GALLERY_ITEM_CAP);
    setGalleryItems(result.items);
    if (result.skipped > 0) {
      setGalleryStatus(`A gallery holds ${GALLERY_ITEM_CAP} items`);
      return;
    }
    setGalleryStatus(null);
  }

  function cancelCreateGallery() {
    setCreateGalleryOpen(false);
    onGalleryNew();
  }

  function openCreateGallery() {
    if (createGalleryOpen) {
      cancelCreateGallery();
      return;
    }
    onGalleryNew();
    setCreateGalleryOpen(true);
  }

  async function saveCreateGallery() {
    const saved = await onGallerySave();
    if (saved) setCreateGalleryOpen(false);
  }

  createGalleryOpenRef.current = createGalleryOpen;
  cancelCreateGalleryRef.current = () => {
    if (!createGalleryOpenRef.current) return;
    cancelCreateGallery();
  };

  async function onGalleryLoad(id: string) {
    setGalleryStatus(null);
    try {
      const { gallery } = await api.gallery(id);
      setGalleryId(gallery.id);
      setGalleryName(gallery.name);
      setGalleryItems(
        gallery.items.map((item) => ({
          id: item.id,
          kind: item.kind,
          name: item.name,
          preview: item.url,
          key: item.key,
          url: item.url,
        })),
      );
    } catch (err) {
      setGalleryStatus(err instanceof Error ? err.message : "Couldn’t load that gallery");
    }
  }

  function onGalleryAttach(items?: GalleryDraftItem[], caret?: number | null): string[] {
    const faceFirst = Boolean(
      controls?.slots.some(
        (slot) => slot.field === "input_face_images" || slot.field === "input_face_videos",
      ),
    );
    const plan = planGalleryAttach({
      items: items ?? galleryItems,
      staged,
      caps: {
        image: capForKind("image"),
        video: capForKind("video"),
        audio: capForKind("audio"),
      },
      prompt,
      faceFirst,
    });
    if (plan.add.length > 0) {
      setStaged((prev) => [
        ...prev,
        ...plan.add.map((item) => ({
          kind: item.kind,
          name: item.name,
          preview: item.url || item.preview,
          url: item.url,
          key: item.key,
          role: item.kind === "audio" ? undefined : ("character" as const),
        })),
      ]);
    }
    if (plan.tokens.length > 0) {
      const field = promptField.current;
      const el = field?.element ?? null;
      const liveCaret =
        caret !== undefined
          ? caret
          : el && document.activeElement === el
            ? el.selectionStart
            : null;
      const result = insertAttachMentions(prompt, liveCaret, plan.tokens);
      setPrompt(result.next);
      field?.place(result.caret, result.next);
    }
    return plan.skipped.map((item) => item.name);
  }

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
      setGetLastFrame(false);
      return;
    }
    if (
      !showGetLastFrame({
        modelId: selected ? model : "",
        displayName: selected?.display_name,
        mode: next,
      })
    ) {
      setGetLastFrame(false);
    }
  }

  function handleModelChange(next: string) {
    setNumGenerations((count) => generationCountForModelChange(model, next, count));
    setGetLastFrame(false);
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

  function requestDeleteMedia(ids: string[], fromOxen = false) {
    if (ids.length === 0) return;
    if (
      fromOxen &&
      !window.confirm(`Delete this media from ${branding.name} and Oxen? This cannot be undone.`)
    ) {
      return;
    }
    void onDeleteGenerations(ids, fromOxen);
  }

  async function onDeleteGenerations(ids: string[], fromOxen = false) {
    if (ids.length === 0) return;
    const removing = new Set(ids);
    setGenerations((prev) => prev.filter((row) => !removing.has(row.id)));
    setSelectedId((prev) => siblingAfterRemoval(prev, removing, generations));
    setPeekId((prev) => siblingAfterRemoval(prev, removing, generations));
    setError(null);
    try {
      await Promise.all(ids.map((id) => api.deleteGeneration(id, { fromOxen })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete media");
      if (libraryOpen) void refreshLibrary();
    }
  }

  function onLibraryCleanup(action: "failed" | "thumbs" | "all") {
    switch (action) {
      case "all":
        setGenerations([]);
        setSelectedId(null);
        setPeekId(null);
        return;
      case "failed":
        setGenerations((prev) =>
          prev.filter((row) => row.status !== "failed" && row.status !== "cancelled"),
        );
        if (libraryOpen) void refreshLibrary();
        return;
      case "thumbs":
        return;
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
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
      const imageRoles: ("character" | "scene")[] = [];
      const videoRoles: ("character" | "scene")[] = [];
      const sendable = [
        ...takeStagedOfKind(staged, "image", capForKind("image")),
        ...takeStagedOfKind(staged, "video", capForKind("video")),
        ...takeStagedOfKind(staged, "audio", capForKind("audio")),
      ];
      for (const item of sendable) {
        const url = item.url ?? (item.file ? (await api.upload(item.file)).url : "");
        if (!url) continue;
        const role = item.role === "scene" ? "scene" : "character";
        if (item.kind === "image") {
          images.push(url);
          imageRoles.push(role);
        } else if (item.kind === "video") {
          videos.push(url);
          videoRoles.push(role);
        } else audios.push(url);
      }

      const payload: Record<string, unknown> = {
        mode,
        model,
        prompt: prompt.trim(),
        num_generations: numGenerations,
      };
      const sendAspect =
        mode !== "text-to-audio" ||
        Boolean(controls?.aspectRatios && controls.aspectRatios.length > 0);
      if (sendAspect) payload.aspect_ratio = aspectRatio;
      if (modeIsVideo(mode)) {
        const sent = durationToSend(duration, controls?.duration ?? null);
        if (sent != null && sent !== "") payload.duration = sent;
      }
      if (seed.trim()) payload.seed = Number(seed);
      if (controls?.generateAudio) payload.generate_audio = generateAudio;
      if (controls?.draft) payload.draft = draft;
      if (lastFrameVisible && getLastFrame) payload.get_last_frame = true;
      if (quality) payload.quality = quality;
      if (resolution) payload.resolution = resolution;
      if (outputFormat) payload.output_format = outputFormat;
      if (controls?.sampleRate && sampleRate) payload.sample_rate = Number(sampleRate);
      if (controls?.speed && speed) payload.speed = Number(speed);
      if (controls?.volume && volume) payload.volume = Number(volume);
      if (controls?.pitch && pitch !== "") payload.pitch = Number(pitch);
      if (background) payload.background = background;
      if (controls?.safetyTolerance) {
        const chosen = safetyTolerance || safetyToleranceSelection(controls.safetyTolerance);
        if (chosen !== "") payload.safety_tolerance = Number(chosen);
      }
      if (images.length) {
        payload.images = images;
        if (modelHasFaceSlot("image")) payload.image_roles = imageRoles;
      }
      if (videos.length) {
        payload.videos = videos;
        if (modelHasFaceSlot("video")) payload.video_roles = videoRoles;
      }
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

  const galleryKinds = acceptedMediaKinds(controls, mode, currentModel());
  const galleryAccept = fileAcceptValue(galleryKinds);
  const galleryDropPhrase = mediaKindPhrase(galleryKinds);

  if (loading) {
    return (
      <div className="loading-screen">
        <Loader size="lg" label={`Loading ${branding.name}…`} />
      </div>
    );
  }

  if (!user) {
    return <LoginPage name={branding.name} logoUrl={branding.logoUrl} />;
  }

  return (
    <div className={`app-shell${libraryOpen ? " library-open" : ""}${peek ? " has-peek" : ""}`}>
      <Sidebar
        logoUrl={branding.logoUrl}
        generations={generations}
        selectedId={peekId}
        loading={libraryLoading}
        loadError={libraryError}
        downloadingAll={downloadingAll}
        onSelect={setPeekId}
        onClose={closeLibrary}
        onDownloadAll={() => void onDownloadAll()}
        onDelete={(ids, fromOxen) => {
          if (fromOxen) requestDeleteMedia(ids, true);
          else void onDeleteGenerations(ids, false);
        }}
        attachedIds={attachedIds}
        onAttach={addLibraryItem}
        attachSupported={(item) => {
          const ref = libraryRefFromGeneration(item);
          return Boolean(ref && capForKind(ref.kind) > 0);
        }}
        createGalleryOpen={createGalleryOpen}
        galleryName={galleryName}
        onGalleryNameChange={setGalleryName}
        galleryItems={galleryItems}
        gallerySaving={gallerySaving}
        galleryAdding={galleryAdding}
        galleryStatus={galleryStatus}
        onGalleryAddFiles={(files) => void onGalleryAddFiles(files)}
        onGalleryRemove={(index) => setGalleryItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
        onCreateGallery={openCreateGallery}
        onCreateGalleryClose={cancelCreateGallery}
        onCreateGallerySave={() => void saveCreateGallery()}
        onToggleHistory={onToggleHistory}
        galleryAccept={galleryAccept}
        galleryDropLabel={galleryDropPhrase ? `Drop ${galleryDropPhrase}` : "Drop media"}
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
        <div className="main-column">
          <div className="main-top">
            <div className="main-top-left">
              <div className="nav-brand">
                <img className={brandMarkClass(branding.logoUrl)} src={branding.logoUrl} alt="" />
                <strong>{branding.name}</strong>
              </div>
              <button
                type="button"
                className={`ghost-btn${libraryOpen ? " active" : ""}`}
                aria-expanded={libraryOpen}
                aria-controls="media-library"
                aria-keyshortcuts="Meta+Shift+L"
                title="Library (⌘⇧L)"
                onClick={() => {
                  if (libraryOpen) closeLibrary();
                  else setLibraryOpen(true);
                }}
              >
                Library
                <span className="nav-shortcut" aria-hidden>
                  <kbd>⌘</kbd>
                  <kbd>⇧</kbd>
                  <kbd>L</kbd>
                </span>
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
              onDelete={(id) => requestDeleteMedia([id], true)}
            />
            {peek ? (
              <LibraryPeek
                generation={peek}
                variants={peekVariants}
                attachedIds={attachedIds}
                attachSupported={peekAttachSupported}
                onClose={() => setPeekId(null)}
                onAttach={addLibraryItem}
                onSelectVariant={setPeekId}
                onDownload={() => {
                  if (!peek.resultUrl) return;
                  void downloadMedia(peek.resultUrl, downloadFilename(peek));
                }}
                onRemove={(ids, fromOxen) => {
                  if (fromOxen) requestDeleteMedia(ids, true);
                  else void onDeleteGenerations(ids, false);
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
            onPromptField={(field) => {
              promptField.current = field;
            }}
            aspectRatio={aspectRatio}
            onAspectRatioChange={rememberParam(setAspectRatio)}
            duration={duration}
            onDurationChange={rememberParam(setDuration)}
            seed={seed}
            onSeedChange={setSeed}
            numGenerations={numGenerations}
            onNumGenerationsChange={setNumGenerations}
            generateAudio={generateAudio}
            onGenerateAudioChange={rememberParam(setGenerateAudio)}
            draft={draft}
            onDraftChange={setDraft}
            showLastFrame={lastFrameVisible}
            getLastFrame={getLastFrame}
            onGetLastFrameChange={setGetLastFrame}
            savedPrompts={savedPrompts}
            onSavePrompt={onSavePrompt}
            onUpdateSavedPrompt={onUpdateSavedPrompt}
            onDeleteSavedPrompt={onDeleteSavedPrompt}
            galleryName={galleryName}
            onGalleryNameChange={setGalleryName}
            galleryItems={galleryItems}
            gallerySummaries={gallerySummaries}
            gallerySaving={gallerySaving}
            galleryAdding={galleryAdding}
            galleryStatus={galleryStatus}
            onGalleryAddFiles={(files) => void onGalleryAddFiles(files)}
            onGalleryRemove={(index) => setGalleryItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
            onGalleryReorder={(from, to) => setGalleryItems((prev) => moveItem(prev, from, to))}
            onGallerySave={onGallerySave}
            onGalleryNew={onGalleryNew}
            onGalleryLoad={onGalleryLoad}
            onGalleryAttach={onGalleryAttach}
            quality={quality}
            onQualityChange={rememberParam(setQuality)}
            resolution={resolution}
            onResolutionChange={rememberParam(setResolution)}
            outputFormat={outputFormat}
            onOutputFormatChange={rememberParam(setOutputFormat)}
            sampleRate={sampleRate}
            onSampleRateChange={rememberParam(setSampleRate)}
            speed={speed}
            onSpeedChange={rememberParam(setSpeed)}
            volume={volume}
            onVolumeChange={rememberParam(setVolume)}
            pitch={pitch}
            onPitchChange={rememberParam(setPitch)}
            background={background}
            onBackgroundChange={rememberParam(setBackground)}
            safetyTolerance={safetyTolerance}
            onSafetyToleranceChange={rememberParam(setSafetyTolerance)}
            attachments={staged.map((item) => ({
              name: item.name,
              preview: item.preview,
              kind: item.kind,
              role: item.role,
            }))}
            onAddFiles={onAddFiles}
            onClearAttachment={onClearAttachment}
            onToggleAttachmentRole={onToggleAttachmentRole}
            onReorderAttachments={onReorderAttachments}
            busy={busy}
            error={error}
            onGenerate={() => void onGenerate()}
            canGenerate={canGenerate}
          />
        </div>
      </main>
      {showSettings ? (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          favorites={favorites}
          settings={settings}
          onSettingsChange={setSettings}
          onFavoritesChange={refreshFavorites}
          onLibraryCleanup={onLibraryCleanup}
          branding={branding}
          onBrandingChange={setBranding}
        />
      ) : null}
    </div>
  );
}
