import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./auth/AuthContext";
import { AccountMenu } from "./components/AccountMenu";
import { Canvas } from "./components/Canvas";
import { ChatThread } from "./components/ChatThread";
import { HelpDock } from "./components/HelpDock";
import { Composer, type PromptField } from "./components/Composer";
import { VideoThumbSecondsProvider } from "./components/GalleryThumb";
import { CreditMeter } from "./components/CreditMeter";
import { LibraryPeek } from "./components/LibraryPeek";
import { LoginPage } from "./components/LoginPage";
import { PhoneNav } from "./components/PhoneNav";
import { Loader } from "./components/Loader";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { PanelPlaceProvider, readPanelPlace, storePanelPlace, type PanelPlace } from "./components/PanelPlace";
import { ProjectRail } from "./components/ProjectRail";
import { ProjectCast } from "./components/ProjectCast";
import { ProjectBrief } from "./components/ProjectBrief";
import { ProjectJobs } from "./components/ProjectJobs";
import { ProjectHeader, type ProjectPanelView } from "./components/ProjectHeader";
import {
  composerStateForNewJob,
  composerStateOnOpen,
  defaultsAfterRun,
  pinnedDefaults,
  unpinnedDefaults,
  type ComposerOrigin,
  type ProjectComposerState,
} from "./lib/project-model";
import {
  castFilesForJob,
  castMatchingJob,
  composerStateForJob,
  rerunBodyForJob,
} from "./lib/project-jobs";
import {
  castNumberMap,
  castRequestBody,
  castWithEntryActive,
  castWithEntryMoved,
  castWithFiles,
  castWithGallery,
  castWithItemActive,
  castWithItemRole,
  castWithoutEntry,
  castWithoutItem,
  castSummaryLabel,
  droppedMentionNotice,
  flattenCast,
  missingMention,
  rewriteMentions,
  selectCastAttachments,
  type CastEntry,
  type CastItem,
} from "./lib/cast";
import {
  api,
  estimateGenerationCost,
  firstSupportedMode,
  mentionToken,
  modeIsVideo,
  modelSupportsMode,
  MODE_LABELS,
  slotRequired,
  type ComposerDefaults,
  type ComposerDraft,
  type ComposerSettings,
  type CreditBalance,
  type Generation,
  type LibraryMediaFilter,
  type GenerationMode,
  type ModelControls,
  type OxenModel,
  type Gallery,
  type GalleryItem,
  type GallerySummary,
  type ProjectJob,
  type ProjectJobOutput,
  type ReferenceModel,
  type SavedPrompt,
  type StudioProfile,
  type StudioSettings,
  type ProjectSummary,
  type StudioProject,
  type StudioLook,
} from "./lib/api";
import {
  activeGenerationKey,
  generationPollChanged,
  groupGenerationBatches,
  isActiveGeneration,
  isUnfinishedGeneration,
  mergeGenerations,
  siblingAfterRemoval,
} from "./lib/batches";
import { brandMarkClass, useInstanceBranding } from "./lib/branding";
import { notifyGenerationLocal } from "./lib/pwa";
import { completedMedia, downloadAllMedia, downloadFilename, downloadMedia } from "./lib/download";
import {
  deleteBatches,
  deleteOutcome,
  tallyDelete,
  type DeleteOutcome,
  type DeleteResult,
  type DeleteScope,
} from "./lib/media-delete";
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
import { galleryPreviewIsImage } from "./lib/gallery-thumbs";
import {
  appendHistoryToGallery,
  historyItemsForGallery,
  toggleHistoryInGallery,
  type HistoryGalleryItem,
  type HistoryGalleryNotice,
} from "./lib/gallery-history";
import { insertAttachMentions, moveItem } from "./lib/mentions";
import { keepDraftIds, type GalleryDraftItem } from "./lib/gallery-draft";
import { escapeTaken } from "./lib/escape-layer";
import { galleryChordTaken } from "./lib/shortcut-layer";
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
  referenceTaskNeedsVideo,
  safetyCheckerRequestValue,
  safetyToleranceSelection,
  type MediaRole,
} from "../worker/schema";
import { GALLERY_MAX_ITEMS as GALLERY_ITEM_CAP } from "../worker/gallery-limits";
import { appliedLooks, joinLooks, toggleLookId } from "../worker/looks";
import { DEFAULT_HISTORY_PAGE_SIZE } from "../worker/history-page-size";
import { DEFAULT_VIDEO_THUMB_SECONDS } from "../worker/video-thumb";
import { deliveryForRun } from "./lib/model-prompt";
import { defaultGalleryHandle } from "../worker/gallery-handle";
import {
  expandNameText,
  mentionedGalleryIds,
  namePlanNotice,
  planNameAttachments,
  removeNameToken,
  type NameCatalogGallery,
  type NameCatalogItem,
} from "./lib/name-mentions";

type StagedMedia = {
  file?: File;
  preview: string;
  kind: "image" | "video" | "audio";
  name: string;
  url?: string;
  key?: string;
  generationId?: string;
  role?: MediaRole | "scene";
  /** Project-owned reference number while a project is open. */
  number?: number;
};

const LIBRARY_LOAD_TIMEOUT_MS = 20_000;

function stagedFromCast(items: CastItem[]): StagedMedia[] {
  return items.flatMap((item) =>
    item.url
      ? [
          {
            kind: item.kind,
            name: item.name,
            key: item.key,
            url: item.url,
            preview: item.preview || item.url,
            role: item.role,
            number: item.number,
          },
        ]
      : [],
  );
}

function phoneLayout(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function isGenerationMode(value: string | null | undefined): value is GenerationMode {
  return typeof value === "string" && value in MODE_LABELS;
}

const DRAFT_SAVE_DELAY_MS = 800;

function initialLibraryOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("ds-studio-library-open") === "1";
  } catch {
    return false;
  }
}

function draftFromGalleryItem(item: GalleryItem): GalleryDraftItem {
  const still = item.thumbUrl && galleryPreviewIsImage(item.thumbUrl) ? item.thumbUrl : "";
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    preview: still || (item.kind === "audio" ? "" : item.url),
    key: item.key,
    url: item.url,
    role: item.kind === "audio" ? undefined : item.role ? normalizeMediaRole(item.role) : undefined,
    label: item.label ?? undefined,
  };
}

