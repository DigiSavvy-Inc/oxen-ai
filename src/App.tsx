import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./auth/AuthContext";
import { AccountMenu } from "./components/AccountMenu";
import { Canvas } from "./components/Canvas";
import { ChatThread } from "./components/ChatThread";
import { HelpDock } from "./components/HelpDock";
import { Composer, type PromptField } from "./components/Composer";
import type { GalleryDraftItem } from "./components/GalleryDrawer";
import { CreditMeter } from "./components/CreditMeter";
import { LibraryPeek } from "./components/LibraryPeek";
import { LoginPage } from "./components/LoginPage";
import { Loader } from "./components/Loader";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { ProfileSwitch } from "./components/ProfileSwitch";
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
  type GalleryItem,
  type GallerySummary,
  type SavedPrompt,
  type StudioProfile,
  type StudioSettings,
} from "./lib/api";
import { groupGenerationBatches, isActiveGeneration, mergeGenerations, siblingAfterRemoval } from "./lib/batches";
import { brandMarkClass, useInstanceBranding } from "./lib/branding";
import { notifyGenerationLocal } from "./lib/pwa";
import { completedMedia, downloadAllMedia, downloadFilename, downloadMedia } from "./lib/download";
import { chatMessagesFromTurns, type ChatTurn } from "./lib/chat";
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
import {
  historyItemsForGallery,
  toggleHistoryInGallery,
  type HistoryGalleryItem,
  type HistoryGalleryNotice,
} from "./lib/gallery-history";
import { insertAttachMentions, moveItem } from "./lib/mentions";
import { generationCountForModelChange, pickModel } from "./lib/model-menu";
import { captureVideoLastFrame } from "./lib/last-frame";
import { preferredAspectRatio, showGetLastFrame, takeStagedOfKind } from "./lib/params";
import {
  applyControlLock,
  durationFieldValue,
  durationToSend,
  lockedDuration,
  lockedResolution,
  nearestDurationValue,
  normalizeMediaRole,
  referenceRoleUsesFace,
  referenceTaskNeedsVideo,
  safetyToleranceSelection,
  type MediaRole,
} from "../worker/schema";
import { DEFAULT_HISTORY_PAGE_SIZE } from "../worker/history-page-size";