const OXEN_KEY_UNREADABLE_MESSAGE = "Your saved Oxen API key can't be read. Re-enter it in Settings.";

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
  const [safetyCheckerOn, setSafetyCheckerOn] = useState(false);
  const [moderation, setModeration] = useState("");
  const [getLastFrame, setGetLastFrame] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [projectSummaries, setProjectSummaries] = useState<ProjectSummary[]>([]);
  const [looks, setLooks] = useState<StudioLook[]>([]);
  const [activeProject, setActiveProject] = useState<StudioProject | null>(null);
  const [projectJobs, setProjectJobs] = useState<ProjectJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [jobsNotice, setJobsNotice] = useState<string | null>(null);
  const [lookIds, setLookIds] = useState<string[]>([]);
  const [shareName, setShareName] = useState<string | null>(null);
  const [shareLooks, setShareLooks] = useState<StudioLook[]>([]);
  const [projectView, setProjectView] = useState<ProjectPanelView>("list");
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [castNotice, setCastNotice] = useState<string | null>(null);
  const [briefSavedPrompt, setBriefSavedPrompt] = useState("");
  const [composerOrigin, setComposerOrigin] = useState<ComposerOrigin>("draft");
  const [referenceModels, setReferenceModels] = useState<ReferenceModel[] | null>(null);
  const [referenceModelsError, setReferenceModelsError] = useState<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [panelPlace, setPanelPlace] = useState<PanelPlace>(readPanelPlace);
  const [managingGallery, setManagingGallery] = useState(false);
  const [gallerySkipped, setGallerySkipped] = useState<string[]>([]);
  const [galleryTileDrag, setGalleryTileDrag] = useState(false);
  const [gallerySummaries, setGallerySummaries] = useState<GallerySummary[]>([]);
  const [galleryId, setGalleryId] = useState<string | null>(null);
  const [galleryName, setGalleryName] = useState("");
  const [galleryHandle, setGalleryHandle] = useState("");
  const [galleryTake, setGalleryTake] = useState(1);
  const [galleryItems, setGalleryItems] = useState<GalleryDraftItem[]>([]);
  const [galleryDetails, setGalleryDetails] = useState<Map<string, Gallery>>(new Map());
  const [nameRoles, setNameRoles] = useState<Record<string, MediaRole>>({});
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
  const [deleteNotice, setDeleteNotice] = useState<DeleteOutcome | null>(null);
  const deleteNoticeTimer = useRef<number | null>(null);
  const [staged, setStaged] = useState<StagedMedia[]>([]);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [keepCanvasClear, setKeepCanvasClear] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(initialLibraryOpen);
  const [libraryPane, setLibraryPane] = useState<"history" | "galleries">("history");
  const [peekId, setPeekId] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryItems, setLibraryItems] = useState<Generation[]>([]);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [libraryTags, setLibraryTags] = useState<string[]>([]);
  const [libraryPage, setLibraryPage] = useState(1);
  const [libraryTagInput, setLibraryTagInput] = useState("");
  const [libraryTag, setLibraryTag] = useState("");
  const [libraryMedia, setLibraryMedia] = useState<LibraryMediaFilter>("");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [clearingFailed, setClearingFailed] = useState(false);
  const hydratedParamsUserId = useRef<string | null>(null);
  const referenceTaskRef = useRef("");
  const controlsReady = useRef(false);
  const paramsTouched = useRef(false);
  const durationPinned = useRef(false);
  const promptField = useRef<PromptField | null>(null);
  const attachDraft = useRef<{ text: string; caret: number } | null>(null);
  /** Settings to put back once the model's controls have loaded and run their resets. */
  const pendingSettings = useRef<{ model: string; settings: ComposerSettings } | null>(null);
  /** A model chosen together with its mode. The mode's model list keeps it instead of the user's mode default. */
  const modelHold = useRef<string | null>(null);
  const draftSkip = useRef(false);
  const draftTimer = useRef<number | null>(null);
  const draftPending = useRef<{ projectId: string; draft: ComposerDraft } | null>(null);
  const composerDraftRef = useRef<ComposerDraft>({ prompt: "", mode: null, model: "", settings: {} });
  const stagedRef = useRef(staged);
  const nameFetchSkip = useRef(new Set<string>());
  stagedRef.current = staged;
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const lastFrameAttempted = useRef(new Set<string>());
  const createGalleryOpenRef = useRef(false);
  const cancelCreateGalleryRef = useRef<() => void>(() => {});
  const toggleGalleryPanelRef = useRef<() => void>(() => {});
  /** Counts edits made inside an open gallery, so a save that returns late does not undo a newer one. */
  const galleryEdit = useRef(0);
  const galleryAutosave = useRef(false);
  const saveGalleryRef = useRef<() => void>(() => {});

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
  const attachedMediaKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of staged) {
      if (item.key) keys.add(item.key);
      if (item.url) keys.add(item.url);
    }
    return keys;
  }, [staged]);

  const closeLibrary = useCallback(() => {
    setLibraryOpen(false);
    setLibraryPane("history");
    setManagingGallery(false);
    setGalleryTileDrag(false);
    cancelCreateGalleryRef.current();
    if (window.matchMedia("(max-width: 860px)").matches) setPeekId(null);
  }, []);

  const chooseLibraryPane = useCallback((pane: "history" | "galleries") => {
    setLibraryPane(pane);
  }, []);

  function openLibraryPane(pane: "history" | "galleries") {
    if (libraryOpen && libraryPane === pane) {
      closeLibrary();
      return;
    }
    setProjectsOpen(false);
    setShowSettings(false);
    setPeekId(null);
    setManagingGallery(false);
    setLibraryPane(pane);
    setLibraryOpen(true);
  }

  /** The prompt's Gallery button: the same panel, on the gallery last opened or on the list. */
  function toggleGalleryPanel() {
    if (libraryOpen && libraryPane === "galleries") {
      closeLibrary();
      return;
    }
    if (createGalleryOpen) cancelCreateGallery();
    setProjectsOpen(false);
    setShowSettings(false);
    setPeekId(null);
    setManagingGallery(Boolean(galleryId));
    setLibraryPane("galleries");
    setLibraryOpen(true);
  }
  toggleGalleryPanelRef.current = toggleGalleryPanel;

  function openProjectsPane() {
    if (projectsOpen) {
      setProjectsOpen(false);
      return;
    }
    setLibraryOpen(false);
    setLibraryPane("history");
    setShowSettings(false);
    setPeekId(null);
    setProjectsOpen(true);
  }

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
      media: libraryMedia,
    });
    setLibraryItems(data.generations);
    setLibraryTotal(data.total ?? data.generations.length);
    setLibraryTags(data.tags ?? []);
    setGenerations((prev) => mergeGenerations(prev, data.generations));
  }, [historyPageSize, libraryMedia, libraryPage, libraryTag]);

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
    setLibraryMedia("");
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

  useEffect(() => {
    if (user?.oxenKeyUnreadable) {
      setLibraryOpen(false);
      setLibraryPane("history");
      setProjectsOpen(false);
      setShowSettings(true);
      setError(OXEN_KEY_UNREADABLE_MESSAGE);
    } else if (user?.hasOxenKey) {
      setError((current) => (current === OXEN_KEY_UNREADABLE_MESSAGE ? null : current));
    }
  }, [user?.oxenKeyUnreadable, user?.hasOxenKey]);

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
          videoThumbSeconds: DEFAULT_VIDEO_THUMB_SECONDS,
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

  const wantReferenceModels = Boolean(user && activeProject && projectView === "brief" && referenceModels == null);
  useEffect(() => {
    if (!wantReferenceModels) return;
    let cancelled = false;
    void api
      .referenceModels()
      .then((data) => {
        if (cancelled) return;
        setReferenceModels(data.models);
        setReferenceModelsError(null);
      })
      .catch((err) => {
        if (!cancelled) setReferenceModelsError(err instanceof Error ? err.message : "Couldn’t load the model list");
      });
    return () => {
      cancelled = true;
    };
  }, [wantReferenceModels]);

  useEffect(() => {
    if (!user) {
      setProjectSummaries([]);
      setLooks([]);
      setReferenceModels(null);
      return;
    }
    let cancelled = false;
    void api
      .projects()
      .then((data) => {
        if (cancelled) return;
        setProjectSummaries(data.projects);
        setLooks(data.looks);
        setActiveProject((current) => {
          if (!current) return current;
          return data.projects.some((item) => item.id === current.id) ? current : null;
        });
      })
      .catch(() => {
        if (!cancelled) setProjectError("Projects are not available yet.");
      });
    return () => {
      cancelled = true;
    };
  }, [user, activeProfileId]);

  useEffect(() => {
    if (!user) return;
    const token = new URLSearchParams(window.location.search).get("share");
    if (!token) return;
    let cancelled = false;
    void api
      .sharedProject(token)
      .then(({ share }) => {
        if (cancelled) return;
        setShareName(share.name);
        setShareLooks(share.looks);
        setActiveProject(null);
        setProjectJobs([]);
        setLookIds([]);
        setPrompt(share.prompt);
        const shared = selectCastAttachments(flattenCast(share.cast), {
          budget: share.budget,
          caps: { image: GALLERY_ITEM_CAP, video: GALLERY_ITEM_CAP, audio: GALLERY_ITEM_CAP },
        });
        setStaged((prev) => {
          for (const item of prev) releasePreview(item.preview);
          return stagedFromCast(shared.attached);
        });
        setSelectedId(null);
        setKeepCanvasClear(true);
      })
      .catch((err) => {
        if (!cancelled) setProjectError(err instanceof Error ? err.message : "That share link is closed");
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
    storePanelPlace(panelPlace);
  }, [panelPlace]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (escapeTaken(event)) return;
        if (createGalleryOpenRef.current) {
          event.preventDefault();
          cancelCreateGalleryRef.current();
          return;
        }
        if (showSettings) {
          event.preventDefault();
          setShowSettings(false);
          return;
        }
        if (projectsOpen) {
          event.preventDefault();
          setProjectsOpen(false);
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
        else {
          setProjectsOpen(false);
          setShowSettings(false);
          setLibraryPane("history");
          setLibraryOpen(true);
        }
        return;
      }
      if (event.code === "Comma") {
        event.preventDefault();
        setLibraryOpen(false);
        setProjectsOpen(false);
        setShowSettings(true);
        return;
      }
      if (event.code === "KeyG") {
        if (galleryChordTaken(event)) return;
        event.preventDefault();
        toggleGalleryPanelRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peekId, libraryOpen, closeLibrary, showSettings, projectsOpen]);

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
          const held = modelHold.current;
          modelHold.current = null;
          const next = pickModel(
            data.models,
            favorites,
            held && data.models.some((item) => item.id === held)
              ? held
              : mode
                ? settings?.defaultModelByMode[mode]
                : undefined,
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
        setSafetyCheckerOn(false);
        if (data.controls.moderation) {
          setModeration(data.controls.moderation.defaultValue);
        } else {
          setModeration("");
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
        const pending = pendingSettings.current;
        if (pending && pending.model === model) {
          pendingSettings.current = null;
          applyComposerSettings(pending.settings, data.controls);
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
    const durationControl = controls?.duration;
    if (!durationControl || duration.trim() === "") return;
    const next = durationFieldValue(duration, durationControl);
    if (next !== duration) setDuration(next);
  }, [controls, duration]);

  const activeKey = activeGenerationKey(generations);
  const generationsRef = useRef(generations);
  generationsRef.current = generations;

  useEffect(() => {
    if (!activeKey) return;
    const ids = activeKey.split("\n");
    let cancelled = false;

    async function poll() {
      const incoming = (
        await Promise.all(
          ids.map(async (id) => {
            try {
              const { generation } = await api.getGeneration(id);
              return generation;
            } catch {
              return null;
            }
          }),
        )
      ).filter((item): item is Generation => item !== null);
      if (cancelled || incoming.length === 0) return;
      const previous = new Map(generationsRef.current.map((item) => [item.id, item]));
      const changed = incoming.filter((item) => {
        const before = previous.get(item.id);
        return !before || generationPollChanged(before, item);
      });
      if (changed.length === 0) return;
      setGenerations((prev) => mergeGenerations(prev, changed));
      for (const generation of changed) {
        const before = previous.get(generation.id);
        if (!before || !isActiveGeneration(before)) continue;
        if (generation.status !== "succeeded" && generation.status !== "failed") continue;
        void refreshCredits();
        void notifyGenerationLocal({
          id: generation.id,
          status: generation.status,
          prompt: generation.prompt,
          mediaType: generation.mediaType,
          errorMessage: generation.errorMessage,
        });
      }
    }

    const timer = window.setInterval(() => {
      void poll();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeKey, refreshCredits]);

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

  const castEntries: CastEntry[] = activeProject?.cast ?? [];
  const castItems = flattenCast(castEntries);
  const castCaps = {
    image: capForKind("image"),
    video: capForKind("video"),
    audio: capForKind("audio"),
  };
  const castSelection = selectCastAttachments(castItems, {
    budget: activeProject?.budget ?? 0,
    caps: castCaps,
  });
  const projectStaging = Boolean(activeProject && !shareName);
  const castStageKey = projectStaging
    ? castSelection.attached.map((item) => `${item.id}|${item.number}|${item.role ?? ""}|${item.url ?? ""}`).join("\n")
    : null;
  const castAttachedRef = useRef(castSelection.attached);
  castAttachedRef.current = castSelection.attached;

  useEffect(() => {
    if (castStageKey == null) return;
    const attached = castAttachedRef.current;
    setStaged((prev) => {
      for (const item of prev) releasePreview(item.preview);
      return stagedFromCast(attached);
    });
  }, [castStageKey]);

  function mentionStart(kind: "image" | "video" | "audio", existing: StagedMedia[]) {
    void kind;
    return existing.length;
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
    if (projectStaging) {
      void projectAddFiles(incoming);
      return;
    }
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
    if (projectStaging) {
      if (!generation.resultKey) {
        setError("That file has no Studio copy yet, so it can’t join the references.");
        return;
      }
      projectAddRefs([{ kind: ref.kind, name: ref.name, key: generation.resultKey, url: ref.url }]);
      return;
    }
    let current = stagedRef.current;
    if (
      controls?.imageAudioExclusive &&
      ((ref.kind === "image" && current.some((item) => item.kind === "audio")) ||
        (ref.kind === "audio" && current.some((item) => item.kind === "image")))
    ) {
      setError("This model accepts a reference image or reference audio, not both.");
      return;
    }
    if (
      controls?.imageVideoExclusive &&
      ((ref.kind === "image" && current.some((item) => item.kind === "video")) ||
        (ref.kind === "video" && current.some((item) => item.kind === "image")))
    ) {
      const clearKind = ref.kind === "image" ? "video" : "image";
      for (const item of current) {
        if (item.kind === clearKind) releasePreview(item.preview);
      }
      current = current.filter((item) => item.kind !== clearKind);
      setError("Keyframes and a continuation clip can’t be used together.");
    }
    const cap = capForKind(ref.kind);
    if (cap <= 0) return;
    if (current.some((item) => item.generationId === ref.generationId)) return;
    const existing = current.filter((item) => item.kind === ref.kind);
    const start = mentionStart(ref.kind, existing);
    const next = mergeLibraryRefs(
      current,
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
    );
    const added = next.filter((item) => item.kind === ref.kind).length > existing.length;
    if (!added) return;
    stagedRef.current = next;
    setStaged(next);
    appendMentionTokens(ref.kind, start, 1);
  }

  function startNew() {
    if (activeProject) closeProject();
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

  const nameCatalog = useMemo((): NameCatalogGallery[] => {
    const galleries: NameCatalogGallery[] = [];
    for (const summary of gallerySummaries) {
      const detail = galleryDetails.get(summary.id);
      const fresh = detail && detail.updatedAt === summary.updatedAt ? detail : null;
      const handle = (fresh?.handle || summary.handle || "").trim();
      if (!handle) continue;
      const source = fresh?.items ?? summary.items ?? [];
      const items: NameCatalogItem[] = source.map((item) => ({
        key: item.key,
        kind: item.kind,
        name: item.name,
        role: item.role ?? null,
        label: item.label ?? null,
        url: "url" in item ? (item.url ?? null) : null,
        thumbUrl: item.thumbUrl ?? null,
      }));
      galleries.push({
        id: summary.id,
        name: summary.name,
        handle,
        take: fresh?.takeCount || summary.takeCount || 1,
        items,
      });
    }
    return galleries;
  }, [galleryDetails, gallerySummaries]);
  const imageCap = capForKind("image");
  const videoCap = capForKind("video");
  const audioCap = capForKind("audio");
  const namesOn = Boolean(mode && mode !== "chat" && controls?.mentions);
  const namePlan = useMemo(
    () =>
      planNameAttachments({
        prompt: namesOn ? prompt : "",
        galleries: namesOn ? nameCatalog : [],
        hand: staged.map((item) => ({ key: item.key, kind: item.kind, number: item.number })),
        caps: { image: imageCap, video: videoCap, audio: audioCap },
      }),
    [audioCap, imageCap, nameCatalog, namesOn, prompt, staged, videoCap],
  );
  const shown = useMemo(() => {
    const marks = new Map(namePlan.marks.map((mark) => [mark.key, mark.token]));
    const hand = staged.map((item) => ({
      name: item.name,
      preview: item.preview,
      kind: item.kind,
      role: item.role,
      number: item.number,
      key: item.key,
      url: item.url,
      via: item.key ? marks.get(item.key) : undefined,
      origin: "hand" as const,
    }));
    const named = namePlan.files.map((file) => ({
      name: file.name,
      preview: file.thumbUrl || file.url || "",
      kind: file.kind,
      role: file.kind === "audio" ? undefined : (nameRoles[file.key] ?? file.role ?? undefined),
      number: file.number,
      key: file.key,
      url: file.url ?? undefined,
      via: file.token,
      origin: "name" as const,
    }));
    return [...hand, ...named];
  }, [namePlan, nameRoles, staged]);

  useEffect(() => {
    nameFetchSkip.current.clear();
  }, [gallerySummaries]);

  useEffect(() => {
    if (!namesOn) return;
    const ids = mentionedGalleryIds(prompt, nameCatalog).filter((id) => {
      if (nameFetchSkip.current.has(id)) return false;
      const detail = galleryDetails.get(id);
      const summary = gallerySummaries.find((item) => item.id === id);
      return !detail || !summary || detail.updatedAt !== summary.updatedAt;
    });
    if (ids.length === 0) return;
    let cancelled = false;
    void Promise.all(
      ids.map(async (id) => {
        try {
          return (await api.gallery(id)).gallery;
        } catch {
          return null;
        }
      }),
    ).then((loaded) => {
      if (cancelled) return;
      setGalleryDetails((prev) => {
        const next = new Map(prev);
        let changed = false;
        loaded.forEach((gallery, index) => {
          const id = ids[index];
          if (!id) return;
          if (gallery) {
            next.set(gallery.id, gallery);
            changed = true;
          } else nameFetchSkip.current.add(id);
        });
        return changed ? next : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [galleryDetails, gallerySummaries, nameCatalog, namesOn, prompt]);

  function castItemForStaged(item: StagedMedia | undefined): CastItem | null {
    if (!item || item.number == null) return null;
    return castItems.find((entry) => entry.kind === item.kind && entry.number === item.number) ?? null;
  }

  function onClearAttachment(kind: "image" | "video" | "audio", index: number) {
    const ofKind = shown.filter((item) => item.kind === kind);
    const target = ofKind[index];
    if (target?.origin === "name" && target.via) {
      setPrompt(removeNameToken(prompt, target.via));
      return;
    }
    const handIndex = ofKind.slice(0, index + 1).filter((item) => item.origin === "hand").length - 1;
    if (handIndex < 0) return;
    if (projectStaging) {
      const castTarget = castItemForStaged(staged.filter((item) => item.kind === kind)[handIndex]);
      if (castTarget) projectRemoveItem(castTarget);
      return;
    }
    setStaged((prev) => {
      const kindItems = prev.filter((item) => item.kind === kind);
      const removed = kindItems[handIndex];
      if (removed?.preview) releasePreview(removed.preview);
      let seen = 0;
      return prev.filter((item) => {
        if (item.kind !== kind) return true;
        const current = seen;
        seen += 1;
        return current !== handIndex;
      });
    });
  }

  function onAttachmentRoleChange(index: number, role: MediaRole) {
    const target = shown[index];
    if (!target || target.kind === "audio") return;
    if (target.origin === "name" && target.key) {
      setNameRoles((prev) => ({ ...prev, [target.key!]: role }));
      return;
    }
    const handIndex = shown.slice(0, index + 1).filter((item) => item.origin === "hand").length - 1;
    if (handIndex < 0) return;
    if (projectStaging) {
      const castTarget = castItemForStaged(staged[handIndex]);
      if (castTarget && castTarget.kind !== "audio") void commitCast(castWithItemRole(castEntries, castTarget, role));
      return;
    }
    setStaged((prev) =>
      prev.map((item, itemIndex) => {
        if (itemIndex !== handIndex || item.kind === "audio") return item;
        return { ...item, role };
      }),
    );
  }

  function onReorderAttachments(from: number, to: number) {
    if (projectStaging) return;
    if (shown[from]?.origin === "name") return;
    const handCount = shown.filter((item) => item.origin === "hand").length;
    if (from < 0 || from >= handCount || to < 0 || to >= handCount) return;
    const next = moveItem(staged, from, to);
    if (next === staged) return;
    setStaged(next);
  }

  const imageCount = shown.filter((item) => item.kind === "image").length;
  const videoCount = shown.filter((item) => item.kind === "video").length;
  const audioCount = shown.filter((item) => item.kind === "audio").length;
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
  const unattachedMention =
    mode && mode !== "chat" && controls?.mentions
      ? (missingMention(prompt, staged) ?? namePlan.unresolved[0]?.token ?? null)
      : null;
  const generateBlock = unattachedMention
    ? `The prompt mentions ${unattachedMention}, which isn’t attached. Attach it in the references or take it out of the prompt.`
    : null;

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

  function onGalleryNameChange(value: string) {
    setGalleryHandle((current) => {
      const previous = defaultGalleryHandle(galleryName);
      if (!current || current === previous) return defaultGalleryHandle(value);
      return current;
    });
    setGalleryName(value);
  }

  function onGalleryNew() {
    setGalleryId(null);
    setGalleryName("");
    setGalleryHandle("");
    setGalleryTake(1);
    setGalleryItems([]);
    setGalleryStatus(null);
    setGallerySkipped([]);
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
      changeGallerySet((prev) => [...prev, ...added].slice(0, GALLERY_ITEM_CAP));
      if (rejected.length > 0) {
        setGalleryStatus(supportedMediaNotice(acceptedMediaKinds(controls, mode, currentModel())));
      }
    } catch (err) {
      setGalleryStatus(err instanceof Error ? err.message : "Couldn’t add that file");
    } finally {
      setGalleryAdding(false);
    }
  }

  /** A file added to or taken out of the open gallery. A save still in flight must not put the old set back. */
  function changeGallerySet(update: (prev: GalleryDraftItem[]) => GalleryDraftItem[]) {
    galleryEdit.current += 1;
    setGalleryItems(update);
  }

  async function onGallerySave(nextItems?: GalleryDraftItem[]): Promise<boolean> {
    const name = galleryName.trim();
    const items = nextItems ?? galleryItems;
    if (!name || gallerySaving) return false;
    const edit = galleryEdit.current;
    setGallerySaving(true);
    setGalleryStatus(null);
    try {
      const saved = await api.saveGallery({
        id: galleryId,
        name,
        handle: galleryHandle,
        takeCount: galleryTake,
        items: galleryPayload(items),
      });
      setGalleryId(saved.gallery.id);
      setGalleryName(saved.gallery.name);
      setGalleryHandle(saved.gallery.handle);
      setGalleryTake(saved.gallery.takeCount);
      setGalleryDetails((prev) => new Map(prev).set(saved.gallery.id, saved.gallery));
      // The set changed while this save was in flight: keep what is on screen.
      if (galleryEdit.current === edit) {
        setGalleryItems(keepDraftIds(items, saved.gallery.items.map(draftFromGalleryItem)));
      }
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

  function onDropHistoryMedia(ids: string[]) {
    const byId = new Map<string, Generation>();
    for (const item of [...libraryItems, ...generations]) byId.set(item.id, item);
    const batch = ids.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
    const incoming = historyItemsForGallery(batch).map((item) => ({
      ...item,
      role: item.kind === "audio" ? undefined : ("character" as const),
    }));
    if (incoming.length === 0) {
      setGalleryStatus("That media isn’t stored in Studio yet");
      return;
    }
    const result = appendHistoryToGallery(galleryItems, incoming, GALLERY_ITEM_CAP);
    changeGallerySet(() => result.items);
    if (result.skipped > 0) {
      setGalleryStatus(`A gallery holds ${GALLERY_ITEM_CAP} items`);
      return;
    }
    if (result.added === 0) {
      setGalleryStatus("Already in this gallery");
      return;
    }
    setGalleryStatus(null);
  }

  function onToggleHistory(batchItems: Generation[]) {
    const incoming = historyItemsForGallery(batchItems);
    if (incoming.length === 0) {
      setGalleryStatus("That media isn’t stored in Studio yet");
      return;
    }
    const result = toggleHistoryInGallery(galleryItems, incoming, GALLERY_ITEM_CAP);
    changeGallerySet(() => result.items);
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
    setGallerySkipped([]);
    try {
      const { gallery } = await api.gallery(id);
      galleryEdit.current += 1;
      galleryAutosave.current = false;
      setGalleryId(gallery.id);
      setGalleryName(gallery.name);
      setGalleryHandle(gallery.handle);
      setGalleryTake(gallery.takeCount || 1);
      setGalleryItems(gallery.items.map(draftFromGalleryItem));
      setGalleryDetails((prev) => new Map(prev).set(gallery.id, gallery));
    } catch (err) {
      setGalleryStatus(err instanceof Error ? err.message : "Couldn’t load that gallery");
    }
  }

  /** An edit made on a tile of an open gallery. It shows at once and is saved with the gallery. */
  function editGalleryItems(next: GalleryDraftItem[]) {
    if (next === galleryItems) return;
    galleryEdit.current += 1;
    galleryAutosave.current = Boolean(galleryId && galleryName.trim());
    setGalleryItems(next);
  }

  function onGalleryFeature(index: number) {
    const item = galleryItems[index];
    if (!item || index === 0) return;
    editGalleryItems([item, ...galleryItems.filter((_, itemIndex) => itemIndex !== index)]);
  }

  function onGalleryReorder(from: number, to: number) {
    editGalleryItems(moveItem(galleryItems, from, to));
  }

  saveGalleryRef.current = () => void onGallerySave();

  useEffect(() => {
    if (gallerySaving || !galleryAutosave.current) return;
    galleryAutosave.current = false;
    saveGalleryRef.current();
  }, [gallerySaving, galleryItems]);

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
        setGalleryHandle("");
        setGalleryTake(1);
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
          const used = new Set(
            gallery.items.flatMap((item) => (item.label ? [item.label.toLowerCase()] : [])),
          );
          const labeled = accepted.map((item) => {
            const key = item.label?.toLowerCase();
            if (!key || !used.has(key)) {
              if (key) used.add(key);
              return item;
            }
            return { ...item, label: null };
          });
          await api.saveGallery({
            id: gallery.id,
            name: gallery.name,
            handle: gallery.handle,
            takeCount: gallery.takeCount,
            items: [...galleryPayload(gallery.items), ...labeled],
          });
        } else if (input.mode === "copy") {
          setGalleryStatus(note);
          return false;
        }
      } else {
        const name = input.newName.trim();
        if (!name) return false;
        const usedLabels = new Set<string>();
        const accepted = payload.slice(0, GALLERY_ITEM_CAP).map((item) => {
          const key = item.label?.trim().toLowerCase();
          if (!key || usedLabels.has(key)) return { ...item, label: null };
          usedLabels.add(key);
          return item;
        });
        if (accepted.length < payload.length) note = `A gallery holds ${GALLERY_ITEM_CAP} items`;
        await api.saveGallery({ name, items: accepted });
      }
      if (input.mode === "move" && galleryId) {
        const drop = new Set(input.ids);
        const next = galleryItems.filter((item) => !drop.has(item.id));
        const saved = await api.saveGallery({
          id: galleryId,
          name: galleryName.trim() || "Gallery",
          handle: galleryHandle,
          takeCount: galleryTake,
          items: galleryPayload(next),
        });
        setGalleryId(saved.gallery.id);
        setGalleryName(saved.gallery.name);
        setGalleryHandle(saved.gallery.handle);
        setGalleryTake(saved.gallery.takeCount);
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
    items: { kind: GalleryItem["kind"]; name: string; key: string; role?: string | null; label?: string | null }[],
  ) {
    return items.map((item) => ({
      kind: item.kind,
      name: item.name,
      key: item.key,
      role: item.kind === "audio" ? null : normalizeMediaRole(item.role),
      label: item.label?.trim() ? item.label.trim() : null,
    }));
  }

  function onGalleryLabelChange(index: number, label: string) {
    setGalleryItems((prev) =>
      prev.map((item, itemIndex) => (itemIndex === index ? { ...item, label: label || undefined } : item)),
    );
  }

  function onGalleryRoleChange(index: number, role: MediaRole) {
    const current = galleryItems[index];
    if (!current || current.kind === "audio") return;
    if (normalizeMediaRole(current.role) === role) return;
    editGalleryItems(galleryItems.map((item, itemIndex) => (itemIndex === index ? { ...item, role } : item)));
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

  function attachFromGallery(items?: GalleryDraftItem[], caret?: number | null) {
    setGallerySkipped(onGalleryAttach(items, caret));
  }

  function onGalleryAttach(items?: GalleryDraftItem[], caret?: number | null): string[] {
    if (projectStaging) {
      const chosen = items ?? galleryItems;
      const withKey = chosen.filter((item): item is GalleryDraftItem & { key: string } => Boolean(item.key));
      projectAddRefs(
        withKey.map((item) => ({
          kind: item.kind,
          name: item.name,
          key: item.key,
          url: item.url ?? null,
          role: item.kind === "audio" ? null : normalizeMediaRole(item.role),
        })),
      );
      return chosen.filter((item) => !item.key).map((item) => item.name);
    }
    const faceFirst = Boolean(
      controls?.slots.some(
        (slot) => slot.field === "input_face_images" || slot.field === "input_face_videos",
      ),
    );
    const plan = planGalleryAttach({
      items: items ?? galleryItems,
      staged: stagedRef.current,
      caps: {
        image: capForKind("image"),
        video: capForKind("video"),
        audio: capForKind("audio"),
        document: 0,
      },
      prompt: promptRef.current,
      faceFirst,
    });
    if (plan.add.length > 0) {
      const next = [
        ...stagedRef.current,
        ...plan.add.map((item) => ({
          kind: item.kind,
          name: item.name,
          preview: item.url || item.preview,
          url: item.url,
          key: item.key,
          role: item.kind === "audio" ? undefined : normalizeMediaRole(item.role),
        })),
      ];
      stagedRef.current = next;
      setStaged(next);
    }
    if (plan.tokens.length > 0) {
      const field = promptField.current;
      const el = field?.element ?? null;
      // A click in the gallery panel takes focus from the prompt, so use the caret it remembers.
      const liveCaret =
        caret !== undefined
          ? caret
          : el && document.activeElement === el
            ? el.selectionStart
            : (field?.caret() ?? null);
      const result = insertAttachMentions(promptRef.current, liveCaret, plan.tokens);
      promptRef.current = result.next;
      attachDraft.current = { text: result.next, caret: result.caret };
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
    if (inferred) {
      modelHold.current = next;
      setMode(inferred);
    }
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

  function showDeleteNotice(outcome: DeleteOutcome | null) {
    if (deleteNoticeTimer.current !== null) window.clearTimeout(deleteNoticeTimer.current);
    deleteNoticeTimer.current = null;
    setDeleteNotice(outcome);
    if (!outcome) return;
    deleteNoticeTimer.current = window.setTimeout(
      () => {
        deleteNoticeTimer.current = null;
        setDeleteNotice(null);
      },
      outcome.tone === "warn" ? 12000 : 6000,
    );
  }

  /** The Delete menu already asked which copies go, so the choice runs without a second prompt. */
  async function deleteMedia(ids: string[], scope: DeleteScope) {
    if (ids.length === 0) return;
    const removing = new Set(ids);
    setGenerations((prev) => prev.filter((row) => !removing.has(row.id)));
    setLibraryItems((prev) => prev.filter((row) => !removing.has(row.id)));
    setSelectedId((prev) => siblingAfterRemoval(prev, removing, generations));
    setPeekId((prev) => siblingAfterRemoval(prev, removing, generations));
    setError(null);
    showDeleteNotice(null);
    const fromOxen = scope === "everywhere";
    const results: DeleteResult[] = [];
    const refused: string[] = [];
    // One request at a time: each one that reaches Oxen lands its own commit there.
    for (const batch of deleteBatches(ids)) {
      const count = batch.length;
      try {
        const reply =
          count === 1
            ? await api.deleteGeneration(batch[0], { fromOxen })
            : await api.deleteGenerations(batch, { fromOxen });
        results.push({ ok: true, count, reply });
      } catch {
        results.push({ ok: false, count });
        refused.push(...batch);
      }
    }
    showDeleteNotice(deleteOutcome(tallyDelete(scope, results)));
    if (libraryOpen) void refreshLibrary();
    const kept = refused.filter((id) => generations.some((row) => row.id === id));
    if (kept.length === 0) return;
    // A refused delete leaves the row on the server, so it goes back on the canvas.
    const restored = await Promise.all(
      kept.map((id) =>
        api.getGeneration(id).then(
          ({ generation }) => generation,
          () => null,
        ),
      ),
    );
    const rows = restored.filter((row): row is Generation => row !== null);
    if (rows.length > 0) setGenerations((prev) => mergeGenerations(prev, rows));
  }

  async function onClearFailed() {
    if (clearingFailed) return;
    setClearingFailed(true);
    setError(null);
    try {
      await api.cleanupLibrary("failed");
      onLibraryCleanup("failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t remove failed jobs");
    } finally {
      setClearingFailed(false);
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
        setGenerations((prev) => prev.filter((row) => !isUnfinishedGeneration(row)));
        setLibraryItems((prev) => prev.filter((row) => !isUnfinishedGeneration(row)));
        setPeekId((prev) => {
          const row = libraryItems.find((item) => item.id === prev);
          return row && isUnfinishedGeneration(row) ? null : prev;
        });
        setSelectedId((prev) => {
          const row = generations.find((item) => item.id === prev);
          return row && isUnfinishedGeneration(row) ? null : prev;
        });
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

  function replaceStaged(next: StagedMedia[]) {
    setStaged((prev) => {
      for (const item of prev) releasePreview(item.preview);
      return next;
    });
  }

  function rememberProject(project: StudioProject) {
    setActiveProject(project);
    setBriefSavedPrompt(project.prompt);
    setProjectSummaries((prev) => {
      const summary: ProjectSummary = {
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        castCount: flattenCast(project.cast).length,
        galleryCount: project.cast.filter((entry) => entry.type === "gallery").length,
        jobCount: project.jobCount,
        lastRunAt: project.lastRunAt,
      };
      return [summary, ...prev.filter((item) => item.id !== project.id)];
    });
  }

  /** The composer's settings as a project stores them. */
  function composerSettings(): ComposerSettings {
    const out: ComposerSettings = {
      aspectRatio,
      duration,
      generateAudio,
      draft,
      safetyCheckerOn,
      getLastFrame,
    };
    if (seed) out.seed = seed;
    if (quality) out.quality = quality;
    if (resolution) out.resolution = resolution;
    if (outputFormat) out.outputFormat = outputFormat;
    if (referenceTask) out.referenceTask = referenceTask;
    if (safetyTolerance) out.safetyTolerance = safetyTolerance;
    if (moderation) out.moderation = moderation;
    if (background) out.background = background;
    if (sampleRate) out.sampleRate = sampleRate;
    if (speed) out.speed = speed;
    if (volume) out.volume = volume;
    if (pitch) out.pitch = pitch;
    return out;
  }

  /**
   * Put stored settings on the composer. Called twice on a model switch: once right away for the
   * model-independent fields, and again from the controls effect once the model's own resets have run.
   */
  function applyComposerSettings(next: ComposerSettings, loaded: ModelControls | null) {
    const text = (value: string | boolean | undefined) => (typeof value === "string" ? value : undefined);
    const flag = (value: string | boolean | undefined) => (typeof value === "boolean" ? value : undefined);
    const aspect = text(next.aspectRatio);
    if (aspect && (!loaded?.aspectRatios || loaded.aspectRatios.includes(aspect))) setAspectRatio(aspect);
    const length = text(next.duration);
    if (length) {
      durationPinned.current = true;
      setDuration(length);
    }
    setSeed(text(next.seed) ?? "");
    const nextQuality = text(next.quality);
    if (nextQuality && (!loaded || loaded.quality?.includes(nextQuality))) setQuality(nextQuality);
    const nextResolution = text(next.resolution);
    if (nextResolution && (!loaded || loaded.resolution?.includes(nextResolution))) setResolution(nextResolution);
    const nextFormat = text(next.outputFormat);
    if (nextFormat && (!loaded || loaded.outputFormat?.includes(nextFormat))) setOutputFormat(nextFormat);
    const nextTask = text(next.referenceTask);
    if (nextTask && (!loaded || loaded.referenceTask?.includes(nextTask))) setReferenceTask(nextTask);
    const nextBackground = text(next.background);
    if (nextBackground && (!loaded || loaded.background?.includes(nextBackground))) setBackground(nextBackground);
    const nextTolerance = text(next.safetyTolerance);
    if (nextTolerance && (!loaded || loaded.safetyTolerance)) setSafetyTolerance(nextTolerance);
    const nextModeration = text(next.moderation);
    if (nextModeration && (!loaded || loaded.moderation?.values.includes(nextModeration))) {
      setModeration(nextModeration);
    }
    const nextRate = text(next.sampleRate);
    if (nextRate && (!loaded || loaded.sampleRate)) setSampleRate(nextRate);
    const nextSpeed = text(next.speed);
    if (nextSpeed && (!loaded || loaded.speed)) setSpeed(nextSpeed);
    const nextVolume = text(next.volume);
    if (nextVolume && (!loaded || loaded.volume)) setVolume(nextVolume);
    const nextPitch = text(next.pitch);
    if (nextPitch && (!loaded || loaded.pitch)) setPitch(nextPitch);
    const nextAudio = flag(next.generateAudio);
    if (nextAudio != null && (!loaded || loaded.generateAudio)) setGenerateAudio(nextAudio);
    const nextDraft = flag(next.draft);
    if (nextDraft != null && (!loaded || loaded.draft)) setDraft(nextDraft);
    const nextChecker = flag(next.safetyCheckerOn);
    if (nextChecker != null && (!loaded || loaded.safetyChecker)) setSafetyCheckerOn(nextChecker);
    const nextLastFrame = flag(next.getLastFrame);
    if (nextLastFrame != null) setGetLastFrame(nextLastFrame);
  }

  /** Mode, model, and settings together. The model's controls finish the settings once they load. */
  function applyComposerDefaults(defaults: ComposerDefaults) {
    if (defaults.model && isGenerationMode(defaults.mode) && defaults.mode !== mode) {
      modelHold.current = defaults.model;
    }
    if (isGenerationMode(defaults.mode)) setMode(defaults.mode);
    if (defaults.model) {
      if (defaults.model !== model) {
        pendingSettings.current = { model: defaults.model, settings: defaults.settings };
        setNumGenerations(1);
        setModel(defaults.model);
        applyComposerSettings(defaults.settings, null);
      } else {
        applyComposerSettings(defaults.settings, controls);
      }
    } else {
      applyComposerSettings(defaults.settings, controls);
    }
  }

  function applyProjectComposerState(state: ProjectComposerState) {
    setLookIds(state.lookIds);
    setPrompt(state.prompt);
    if (state.defaults) applyComposerDefaults(state.defaults);
    setNumGenerations(1);
    setComposerOrigin(state.origin);
    setSelectedId(null);
    setKeepCanvasClear(true);
  }

  /** Opening a project brings its draft back under the project model, or starts a new job from the brief. */
  function applyProjectDraft(project: StudioProject) {
    applyProjectComposerState(composerStateOnOpen(project));
  }

  /** New job: the brief's prompt and looks, the project model and its saved settings, count 1×. */
  function startNewJob() {
    if (!activeProject) return;
    setCastNotice(null);
    setJobsNotice(null);
    applyProjectComposerState(composerStateForNewJob(activeProject));
    if (phoneLayout()) setProjectsOpen(false);
  }

  /** The Brief chose a model (or let go of it). Runs keep the pick; the composer follows it right away. */
  async function pinProjectModel(choice: ReferenceModel | null) {
    if (!activeProject) return;
    const defaults = choice ? pinnedDefaults(choice, activeProject.defaults) : unpinnedDefaults(activeProject.defaults);
    if (!defaults) return;
    setProjectBusy(true);
    setProjectError(null);
    try {
      await api.saveProjectDraft(activeProject.id, { defaults });
      setActiveProject((prev) => (prev && prev.id === activeProject.id ? { ...prev, defaults } : prev));
      if (choice) {
        setNumGenerations(1);
        applyComposerDefaults(defaults);
      }
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : "Couldn’t save the model");
    } finally {
      setProjectBusy(false);
    }
  }

  async function loadProjectJobs(projectId: string) {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const { jobs } = await api.projectJobs(projectId);
      setProjectJobs(jobs);
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : "Couldn’t load the jobs");
    } finally {
      setJobsLoading(false);
    }
  }

  function flushDraft() {
    if (draftTimer.current != null) {
      window.clearTimeout(draftTimer.current);
      draftTimer.current = null;
    }
    const pending = draftPending.current;
    draftPending.current = null;
    if (pending) {
      void api.saveProjectDraft(pending.projectId, { draft: pending.draft }).catch(() => {
        /* the next edit saves again */
      });
    }
  }

  async function openProject(id: string) {
    setProjectError(null);
    setCastNotice(null);
    setJobsNotice(null);
    setShareName(null);
    setShareLooks([]);
    flushDraft();
    const { project } = await api.project(id);
    draftSkip.current = true;
    rememberProject(project);
    applyProjectDraft(project);
    setProjectJobs([]);
    setProjectView("cast");
    void loadProjectJobs(project.id);
  }

  function closeProject() {
    flushDraft();
    setActiveProject(null);
    setProjectJobs([]);
    setCastNotice(null);
    setJobsNotice(null);
    setProjectView("list");
    replaceStaged([]);
  }

  /** Save the cast and, when numbers moved, rewrite the prompt the composer shows and the saved brief. */
  async function commitCast(
    nextEntries: CastEntry[],
    options: { renumber?: boolean; budget?: number; notice?: string | null } = {},
  ) {
    if (!activeProject) return;
    setProjectBusy(true);
    setProjectError(null);
    let nextPrompt = promptRef.current;
    let savedPrompt = briefSavedPrompt;
    let notice: string | null = options.notice ?? null;
    if (options.renumber) {
      const map = castNumberMap(castItems, flattenCast(nextEntries));
      const composer = rewriteMentions(nextPrompt, map);
      const brief = rewriteMentions(savedPrompt, map);
      nextPrompt = composer.next;
      savedPrompt = brief.next;
      if (composer.changed) {
        promptRef.current = composer.next;
        attachDraft.current = null;
        setPrompt(composer.next);
      }
      const dropped = droppedMentionNotice([...composer.dropped, ...brief.dropped]);
      if (dropped) notice = notice ? `${notice} ${dropped}` : dropped;
    }
    try {
      const { project } = await api.saveProject(activeProject.id, {
        name: activeProject.name,
        prompt: savedPrompt,
        lookIds: activeProject.lookIds,
        budget: options.budget ?? activeProject.budget,
        cast: castRequestBody(nextEntries),
      });
      rememberProject(project);
      setCastNotice(notice);
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : "Couldn’t save the references");
    } finally {
      setProjectBusy(false);
    }
  }

  async function uploadLooseFiles(
    files: File[],
  ): Promise<{ kind: "image" | "video" | "audio"; name: string; key: string; url: string | null }[]> {
    const { accepted, rejected } = partitionMediaFiles(files, acceptedMediaKinds(controls, mode, currentModel()));
    noteRejectedMedia(rejected);
    const uploaded: { kind: "image" | "video" | "audio"; name: string; key: string; url: string | null }[] = [];
    for (const entry of accepted) {
      if (entry.kind === "document") continue;
      const result = await api.upload(entry.file);
      uploaded.push({ kind: entry.kind, name: entry.file.name, key: result.key, url: result.url });
    }
    return uploaded;
  }

  async function projectAddFiles(files: File[]) {
    if (!activeProject || files.length === 0) return;
    setProjectBusy(true);
    try {
      const uploaded = await uploadLooseFiles(files);
      if (uploaded.length === 0) return;
      const nextEntries = castWithFiles(castEntries, uploaded);
      const before = castItems.length;
      const added = flattenCast(nextEntries).slice(before);
      await commitCast(nextEntries);
      const tokens = added
        .filter((item) => mentionAllowed(item.kind))
        .map((item) => mentionToken(item.kind, item.number - 1));
      if (tokens.length > 0) insertTokensAtCaret(tokens);
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : "Couldn’t add those files");
    } finally {
      setProjectBusy(false);
    }
  }

  function projectAddRefs(
    refs: { kind: "image" | "video" | "audio"; name: string; key: string; url: string | null; role?: MediaRole | null }[],
  ) {
    if (!activeProject) return;
    const nextEntries = castWithFiles(castEntries, refs);
    if (nextEntries.length === castEntries.length) return;
    const before = castItems.length;
    const added = flattenCast(nextEntries).slice(before);
    void commitCast(nextEntries).then(() => {
      const tokens = added
        .filter((item) => mentionAllowed(item.kind))
        .map((item) => mentionToken(item.kind, item.number - 1));
      if (tokens.length > 0) insertTokensAtCaret(tokens);
    });
  }

  function insertTokensAtCaret(tokens: string[]) {
    const field = promptField.current;
    const el = field?.element ?? null;
    const liveCaret = el && document.activeElement === el ? el.selectionStart : null;
    const result = insertAttachMentions(promptRef.current, liveCaret, tokens);
    promptRef.current = result.next;
    attachDraft.current = { text: result.next, caret: result.caret };
    setPrompt(result.next);
    field?.place(result.caret, result.next);
  }

  function projectRemoveItem(item: CastItem) {
    void commitCast(castWithoutItem(castEntries, item), { renumber: true });
  }

  function projectRemoveEntry(entryId: string) {
    void commitCast(castWithoutEntry(castEntries, entryId), { renumber: true });
  }

  function projectMoveEntry(from: number, to: number) {
    const next = castWithEntryMoved(castEntries, from, to);
    const map = castNumberMap(castItems, flattenCast(next));
    const moved = rewriteMentions(promptRef.current, map).changed || rewriteMentions(briefSavedPrompt, map).changed;
    if (moved && !window.confirm("Update the mentions in the brief to match the new order?")) {
      void commitCast(next);
      return;
    }
    void commitCast(next, { renumber: true });
  }

  function projectSaveBrief(body: { name: string }) {
    if (!activeProject) return;
    setProjectBusy(true);
    setProjectError(null);
    void api
      .saveProject(activeProject.id, {
        name: body.name,
        prompt: promptRef.current,
        lookIds,
        budget: activeProject.budget,
        cast: castRequestBody(castEntries),
      })
      .then(({ project }) => rememberProject(project))
      .catch((err) => setProjectError(err instanceof Error ? err.message : "Couldn’t save the brief"))
      .finally(() => setProjectBusy(false));
  }

  /** After a run from a project: the draft and defaults follow the request, and the jobs list refreshes. */
  function recordProjectRun(projectId: string, draftBody: ComposerDraft) {
    draftPending.current = null;
    const defaults = defaultsAfterRun(activeProject?.id === projectId ? activeProject.defaults : null, draftBody);
    void api.saveProjectDraft(projectId, { draft: draftBody, defaults }).catch(() => {
      /* the jobs list still shows the run */
    });
    const now = Math.floor(Date.now() / 1000);
    setActiveProject((prev) =>
      prev && prev.id === projectId
        ? { ...prev, draft: draftBody, defaults, jobCount: prev.jobCount + 1, lastRunAt: now }
        : prev,
    );
    setProjectSummaries((prev) =>
      prev.map((item) => (item.id === projectId ? { ...item, jobCount: item.jobCount + 1, lastRunAt: now } : item)),
    );
    void loadProjectJobs(projectId);
  }

  async function rerunJob(job: ProjectJob) {
    if (!activeProject || busy) return;
    if (!user?.hasOxenKey) {
      setProjectsOpen(false);
      setShowSettings(true);
      setError("Add your Oxen API key in Settings first.");
      return;
    }
    const { body, missing } = rerunBodyForJob(job);
    setJobsNotice(null);
    setBusy(true);
    setError(null);
    try {
      const { generations: created } = await api.generate(body);
      setKeepCanvasClear(false);
      setPeekId(null);
      setGenerations((prev) => mergeGenerations(prev, created));
      setSelectedId(created[0]?.id ?? null);
      setJobsNotice(
        missing.length > 0
          ? `Re-running without ${missing.length} ${missing.length === 1 ? "reference that is" : "references that are"} gone from Studio.`
          : "Re-running, one output.",
      );
      recordProjectRun(
        activeProject.id,
        activeProject.draft ?? { prompt, mode, model, settings: composerSettings() },
      );
      void refreshCredits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-run failed");
    } finally {
      setBusy(false);
    }
  }

  function loadJobIntoComposer(job: ProjectJob) {
    if (!activeProject) return;
    const state = composerStateForJob(job);
    setPrompt(state.prompt);
    setLookIds(state.lookIds.filter((id) => looks.some((look) => look.id === id)));
    applyComposerDefaults({ mode: state.mode, model: state.model, settings: state.settings });
    setNumGenerations(1);
    setSelectedId(null);
    setKeepCanvasClear(true);
    const matched = castMatchingJob(castEntries, castItems, job.refs);
    if (matched) {
      void commitCast(matched);
      setJobsNotice("Loaded. The references now match that run.");
    } else {
      setJobsNotice(
        job.refs.length === 0
          ? "Loaded into the composer."
          : "Loaded. None of that run’s references is in the project any more, so the selection stayed as it was.",
      );
    }
    if (phoneLayout()) setProjectsOpen(false);
  }

  function addJobOutputsToCast(job: ProjectJob, outputs: ProjectJobOutput[]) {
    if (!activeProject) return;
    const files = castFilesForJob(job, outputs);
    if (files.length === 0) {
      setJobsNotice("Nothing finished to add yet.");
      return;
    }
    const before = castItems.length;
    projectAddRefs(files);
    setJobsNotice(
      `Added ${files.length} ${files.length === 1 ? "output" : "outputs"} to the references as ${
        files.length === 1 ? `number ${before + 1}` : `numbers ${before + 1}–${before + files.length}`
      }.`,
    );
  }

  async function openJobOutput(output: ProjectJobOutput) {
    if (!generations.some((item) => item.id === output.id)) {
      try {
        const { generation } = await api.getGeneration(output.id);
        setGenerations((prev) => mergeGenerations(prev, [generation]));
      } catch {
        setJobsNotice("That output is no longer in Studio.");
        return;
      }
    }
    setKeepCanvasClear(false);
    setPeekId(null);
    setSelectedId(output.id);
    if (phoneLayout()) setProjectsOpen(false);
  }

  const jobsLive = useMemo(() => new Map(generations.map((item) => [item.id, item] as const)), [generations]);
  const modelNames = useMemo(
    () =>
      new Map(
        [...favorites, ...models].flatMap((item) =>
          item.display_name ? [[item.id, item.display_name] as const] : [],
        ),
      ),
    [favorites, models],
  );

  const draftProjectId = activeProject && !shareName ? activeProject.id : null;
  const currentDraft: ComposerDraft = { prompt, mode, model, settings: composerSettings() };
  composerDraftRef.current = currentDraft;
  const draftKey = draftProjectId ? JSON.stringify(currentDraft) : null;
  useEffect(() => {
    if (!draftProjectId || draftKey == null) return;
    if (draftSkip.current) {
      draftSkip.current = false;
      return;
    }
    draftPending.current = { projectId: draftProjectId, draft: composerDraftRef.current };
    if (draftTimer.current != null) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      draftTimer.current = null;
      const pending = draftPending.current;
      draftPending.current = null;
      if (!pending) return;
      void api.saveProjectDraft(pending.projectId, { draft: pending.draft }).catch(() => {
        /* the next edit saves again */
      });
    }, DRAFT_SAVE_DELAY_MS);
  }, [draftProjectId, draftKey]);

  const imageRouted = Boolean(
    controls?.slots.some((slot) => slot.field === "input_face_images") &&
      controls.slots.some((slot) => slot.kind === "image" && !slot.field.includes("face")),
  );
  const videoRouted = Boolean(
    controls?.slots.some((slot) => slot.field === "input_face_videos") &&
      controls.slots.some((slot) => slot.kind === "video" && !slot.field.includes("face")),
  );
  const activeLooks = useMemo(
    () => (shareName ? shareLooks : appliedLooks(lookIds, looks)),
    [lookIds, looks, shareLooks, shareName],
  );
  const delivery = useMemo(() => {
    const routedKinds = [
      ...(imageRouted ? (["image"] as const) : []),
      ...(videoRouted ? (["video"] as const) : []),
    ];
    const scene = namesOn ? namePlan.expanded : prompt;
    const result = deliveryForRun({
      prompt: scene,
      lookBlock: joinLooks(activeLooks),
      attachments: shown.map((item) => ({ name: item.name, kind: item.kind, role: item.role, number: item.number })),
      routedKinds,
      faceFirst: imageRouted || videoRouted,
    });
    const notice = namesOn ? namePlanNotice(namePlan) : null;
    if (!notice) return result;
    return { prompt: result.prompt, notes: [...result.notes, notice] };
  }, [activeLooks, imageRouted, namePlan, namesOn, prompt, shown, videoRouted]);

  function toggleLook(id: string) {
    setLookIds((prev) => toggleLookId(prev, id));
  }

  async function createLook(draft: { name: string; body: string; group: StudioLook["group"] }) {
    setProjectError(null);
    try {
      const { look } = await api.createLook(draft.name, draft.body, draft.group);
      setLooks((prev) => [...prev.filter((item) => item.id !== look.id), look]);
      return look;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save that look");
      return null;
    }
  }

  function starLook(id: string, starred: boolean) {
    setLooks((prev) => prev.map((item) => (item.id === id ? { ...item, starred } : item)));
    void api.updateLook(id, { starred }).then(
      ({ look }) => setLooks((prev) => prev.map((item) => (item.id === look.id ? look : item))),
      (err) => {
        setLooks((prev) => prev.map((item) => (item.id === id ? { ...item, starred: !starred } : item)));
        setError(err instanceof Error ? err.message : "Couldn’t update that look");
      },
    );
  }

  function deleteLook(id: string) {
    setLooks((prev) => prev.filter((item) => item.id !== id));
    setLookIds((prev) => prev.filter((item) => item !== id));
    void api.deleteLook(id).catch((err) => {
      setError(err instanceof Error ? err.message : "Couldn’t delete that look");
    });
  }

  async function onGenerate() {
    if (generateBlock) {
      setError(generateBlock);
      return;
    }
    if (!canGenerate || !mode) {
      if (!user?.hasOxenKey) {
        setLibraryOpen(false);
        setLibraryPane("history");
        setProjectsOpen(false);
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
      const jobRefs: { kind: "image" | "video" | "audio"; number: number; role: MediaRole | null; name: string; key: string }[] = [];
      let namedFiles = namePlan.files;
      if (namesOn && namedFiles.some((file) => !file.url)) {
        const missingIds = [...new Set(namedFiles.filter((file) => !file.url).map((file) => file.galleryId))];
        const loaded = await Promise.all(
          missingIds.map(async (id) => {
            try {
              return (await api.gallery(id)).gallery;
            } catch {
              return null;
            }
          }),
        );
        const urls = new Map<string, string>();
        for (const gallery of loaded) {
          if (!gallery) continue;
          for (const item of gallery.items) {
            if (item.url) urls.set(item.key, item.url);
          }
        }
        namedFiles = namedFiles.flatMap((file) => {
          const url = file.url || urls.get(file.key);
          return url ? [{ ...file, url }] : [];
        });
      }
      const sendable: {
        kind: "image" | "video" | "audio";
        name: string;
        url?: string;
        file?: File;
        key?: string;
        role?: MediaRole | "scene" | null;
        number?: number;
      }[] = [];
      for (const kind of ["image", "video", "audio"] as const) {
        const hand = takeStagedOfKind(staged, kind, capForKind(kind));
        const room = Math.max(0, capForKind(kind) - hand.length);
        const extra = namedFiles.filter((file) => file.kind === kind).slice(0, room);
        sendable.push(
          ...hand,
          ...extra.map((file) => ({
            kind: file.kind,
            name: file.name,
            url: file.url ?? undefined,
            key: file.key,
            role: nameRoles[file.key] ?? file.role,
            number: file.number,
          })),
        );
      }
      for (const item of sendable) {
        let url = item.url ?? "";
        let key = item.key;
        if (!url && item.file) {
          const uploaded = await api.upload(item.file);
          url = uploaded.url;
          key = uploaded.key;
        }
        if (!url) continue;
        const role = normalizeMediaRole(item.role);
        if (key) {
          jobRefs.push({
            kind: item.kind,
            number: item.number ?? jobRefs.filter((ref) => ref.kind === item.kind).length + 1,
            role: item.kind === "audio" ? null : role,
            name: item.name,
            key,
          });
        }
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
          prompt: namesOn
            ? expandNameText(shot.prompt.trim(), namePlan.kept, namePlan.removed)
            : shot.prompt.trim(),
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
      if (multiPrompt) {
        payload.multi_prompt = prompt.trim()
          ? [{ ...multiPrompt[0], prompt: delivery.prompt }, ...multiPrompt.slice(1)]
          : multiPrompt;
      } else payload.prompt = delivery.prompt;
      if (activeLooks.length > 0) {
        payload.looks = activeLooks.map((look) => ({ id: look.id, name: look.name }));
      }
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
      if (controls?.safetyChecker) {
        const checker = safetyCheckerRequestValue(controls.safetyChecker, safetyCheckerOn);
        if (typeof checker === "boolean") payload[controls.safetyChecker.field] = checker;
      }
      if (controls?.moderation) {
        const chosen = controls.moderation.values.includes(moderation)
          ? moderation
          : controls.moderation.defaultValue;
        if (chosen) payload.moderation = chosen;
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
      const projectRun = activeProject && !shareName ? activeProject : null;
      if (projectRun) {
        payload.project_id = projectRun.id;
        if (jobRefs.length > 0) payload.refs = jobRefs;
        const estimated = estimateGenerationCost({
          pricing: controls?.pricing ?? selectedModel?.pricing,
          numGenerations,
          duration: modeIsVideo(mode) ? durationToSend(duration, controls?.duration ?? null) : undefined,
          generateAudio,
          resolution,
          quality,
        });
        if (estimated.amount != null) payload.estimated_cost = estimated.amount;
      }
      if (prompt.trim() && prompt.trim() !== delivery.prompt.trim()) {
        payload.base_prompt = prompt.trim();
      }

      const { generations: created } = await api.generate(payload);
      setKeepCanvasClear(false);
      setPeekId(null);
      setGenerations((prev) => mergeGenerations(prev, created));
      setSelectedId(created[0]?.id ?? null);
      if (projectRun) {
        setJobsNotice(null);
        recordProjectRun(projectRun.id, { prompt, mode, model, settings: composerSettings() });
      }
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

  const galleryPanelOpen = libraryOpen && libraryPane === "galleries";

  return (
    <VideoThumbSecondsProvider seconds={settings?.videoThumbSeconds ?? DEFAULT_VIDEO_THUMB_SECONDS}>
    <div className={`app-shell panel-place-${panelPlace}${libraryOpen ? " library-open" : ""}${peek ? " has-peek" : ""}${galleryTileDrag ? " is-tile-drag" : ""}${galleryPanelOpen && managingGallery ? " is-gallery-open" : ""}`}>
      <PanelPlaceProvider place={panelPlace} setPlace={setPanelPlace}>
      <ProjectRail
        open={projectsOpen}
        view={projectView}
        onView={setProjectView}
        projects={projectSummaries}
        activeProjectId={activeProject?.id ?? null}
        activeProjectName={activeProject?.name ?? null}
        onCreate={(name) => {
          flushDraft();
          void api.createProject(name).then(({ project }) => {
            draftSkip.current = true;
            rememberProject(project);
            applyProjectComposerState(composerStateForNewJob(project));
            setProjectJobs([]);
            setCastNotice(null);
            setJobsNotice(null);
            setProjectView("cast");
          }).catch((err) => setProjectError(err instanceof Error ? err.message : "Couldn’t create that project"));
        }}
        onOpenProject={(id) => void openProject(id)}
        onNewJob={startNewJob}
        busy={busy || projectBusy}
        onClose={() => setProjectsOpen(false)}
        error={projectError}
      >
        {activeProject && projectView === "cast" ? (
          <ProjectCast
            entries={castEntries}
            items={castItems}
            selection={castSelection}
            budget={activeProject.budget}
            modelCaps={model ? castCaps : null}
            galleries={gallerySummaries}
            busy={projectBusy}
            notice={castNotice ?? projectError}
            dropAccept={fileAcceptValue(acceptedMediaKinds(controls, mode, currentModel()))}
            onBudgetChange={(budget) => void commitCast(castEntries, { budget })}
            onToggleEntry={(entryId, active) => void commitCast(castWithEntryActive(castEntries, entryId, active))}
            onRemoveEntry={projectRemoveEntry}
            onMoveEntry={projectMoveEntry}
            onToggleItem={(item, active) => void commitCast(castWithItemActive(castEntries, item, active))}
            onRemoveItem={projectRemoveItem}
            onRoleChange={(item, role) => void commitCast(castWithItemRole(castEntries, item, role))}
            onAddGallery={(galleryId) => {
              const gallery = gallerySummaries.find((entry) => entry.id === galleryId);
              if (gallery) void commitCast(castWithGallery(castEntries, gallery));
            }}
            onAddFiles={(files) => void projectAddFiles(files)}
            onOpenLibrary={() => {
              setProjectsOpen(false);
              setShowSettings(false);
              setLibraryPane("history");
              setLibraryOpen(true);
            }}
            onOpenGallery={(id) => {
              setManagingGallery(true);
              setLibraryPane("galleries");
              setProjectsOpen(false);
              setShowSettings(false);
              setLibraryOpen(true);
              void onGalleryLoad(id);
            }}
          />
        ) : null}
        {activeProject && projectView === "jobs" ? (
          <ProjectJobs
            jobs={projectJobs}
            loading={jobsLoading}
            error={jobsError}
            notice={jobsNotice}
            busy={busy || projectBusy}
            live={jobsLive}
            modelNames={modelNames}
            onRerun={(job) => void rerunJob(job)}
            onLoad={loadJobIntoComposer}
            onAddOutputs={addJobOutputsToCast}
            onOpenOutput={(output) => void openJobOutput(output)}
            onDownload={(job, output) => {
              if (!output.resultUrl) return;
              void downloadMedia(
                output.resultUrl,
                downloadFilename({
                  id: output.id,
                  mediaType: output.mediaType,
                  prompt: job.basePrompt ?? job.prompt,
                  resultUrl: output.resultUrl,
                }),
              );
            }}
            onRefresh={() => void loadProjectJobs(activeProject.id)}
            onNewJob={startNewJob}
          />
        ) : null}
        {activeProject && projectView === "brief" ? (
          <ProjectBrief
            project={activeProject}
            looks={looks}
            referenceModels={referenceModels}
            referenceModelsError={referenceModelsError}
            preferredModelIds={favoriteIds}
            onPinModel={(choice) => void pinProjectModel(choice)}
            lookIds={lookIds}
            onToggleLook={toggleLook}
            prompt={prompt}
            onPromptChange={setPrompt}
            busy={projectBusy}
            error={projectError}
            dirty={prompt !== briefSavedPrompt || !sameIds(lookIds, activeProject.lookIds)}
            onSave={projectSaveBrief}
            onDelete={() => {
              if (!window.confirm(`Delete ${activeProject.name}?`)) return;
              setProjectBusy(true);
              void api
                .deleteProject(activeProject.id)
                .then(() => {
                  setProjectSummaries((prev) => prev.filter((item) => item.id !== activeProject.id));
                  closeProject();
                })
                .catch((err) => setProjectError(err instanceof Error ? err.message : "Couldn’t delete that project"))
                .finally(() => setProjectBusy(false));
            }}
            onShare={(days) => {
              setProjectBusy(true);
              void api
                .createProjectShare(activeProject.id, days)
                .then(() => api.project(activeProject.id))
                .then(({ project }) => rememberProject(project))
                .catch((err) => setProjectError(err instanceof Error ? err.message : "Couldn’t create a share link"))
                .finally(() => setProjectBusy(false));
            }}
            onRevoke={(shareId) => {
              void api.revokeProjectShare(activeProject.id, shareId).then(() =>
                api.project(activeProject.id).then(({ project }) => rememberProject(project)),
              );
            }}
            hasDraft={prompt !== briefSavedPrompt || !sameIds(lookIds, activeProject.lookIds)}
            origin={composerOrigin}
            onNewJob={startNewJob}
          />
        ) : null}
      </ProjectRail>
      {projectsOpen ? (
        <button type="button" className="slide-backdrop" aria-label="Close projects" onClick={() => setProjectsOpen(false)} />
      ) : null}
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
        media={libraryMedia}
        onMedia={(value) => {
          setLibraryMedia(value);
          setLibraryPage(1);
        }}
        page={libraryPage}
        pageCount={libraryPageCount}
        onPage={setLibraryPage}
        downloadingAll={downloadingAll}
        onSelect={setPeekId}
        onClose={closeLibrary}
        onDownloadAll={() => void onDownloadAll()}
        onDelete={(ids, scope) => void deleteMedia(ids, scope)}
        attachedIds={attachedIds}
        attachedMediaKeys={attachedMediaKeys}
        onAttach={addLibraryItem}
        onClearFailed={() => void onClearFailed()}
        clearingFailed={clearingFailed}
        attachSupported={(item) => {
          const ref = libraryRefFromGeneration(item);
          return Boolean(ref && capForKind(ref.kind) > 0);
        }}
        createGalleryOpen={createGalleryOpen}
        galleryName={galleryName}
        galleryHandle={galleryHandle}
        galleryTake={galleryTake}
        onGalleryNameChange={onGalleryNameChange}
        onGalleryHandleChange={setGalleryHandle}
        onGalleryTakeChange={setGalleryTake}
        onGalleryLabelChange={onGalleryLabelChange}
        galleryItems={galleryItems}
        gallerySaving={gallerySaving}
        galleryAdding={galleryAdding}
        galleryStatus={galleryStatus}
        onGalleryAddFiles={(files) => void onGalleryAddFiles(files)}
        onGalleryRemove={(index) => changeGallerySet((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
        onCreateGallery={openCreateGallery}
        onCreateGalleryClose={cancelCreateGallery}
        onCreateGallerySave={() => void saveCreateGallery()}
        onToggleHistory={onToggleHistory}
        onDropHistoryMedia={onDropHistoryMedia}
        galleryAccept={galleryAccept}
        galleryDropLabel={galleryDropPhrase ? `Drop ${galleryDropPhrase}` : "Drop media"}
        gallerySummaries={gallerySummaries}
        galleryId={galleryId}
        onGalleryOpen={(id) => void onGalleryLoad(id)}
        onManageGallerySave={() => void onGallerySave()}
        onGalleryAttach={attachFromGallery}
        gallerySkipped={gallerySkipped}
        onGalleryRoleChange={onGalleryRoleChange}
        onGalleryFeature={onGalleryFeature}
        onGalleryReorder={onGalleryReorder}
        onGalleryTileDrag={setGalleryTileDrag}
        onGalleryDelete={(id) => void onGalleryDelete(id)}
        onGalleryRename={(id, name) => void onGalleryRename(id, name)}
        onGalleryDeleteSelected={onGalleryDeleteSelected}
        onGalleryPlace={onGalleryPlace}
        onHistoryAddToGallery={addHistoryToGallery}
        onHistoryCreateGallery={createHistoryGallery}
        managingGallery={managingGallery}
        onManagingGallery={setManagingGallery}
        pane={libraryPane}
        onPaneChange={chooseLibraryPane}
      />
      {libraryOpen ? (
        <button
          type="button"
          className="slide-backdrop"
          aria-label="Close library"
          onClick={closeLibrary}
        />
      ) : null}
      <main className="main">
        <div className="main-column">
          <div className="main-top">
            <PhoneNav
              libraryActive={libraryOpen && libraryPane === "history"}
              projectsActive={projectsOpen}
              galleriesActive={galleryPanelOpen}
              onOpenLibrary={() => openLibraryPane("history")}
              onOpenProjects={openProjectsPane}
              onOpenGalleries={() => openLibraryPane("galleries")}
            />
            <div className="nav-brand">
              <img className={brandMarkClass(branding.logoUrl)} src={branding.logoUrl} alt="" />
              <strong>{branding.name}</strong>
            </div>
            <nav className="main-top-nav" aria-label="Studio">
              <button
                type="button"
                className={`ghost-btn nav-phone-hide${libraryOpen ? " active" : ""}`}
                aria-expanded={libraryOpen}
                aria-controls="media-library"
                aria-keyshortcuts="Meta+Shift+L"
                title="Library (⌘⇧L)"
                onClick={() => {
                  if (libraryOpen) closeLibrary();
                  else {
                    setProjectsOpen(false);
                    setShowSettings(false);
                    setLibraryPane("history");
                    setLibraryOpen(true);
                  }
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
              <button
                type="button"
                className={`ghost-btn nav-phone-hide${projectsOpen ? " active" : ""}`}
                aria-expanded={projectsOpen}
                aria-controls="project-slide"
                onClick={() => {
                  const next = !projectsOpen;
                  setProjectsOpen(next);
                  if (next) {
                    setLibraryOpen(false);
                    setLibraryPane("history");
                    setShowSettings(false);
                    setPeekId(null);
                  }
                }}
              >
                Projects
              </button>
              <button
                type="button"
                className={`ghost-btn nav-phone-hide${showSettings ? " active" : ""}`}
                aria-expanded={showSettings}
                aria-keyshortcuts="Meta+Shift+Comma"
                title="Settings (⌘⇧,)"
                onClick={() => {
                  const next = !showSettings;
                  setShowSettings(next);
                  if (next) {
                    setLibraryOpen(false);
                    setLibraryPane("history");
                    setProjectsOpen(false);
                    setPeekId(null);
                  }
                }}
              >
                Settings
                <span className="nav-shortcut" aria-hidden>
                  <kbd>⌘</kbd>
                  <kbd>⇧</kbd>
                  <kbd>,</kbd>
                </span>
              </button>
            </nav>
            <div className="main-top-right">
              <CreditMeter credits={credits} />
              <AccountMenu
                userLogin={user.login}
                avatarUrl={user.avatarUrl}
                isAdmin={user.isAdmin}
                hasOxenKey={user.hasOxenKey}
                onOpenSettings={() => {
                  setLibraryOpen(false);
                  setLibraryPane("history");
                  setProjectsOpen(false);
                  setPeekId(null);
                  setShowSettings(true);
                }}
                onLogout={() => void logout()}
                profiles={profiles}
                activeProfileId={activeProfileId}
                onActivateProfile={(id) => void onActivateProfile(id)}
                onCreateProfile={(name) => void onCreateProfile(name)}
                onRenameProfile={(id, name) => void onRenameProfile(id, name)}
                onDeleteProfile={(id) => void onDeleteProfile(id)}
              />
            </div>
          </div>
          {shareName ? (
            <p className="share-banner">
              Using {shareName}. This run does not change the owner’s project.
            </p>
          ) : null}
          <div className={`workspace${peek ? " has-peek" : ""}`}>
            {mode === "chat" ? (
              <ChatThread turns={chatTurns} busy={busy} />
            ) : (
              <Canvas
                generation={selected}
                variants={selectedVariants}
                onSelect={setSelectedId}
                onTagsChange={(id, tags) => void onSaveTags(id, tags)}
                onDelete={(id, scope) => void deleteMedia([id], scope)}
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
                onRemove={(ids, scope) => void deleteMedia(ids, scope)}
              />
            ) : null}
          </div>
          {activeProject && !shareName ? (
            <ProjectHeader
              project={activeProject}
              selection={castSelection}
              galleryCount={castEntries.filter((entry) => entry.type === "gallery").length}
              view={projectsOpen ? projectView : null}
              origin={composerOrigin}
              busy={busy || projectBusy}
              onNewJob={startNewJob}
              onOpen={(view) => {
                setProjectView(view);
                setLibraryOpen(false);
                setLibraryPane("history");
                setShowSettings(false);
                setPeekId(null);
                setProjectsOpen(true);
              }}
              onClose={closeProject}
            />
          ) : null}
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
            galleryOpen={galleryPanelOpen}
            onGalleryToggle={toggleGalleryPanel}
            galleryItems={galleryItems}
            onGalleryAttach={attachFromGallery}
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
            safetyCheckerOn={safetyCheckerOn}
            onSafetyCheckerChange={rememberParam(setSafetyCheckerOn)}
            moderation={moderation}
            onModerationChange={rememberParam(setModeration)}
            attachments={shown.map((item) => ({
              name: item.name,
              preview: item.preview,
              kind: item.kind,
              role: item.role,
              number: item.number,
              via: item.via,
              origin: item.origin,
            }))}
            mentionGalleries={nameCatalog}
            missingNameStarts={namePlan.unresolved.map((mention) => mention.start)}
            nameHovers={namePlan.hovers}
            nameNotice={namesOn ? namePlanNotice(namePlan) : null}
            onAddFiles={onAddFiles}
            onClearAttachment={onClearAttachment}
            onReorderAttachments={onReorderAttachments}
            busy={busy || projectBusy}
            error={error}
            onGenerate={() => void onGenerate()}
            canGenerate={canGenerate}
            looks={shareName ? undefined : looks}
            appliedLooks={activeLooks}
            onToggleLook={shareName ? undefined : toggleLook}
            onCreateLook={shareName ? undefined : createLook}
            onStarLook={shareName ? undefined : starLook}
            onDeleteLook={shareName ? undefined : deleteLook}
            generateBlock={generateBlock}
            attachSummary={
              projectStaging
                ? {
                    label: castSummaryLabel(castSelection),
                    partial: castSelection.attached.length < castSelection.total,
                    onOpen: () => {
                      setProjectView("cast");
                      setLibraryOpen(false);
                      setLibraryPane("history");
                      setShowSettings(false);
                      setPeekId(null);
                      setProjectsOpen(true);
                    },
                  }
                : null
            }
            modelDelivery={delivery.prompt}
            deliveryNotes={delivery.notes}
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
      {deleteNotice ? (
        <div className={`studio-notice${deleteNotice.tone === "warn" ? " is-warn" : ""}`} role="status">
          <span>{deleteNotice.text}</span>
          <button
            type="button"
            className="studio-notice-close"
            aria-label="Dismiss"
            onClick={() => showDeleteNotice(null)}
          >
            ×
          </button>
        </div>
      ) : null}
      </PanelPlaceProvider>
    </div>
    </VideoThumbSecondsProvider>
  );
}