type StagedMedia = {
  file?: File;
  preview: string;
  kind: "image" | "video" | "audio";
  name: string;
  url?: string;
  key?: string;
  generationId?: string;
  role?: MediaRole | "scene";
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

function draftFromGalleryItem(item: GalleryItem): GalleryDraftItem {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    preview: item.thumbUrl || (item.kind === "image" ? item.url : ""),
    key: item.key,
    url: item.url,
    role: item.kind === "audio" ? undefined : item.role ? normalizeMediaRole(item.role) : undefined,
  };
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
  const [shots, setShots] = useState<{ prompt: string; duration: string }[]>([]);
  const [documents, setDocuments] = useState<{ file: File; name: string }[]>([]);
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
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
  const [profiles, setProfiles] = useState<StudioProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [quality, setQuality] = useState("");
  const [resolution, setResolution] = useState("");
  const [outputFormat, setOutputFormat] = useState("");
  const [referenceTask, setReferenceTask] = useState("");
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
  const [libraryItems, setLibraryItems] = useState<Generation[]>([]);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [libraryTags, setLibraryTags] = useState<string[]>([]);
  const [libraryPage, setLibraryPage] = useState(1);
  const [libraryTagInput, setLibraryTagInput] = useState("");
  const [libraryTag, setLibraryTag] = useState("");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const hydratedParamsUserId = useRef<string | null>(null);
  const referenceTaskRef = useRef("");
  const controlsReady = useRef(false);
  const paramsTouched = useRef(false);
  const durationPinned = useRef(false);
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

  const scopedGenerations = useMemo(() => {
    if (!activeProfileId) return generations;
    return generations.filter((item) => !item.profileId || item.profileId === activeProfileId);
  }, [generations, activeProfileId]);

  const selected = useMemo(
    () => scopedGenerations.find((g) => g.id === selectedId) ?? null,
    [scopedGenerations, selectedId],
  );

  const selectedVariants = useMemo(() => {
    if (!selected) return [];
    const batches = groupGenerationBatches(scopedGenerations);
    const batch = batches.find((entry) => entry.items.some((item) => item.id === selected.id));
    return batch?.items ?? [selected];
  }, [scopedGenerations, selected]);

  const peek = useMemo(
    () => scopedGenerations.find((g) => g.id === peekId) ?? null,
    [scopedGenerations, peekId],
  );

  const peekVariants = useMemo(() => {
    if (!peek) return [];
    const batches = groupGenerationBatches(scopedGenerations);
    const batch = batches.find((entry) => entry.items.some((item) => item.id === peek.id));
    return batch?.items ?? [peek];
  }, [scopedGenerations, peek]);

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

  const historyPageSize = settings?.historyPageSize ?? DEFAULT_HISTORY_PAGE_SIZE;

  const refreshLibrary = useCallback(async (signal?: AbortSignal) => {
    const data = await api.listGenerations("library", {
      signal,
      page: libraryPage,
      pageSize: historyPageSize,
      tag: libraryTag,
    });
    setLibraryItems(data.generations);
    setLibraryTotal(data.total ?? data.generations.length);
    setLibraryTags(data.tags ?? []);
    setGenerations((prev) => mergeGenerations(prev, data.generations));
  }, [historyPageSize, libraryPage, libraryTag]);

  async function replaceProfileMedia() {
    const [active, library, galleries] = await Promise.all([
      api.listGenerations("active"),
      api.listGenerations("library", { page: 1, pageSize: historyPageSize, tag: "" }),
      api.galleries(),
    ]);
    const seen = new Set<string>();
    const merged: Generation[] = [];
    for (const item of [...active.generations, ...library.generations]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
    setGenerations(merged);
    setLibraryItems(library.generations);
    setLibraryTotal(library.total ?? library.generations.length);
    setLibraryTags(library.tags ?? []);
    setLibraryPage(1);
    setLibraryTag("");
    setLibraryTagInput("");
    setGallerySummaries(galleries.galleries);
    setPeekId(null);
    setSelectedId(keepCanvasClear ? null : (merged[0]?.id ?? null));
    setGalleryId(null);
    setGalleryName("");
    setGalleryItems([]);
    setGalleryStatus(null);
  }

  async function applyProfileState(data: { profiles: StudioProfile[]; activeId: string | null }, reload: boolean) {
    setProfiles(data.profiles);
    setActiveProfileId(data.activeId);
    if (reload) await replaceProfileMedia();
  }

  async function onActivateProfile(id: string) {
    if (id === activeProfileId) return;
    try {
      await applyProfileState(await api.activateProfile(id), true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t switch profiles");
    }
  }

  async function onCreateProfile(name: string) {
    try {
      await applyProfileState(await api.createProfile(name), true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t create that profile");
    }
  }

  async function onRenameProfile(id: string, name: string) {
    try {
      await applyProfileState(await api.renameProfile(id, name), false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t rename that profile");
    }
  }

  async function onDeleteProfile(id: string) {
    try {
      await applyProfileState(await api.deleteProfile(id), true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t delete that profile");
    }
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = libraryTagInput.trim();
      setLibraryTag((current) => {
        if (current === next) return current;
        setLibraryPage(1);
        return next;
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [libraryTagInput]);

  const libraryPageCount = Math.max(1, Math.ceil(libraryTotal / historyPageSize) || 1);
  if (libraryPage > libraryPageCount) setLibraryPage(libraryPageCount);

  function onStudioSettings(next: StudioSettings) {
    if (next.historyPageSize !== historyPageSize) setLibraryPage(1);
    setSettings(next);
  }

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
      durationPinned.current = false;
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
        if (data.lastParams.duration != null) {
          durationPinned.current = true;
          setDuration(String(data.lastParams.duration));
        }
        if (!controlsReady.current && typeof data.lastParams.generate_audio === "boolean") {
          setGenerateAudio(data.lastParams.generate_audio);
        }
        if (data.lastParams.quality) setQuality(data.lastParams.quality);
        if (data.lastParams.resolution) setResolution(data.lastParams.resolution);
        if (data.lastParams.output_format) setOutputFormat(data.lastParams.output_format);
        if (data.lastParams.omni_reference_task_type) {
          setReferenceTask(data.lastParams.omni_reference_task_type);
        }
        if (data.lastParams.sample_rate != null) setSampleRate(String(data.lastParams.sample_rate));
        if (data.lastParams.speed != null) setSpeed(String(data.lastParams.speed));
        if (data.lastParams.volume != null) setVolume(String(data.lastParams.volume));
        if (data.lastParams.pitch != null) setPitch(String(data.lastParams.pitch));
        if (data.lastParams.background) setBackground(data.lastParams.background);
        if (typeof data.lastParams.seed === "number") setSeed(String(data.lastParams.seed));
      })
      .catch(() => {
        setSettings({
          defaultModelByMode: {},
          lastParams: {},
          historyPageSize: DEFAULT_HISTORY_PAGE_SIZE,
        });
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
    if (!user) {
      setProfiles([]);
      setActiveProfileId(null);
      return;
    }
    let cancelled = false;
    void api
      .profiles()
      .then((data) => {
        if (cancelled) return;
        setProfiles(data.profiles);
        setActiveProfileId(data.activeId);
      })
      .catch(() => {
        if (!cancelled) {
          setProfiles([]);
          setActiveProfileId(null);
        }
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
          setDuration((prev) => {
            if (
              !durationPinned.current &&
              durationControl.kind === "enum" &&
              durationControl.defaultValue &&
              durationControl.values.includes(durationControl.defaultValue)
            ) {
              return durationControl.defaultValue;
            }
            return nearestDurationValue(prev, durationControl);
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
        const tasks = data.controls.referenceTask ?? [];
        const prevTask = referenceTaskRef.current;
        const nextTask =
          tasks.length === 0 ? "" : tasks.includes(prevTask) ? prevTask : tasks[0] || "";
        setReferenceTask(nextTask);
        const aspectLock = data.controls.aspectLock;
        if (aspectLock && aspectLock.tasks.includes(nextTask)) {
          setAspectRatio(aspectLock.value);
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

  function capForKind(kind: "image" | "video" | "audio" | "document") {
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
    return existing.filter((item) => referenceRoleUsesFace(item.role)).length;
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
    const pdfs = accepted.filter((item) => item.kind === "document").map((item) => item.file);
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
    const pdfLimit = 24 * 1024 * 1024;
    if (pdfs.some((file) => file.size > pdfLimit)) setError("PDFs must be 24MB or smaller");
    const room = Math.max(0, capForKind("document") - documents.length);
    setDocuments((prev) => [
      ...prev,
      ...pdfs
        .filter((file) => file.size <= pdfLimit)
        .slice(0, room)
        .map((file) => ({ file, name: file.name || "document.pdf" })),
    ]);
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
    setChatTurns([]);
    setDocuments([]);
    setShots([]);
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

  function onAttachmentRoleChange(index: number, role: MediaRole) {
    setStaged((prev) =>
      prev.map((item, itemIndex) => {
        if (itemIndex !== index || item.kind === "audio") return item;
        return { ...item, role };
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
  const readyMedia = useMemo(() => completedMedia(libraryItems), [libraryItems]);

  const selectedModel = models.find((item) => item.id === model);
  const lastFrameVisible = showGetLastFrame({
    modelId: model,
    displayName: selectedModel?.display_name,
    mode,
  });

  referenceTaskRef.current = referenceTask;
  const taskForModel =
    controls?.referenceTask?.includes(referenceTask) ? referenceTask : undefined;
  const shotReady = shots.some((shot) => shot.prompt.trim());
  const canGenerate = Boolean(
    user?.hasOxenKey &&
      mode &&
      model &&
      (mode === "chat"
        ? prompt.trim() || imageCount > 0 || documents.length > 0
        : (prompt.trim() || (controls?.multiPrompt && shotReady)) &&
          (!slotRequired(controls, "image", mode) || imageCount > 0) &&
          (!slotRequired(controls, "video", mode) || videoCount > 0) &&
          (!referenceTaskNeedsVideo(taskForModel) || videoCount > 0) &&
          (!slotRequired(controls, "audio", mode) || audioCount > 0)),
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
      acceptedMediaKinds(controls, mode, currentModel()).filter((kind) => kind !== "document"),
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
        if (item.kind === "document") continue;
        const uploaded = await api.upload(item.file, { folder: "galleries" });
        added.push({
          id: crypto.randomUUID(),
          kind: item.kind,
          name: item.file.name || uploaded.name,
          preview: uploaded.url,
          key: uploaded.key,
          url: uploaded.url,
          role: item.kind === "audio" ? undefined : "character",
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

  async function onGallerySave(nextItems?: GalleryDraftItem[]): Promise<boolean> {
    const name = galleryName.trim();
    const items = nextItems ?? galleryItems;
    if (!name || gallerySaving) return false;
    setGallerySaving(true);
    setGalleryStatus(null);
    try {
      const saved = await api.saveGallery({
        id: galleryId,
        name,
        items: galleryPayload(items),
      });
      setGalleryId(saved.gallery.id);
      setGalleryName(saved.gallery.name);
      setGalleryItems(saved.gallery.items.map(draftFromGalleryItem));
      const listed = await api.galleries().catch(() => null);
      setGallerySummaries(
        listed?.galleries ?? [
          {
            id: saved.gallery.id,
            name: saved.gallery.name,
            updatedAt: saved.gallery.updatedAt,
            count: saved.gallery.items.length,
          },
          ...gallerySummaries.filter((item) => item.id !== saved.gallery.id),
        ],
      );
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
      setGalleryItems(gallery.items.map(draftFromGalleryItem));
    } catch (err) {
      setGalleryStatus(err instanceof Error ? err.message : "Couldn’t load that gallery");
    }
  }

  async function onGalleryFeature(index: number) {
    const item = galleryItems[index];
    if (!item || index === 0) return;
    const next = [item, ...galleryItems.filter((_, itemIndex) => itemIndex !== index)];
    setGalleryItems(next);
    await onGallerySave(next);
  }

  async function onGalleryRename(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setGalleryStatus(null);
    try {
      const { gallery } = await api.gallery(id);
      const saved = await api.saveGallery({
        id,
        name: trimmed,
        items: galleryPayload(gallery.items),
      });
      if (galleryId === id) setGalleryName(saved.gallery.name);
      const listed = await api.galleries();
      setGallerySummaries(listed.galleries);
    } catch (err) {
      setGalleryStatus(err instanceof Error ? err.message : "Couldn’t rename that gallery");
    }
  }

  async function onGalleryDelete(id?: string) {
    const target = id ?? galleryId;
    if (!target) return;
    setGalleryStatus(null);
    try {
      await api.deleteGallery(target);
      if (target === galleryId) {
        setGalleryId(null);
        setGalleryName("");
        setGalleryItems([]);
      }
      const listed = await api.galleries();
      setGallerySummaries(listed.galleries);
    } catch (err) {
      setGalleryStatus(err instanceof Error ? err.message : "Couldn’t delete that gallery");
    }
  }

  async function onGalleryDeleteSelected(ids: string[]): Promise<boolean> {
    const drop = new Set(ids);
    const next = galleryItems.filter((item) => !drop.has(item.id));
    if (next.length === galleryItems.length) return false;
    return onGallerySave(next);
  }

  async function onGalleryPlace(input: {
    ids: string[];
    mode: "copy" | "move";
    targetId: string | null;
    newName: string;
  }): Promise<boolean> {
    const chosen = galleryItems.filter((item) => input.ids.includes(item.id) && item.key);
    if (chosen.length === 0 || gallerySaving) return false;
    const payload = galleryPayload(chosen);
    setGallerySaving(true);
    setGalleryStatus(null);
    try {
      let note: string | null = null;
      if (input.targetId) {
        const { gallery } = await api.gallery(input.targetId);
        const have = new Set(gallery.items.map((item) => item.key));
        const extra = payload.filter((item) => !have.has(item.key));
        const room = GALLERY_ITEM_CAP - gallery.items.length;
        const accepted = extra.slice(0, Math.max(0, room));
        if (extra.length === 0) note = "Those items are already in that gallery";
        else if (accepted.length < extra.length) note = `A gallery holds ${GALLERY_ITEM_CAP} items`;
        if (accepted.length > 0) {
          await api.saveGallery({
            id: gallery.id,
            name: gallery.name,
            items: [...galleryPayload(gallery.items), ...accepted],
          });
        } else if (input.mode === "copy") {
          setGalleryStatus(note);
          return false;
        }
      } else {
        const name = input.newName.trim();
        if (!name) return false;
        const accepted = payload.slice(0, GALLERY_ITEM_CAP);
        if (accepted.length < payload.length) note = `A gallery holds ${GALLERY_ITEM_CAP} items`;
        await api.saveGallery({ name, items: accepted });
      }
      if (input.mode === "move" && galleryId) {
        const drop = new Set(input.ids);
        const next = galleryItems.filter((item) => !drop.has(item.id));
        const saved = await api.saveGallery({
          id: galleryId,
          name: galleryName.trim() || "Gallery",
          items: galleryPayload(next),
        });
        setGalleryId(saved.gallery.id);
        setGalleryName(saved.gallery.name);
        setGalleryItems(saved.gallery.items.map(draftFromGalleryItem));
      }
      const listed = await api.galleries();
      setGallerySummaries(listed.galleries);
      if (note) setGalleryStatus(note);
      return true;
    } catch (err) {
      setGalleryStatus(err instanceof Error ? err.message : "Couldn’t update that gallery");
      return false;
    } finally {
      setGallerySaving(false);
    }
  }

  function galleryPayload(
    items: { kind: GalleryItem["kind"]; name: string; key: string; role?: string | null }[],
  ) {
    return items.map((item) => ({
      kind: item.kind,
      name: item.name,
      key: item.key,
      role: item.kind === "audio" ? null : normalizeMediaRole(item.role),
    }));
  }

  async function onGalleryRoleChange(index: number, role: MediaRole) {
    const current = galleryItems[index];
    if (!current || current.kind === "audio") return;
    if (normalizeMediaRole(current.role) === role) return;
    const next = galleryItems.map((item, itemIndex) =>
      itemIndex === index ? { ...item, role } : item,
    );
    setGalleryItems(next);
    if (galleryId && galleryName.trim()) await onGallerySave(next);
  }

  async function addHistoryToGallery(
    targetId: string,
    items: HistoryGalleryItem[],
  ): Promise<HistoryGalleryNotice> {
    if (items.length === 0 || gallerySaving) return { kind: "error", message: "Nothing to add" };
    setGallerySaving(true);
    setGalleryStatus(null);
    try {
      const { gallery } = await api.gallery(targetId);
      const have = new Set(gallery.items.map((item) => item.key));
      const extra = items.filter((item) => !have.has(item.key));
      const accepted = extra.slice(0, Math.max(0, GALLERY_ITEM_CAP - gallery.items.length));
      if (accepted.length === 0) {
        return extra.length === 0
          ? { kind: "already", name: gallery.name }
          : { kind: "error", message: `A gallery holds ${GALLERY_ITEM_CAP} items` };
      }
      const saved = await api.saveGallery({
        id: gallery.id,
        name: gallery.name,
        items: [...galleryPayload(gallery.items), ...galleryPayload(accepted)],
      });
      if (galleryId === saved.gallery.id) {
        setGalleryName(saved.gallery.name);
        setGalleryItems(saved.gallery.items.map(draftFromGalleryItem));
      }
      const listed = await api.galleries();
      setGallerySummaries(listed.galleries);
      if (accepted.length < extra.length) {
        return { kind: "error", message: `Added ${accepted.length}. A gallery holds ${GALLERY_ITEM_CAP} items` };
      }
      return { kind: "added", count: accepted.length, name: saved.gallery.name };
    } catch (err) {
      return { kind: "error", message: err instanceof Error ? err.message : "Couldn’t add to that gallery" };
    } finally {
      setGallerySaving(false);
    }
  }

  async function createHistoryGallery(name: string, items: HistoryGalleryItem[]): Promise<HistoryGalleryNotice> {
    const trimmed = name.trim();
    if (!trimmed || items.length === 0 || gallerySaving) return { kind: "error", message: "Name the gallery" };
    setGallerySaving(true);
    setGalleryStatus(null);
    try {
      const accepted = items.slice(0, GALLERY_ITEM_CAP);
      const saved = await api.saveGallery({
        name: trimmed,
        items: galleryPayload(accepted),
      });
      const listed = await api.galleries();
      setGallerySummaries(listed.galleries);
      if (accepted.length < items.length) {
        return { kind: "error", message: `A gallery holds ${GALLERY_ITEM_CAP} items` };
      }
      return { kind: "created", count: accepted.length, name: saved.gallery.name };
    } catch (err) {
      return { kind: "error", message: err instanceof Error ? err.message : "Couldn’t create that gallery" };
    } finally {
      setGallerySaving(false);
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
        document: 0,
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
          role: item.kind === "audio" ? undefined : normalizeMediaRole(item.role),
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
    setLibraryItems((prev) => prev.filter((row) => !removing.has(row.id)));
    setSelectedId((prev) => siblingAfterRemoval(prev, removing, generations));
    setPeekId((prev) => siblingAfterRemoval(prev, removing, generations));
    setError(null);
    try {
      const results = await Promise.all(ids.map((id) => api.deleteGeneration(id, { fromOxen })));
      const oxenFailed = results.reduce((sum, result) => sum + (result.oxenFailed ?? 0), 0);
      if (fromOxen && oxenFailed > 0) {
        setError("Removed from Studio. Oxen still has that file.");
      }
      if (libraryOpen) void refreshLibrary();
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
      if (mode === "chat") {
        const images: { url: string; name: string }[] = [];
        const files: { url: string; name: string }[] = [];
        for (const item of takeStagedOfKind(staged, "image", capForKind("image"))) {
          const url = item.url ?? (item.file ? (await api.upload(item.file)).url : "");
          if (url) images.push({ url, name: item.name });
        }
        for (const doc of documents.slice(0, capForKind("document"))) {
          const uploaded = await api.upload(doc.file);
          if (uploaded.url) files.push({ url: uploaded.url, name: doc.name });
        }
        const turns: ChatTurn[] = [
          ...chatTurns,
          { role: "user", text: prompt.trim(), images, files },
        ];
        const { reply } = await api.chat({
          model,
          messages: chatMessagesFromTurns(turns),
        });
        setChatTurns([...turns, { role: "assistant", text: reply, images: [], files: [] }]);
        setPrompt("");
        setDocuments([]);
        setStaged((prev) => {
          for (const item of prev) {
            if (item.kind === "image") releasePreview(item.preview);
          }
          return prev.filter((item) => item.kind !== "image");
        });
        return;
      }
      const images: string[] = [];
      const videos: string[] = [];
      const audios: string[] = [];
      const imageRoles: MediaRole[] = [];
      const videoRoles: MediaRole[] = [];
      const sendable = [
        ...takeStagedOfKind(staged, "image", capForKind("image")),
        ...takeStagedOfKind(staged, "video", capForKind("video")),
        ...takeStagedOfKind(staged, "audio", capForKind("audio")),
      ];
      for (const item of sendable) {
        const url = item.url ?? (item.file ? (await api.upload(item.file)).url : "");
        if (!url) continue;
        const role = normalizeMediaRole(item.role);
        if (item.kind === "image") {
          images.push(url);
          imageRoles.push(role);
        } else if (item.kind === "video") {
          videos.push(url);
          videoRoles.push(role);
        } else audios.push(url);
      }

      const extraShots = shots
        .filter((shot) => shot.prompt.trim())
        .map((shot) => ({
          prompt: shot.prompt.trim(),
          duration: Number(shot.duration) || Number(duration) || 5,
        }));
      const multiPrompt =
        controls?.multiPrompt && extraShots.length > 0
          ? [
              ...(prompt.trim()
                ? [{ prompt: prompt.trim(), duration: Number(duration) || 5 }]
                : []),
              ...extraShots,
            ].slice(0, 6)
          : null;
      const payload: Record<string, unknown> = {
        mode,
        model,
        num_generations: numGenerations,
      };
      if (multiPrompt) payload.multi_prompt = multiPrompt;
      else payload.prompt = prompt.trim();
      const sendAspect =
        mode !== "text-to-audio" ||
        Boolean(controls?.aspectRatios && controls.aspectRatios.length > 0);
      const task = controls?.referenceTask?.includes(referenceTask) ? referenceTask : undefined;
      if (sendAspect) {
        const lockedAspect = applyControlLock(controls?.aspectLock, task, aspectRatio);
        payload.aspect_ratio = lockedAspect == null || lockedAspect === "" ? aspectRatio : String(lockedAspect);
      }
      if (modeIsVideo(mode) && task) payload.omni_reference_task_type = task;
      if (modeIsVideo(mode)) {
        const sent = durationToSend(duration, controls?.duration ?? null);
        const locked = lockedDuration(controls?.durationLock, task, controls?.duration ?? null, sent);
        if (locked != null && locked !== "") payload.duration = locked;
      }
      if (seed.trim()) payload.seed = Number(seed);
      if (controls?.generateAudio) payload.generate_audio = generateAudio;
      if (controls?.draft) payload.draft = draft;
      if (lastFrameVisible && getLastFrame) payload.get_last_frame = true;
      if (quality) payload.quality = quality;
      const sentResolution = lockedResolution(
        draft,
        controls?.resolutionDraftLock,
        resolution || undefined,
      );
      if (sentResolution) payload.resolution = sentResolution;
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

  async function onRenderFinal(generation: Generation) {
    if (!generation.draftTaskId || busy) return;
    const renderMode = generation.mode;
    if (
      renderMode !== "text-to-video" &&
      renderMode !== "reference-to-video" &&
      renderMode !== "video-to-video"
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { generations: created } = await api.generate({
        mode: renderMode,
        model: generation.model,
        draft_task_id: generation.draftTaskId,
        prompt: "",
      });
      setKeepCanvasClear(false);
      setPeekId(null);
      setGenerations((prev) => mergeGenerations(prev, created));
      setSelectedId(created[0]?.id ?? null);
      void refreshCredits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "1080p render failed");
    } finally {
      setBusy(false);
    }
  }

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
        generations={libraryItems}
        selectedId={peekId}
        loading={libraryLoading}
        loadError={libraryError}
        tagInput={libraryTagInput}
        appliedTag={libraryTag}
        allTags={libraryTags}
        onTagInput={setLibraryTagInput}
        page={libraryPage}
        pageCount={libraryPageCount}
        onPage={setLibraryPage}
        downloadingAll={downloadingAll}
        onSelect={setPeekId}
        open={libraryOpen}
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
        gallerySummaries={gallerySummaries}
        galleryId={galleryId}
        onGalleryOpen={(id) => void onGalleryLoad(id)}
        onManageGallerySave={() => void onGallerySave()}
        onGalleryAttach={onGalleryAttach}
        onGalleryRoleChange={(index, role) => void onGalleryRoleChange(index, role)}
        onGalleryFeature={(index) => void onGalleryFeature(index)}
        onGalleryDelete={(id) => void onGalleryDelete(id)}
        onGalleryRename={(id, name) => void onGalleryRename(id, name)}
        onGalleryDeleteSelected={onGalleryDeleteSelected}
        onGalleryPlace={onGalleryPlace}
        onHistoryAddToGallery={addHistoryToGallery}
        onHistoryCreateGallery={createHistoryGallery}
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
              <ProfileSwitch
                profiles={profiles}
                activeId={activeProfileId}
                onActivate={(id) => void onActivateProfile(id)}
                onCreate={(name) => void onCreateProfile(name)}
                onRename={(id, name) => void onRenameProfile(id, name)}
                onDelete={(id) => void onDeleteProfile(id)}
              />
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
            {mode === "chat" ? (
              <ChatThread turns={chatTurns} busy={busy} />
            ) : (
              <Canvas
                generation={selected}
                variants={selectedVariants}
                onSelect={setSelectedId}
                onTagsChange={(id, tags) => void onSaveTags(id, tags)}
                onDelete={(id) => requestDeleteMedia([id], true)}
                onRenderFinal={(item) => void onRenderFinal(item)}
                renderBusy={busy}
              />
            )}
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
            onDurationChange={rememberParam((value) => {
              durationPinned.current = true;
              setDuration(value);
            })}
            seed={seed}
            onSeedChange={setSeed}
            numGenerations={numGenerations}
            onNumGenerationsChange={setNumGenerations}
            generateAudio={generateAudio}
            onGenerateAudioChange={rememberParam(setGenerateAudio)}
            draft={draft}
            onDraftChange={setDraft}
            shots={shots}
            onShotsChange={setShots}
            documents={documents}
            onClearDocument={(index) =>
              setDocuments((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
            }
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
            onGalleryRoleChange={(index, role) => void onGalleryRoleChange(index, role)}
            quality={quality}
            onQualityChange={rememberParam(setQuality)}
            resolution={resolution}
            onResolutionChange={rememberParam(setResolution)}
            outputFormat={outputFormat}
            onOutputFormatChange={rememberParam(setOutputFormat)}
            referenceTask={referenceTask}
            onReferenceTaskChange={(value) => {
              paramsTouched.current = true;
              setReferenceTask(value);
              const lock = controls?.aspectLock;
              if (lock && lock.tasks.includes(value)) setAspectRatio(lock.value);
            }}
            onAttachmentRoleChange={onAttachmentRoleChange}
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
          onSettingsChange={onStudioSettings}
          onFavoritesChange={refreshFavorites}
          onLibraryCleanup={onLibraryCleanup}
          branding={branding}
          onBrandingChange={setBranding}
        />
      ) : null}
      <HelpDock />
    </div>
  );
}
