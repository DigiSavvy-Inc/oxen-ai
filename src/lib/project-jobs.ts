import {
  MODE_LABELS,
  type ComposerSettings,
  type Generation,
  type GenerationMode,
  type ProjectJob,
  type ProjectJobOutput,
  type ProjectJobRef,
  type ProjectJobStatus,
} from "./api";
import type { CastEntry, CastItem, CastKind } from "./cast";
import { downloadFilename } from "./download";
import { timeAgo } from "./time-ago";
import { formatUsd } from "../../worker/pricing";
import type { JobSettingValue } from "../../worker/job-record";

/** Live generation state (polling) wins over the job's stored outputs. */
export function mergeJobOutputs(
  job: ProjectJob,
  live: ReadonlyMap<string, Generation>,
): ProjectJobOutput[] {
  return job.outputs.map((output) => {
    const current = live.get(output.id);
    if (!current) return output;
    return {
      ...output,
      status: current.status,
      resultUrl: current.resultUrl ?? output.resultUrl,
      resultKey: current.resultKey ?? output.resultKey,
      thumbUrl: current.thumbUrl ?? output.thumbUrl,
      errorMessage: current.errorMessage ?? output.errorMessage,
      updatedAt: current.updatedAt,
      tags: current.tags ?? output.tags,
    };
  });
}

export function jobStatusLabel(status: ProjectJobStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "partial":
      return "Partly failed";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function jobModeLabel(mode: string): string {
  return MODE_LABELS[mode as GenerationMode] || mode;
}

const ACRONYMS = new Set(["gpt", "hd", "sd", "xl", "4k", "2k"]);

/** "bytedance-seedance-2-5-reference-to-video" → "Seedance 2.5 Reference To Video" when the catalog has no name. */
export function jobModelLabel(model: string): string {
  const tail = model.split("/").pop() ?? model;
  const words = tail
    .replace(/^(bytedance|black-forest-labs|fal-ai|openai|google|kwaivgi|minimax|alibaba|wan-ai)-/i, "")
    .split("-")
    .filter(Boolean);
  const out: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const next = words[index + 1];
    if (/^\d+$/.test(word) && next && /^\d+$/.test(next)) {
      out.push(`${word}.${next}`);
      index += 1;
      continue;
    }
    if (/^v\d+$/i.test(word)) {
      out.push(word.slice(1));
      continue;
    }
    out.push(ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1));
  }
  return out.join(" ") || model;
}

export function jobTimeLabel(createdAt: number, now = Math.floor(Date.now() / 1000)): string {
  if (now - createdAt >= 7 * 86400) {
    return new Date(createdAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return timeAgo(createdAt, now);
}

export function jobCostLabel(cost: number | null): string {
  if (cost == null) return "";
  return formatUsd(cost).replace(/^≈/, "");
}

/** The first line of the scene text, shortened for a row. */
export function jobPromptExcerpt(job: Pick<ProjectJob, "prompt" | "basePrompt">, max = 90): string {
  const text = (job.basePrompt ?? job.prompt).trim();
  const line = text.split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  if (line.length <= max) return line || "(no prompt)";
  return `${line.slice(0, max - 1).trimEnd()}…`;
}

const SETTING_LABELS: Record<string, string> = {
  aspect_ratio: "Aspect",
  duration: "Duration",
  seed: "Seed",
  generate_audio: "Audio",
  draft: "Draft",
  num_generations: "Count",
  quality: "Quality",
  resolution: "Resolution",
  output_format: "Format",
  background: "Background",
  moderation: "Moderation",
  disable_safety_checker: "Safety checker",
  enable_safety_checker: "Safety checker",
  safety_tolerance: "Safety tolerance",
  omni_reference_task_type: "Task",
  sample_rate: "Sample rate",
  speed: "Speed",
  volume: "Volume",
  pitch: "Pitch",
  capture_last_frame: "Last frame",
};

/** Human rows for the settings block, in payload order. */
export function jobSettingRows(settings: Record<string, JobSettingValue>): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const [field, raw] of Object.entries(settings)) {
    const label = SETTING_LABELS[field] ?? field;
    let value: string;
    if (field === "disable_safety_checker") value = raw === true ? "off" : "on";
    else if (field === "enable_safety_checker") value = raw === true ? "on" : "off";
    else if (typeof raw === "boolean") value = raw ? "on" : "off";
    else if (field === "duration") value = `${raw}s`;
    else if (field === "num_generations") value = `${raw}×`;
    else value = String(raw);
    rows.push({ label, value });
  }
  return rows;
}

/** Oxen payload fields → the composer's own settings. */
export function composerSettingsFromJob(settings: Record<string, JobSettingValue>): ComposerSettings {
  const out: ComposerSettings = {};
  const text = (field: string) => {
    const value = settings[field];
    return value == null || typeof value === "boolean" ? undefined : String(value);
  };
  const aspect = text("aspect_ratio");
  if (aspect) out.aspectRatio = aspect;
  const duration = text("duration");
  if (duration) out.duration = duration;
  const seed = text("seed");
  if (seed) out.seed = seed;
  const quality = text("quality");
  if (quality) out.quality = quality;
  const resolution = text("resolution");
  if (resolution) out.resolution = resolution;
  const format = text("output_format");
  if (format) out.outputFormat = format;
  const task = text("omni_reference_task_type");
  if (task) out.referenceTask = task;
  const background = text("background");
  if (background) out.background = background;
  const moderation = text("moderation");
  if (moderation) out.moderation = moderation;
  const tolerance = text("safety_tolerance");
  if (tolerance) out.safetyTolerance = tolerance;
  for (const field of ["sample_rate", "speed", "volume", "pitch"] as const) {
    const value = text(field);
    if (value == null) continue;
    if (field === "sample_rate") out.sampleRate = value;
    else out[field] = value;
  }
  if (typeof settings.generate_audio === "boolean") out.generateAudio = settings.generate_audio;
  if (typeof settings.draft === "boolean") out.draft = settings.draft;
  if (settings.capture_last_frame === true) out.getLastFrame = true;
  if (typeof settings.disable_safety_checker === "boolean") {
    out.safetyCheckerOn = !settings.disable_safety_checker;
  } else if (typeof settings.enable_safety_checker === "boolean") {
    out.safetyCheckerOn = settings.enable_safety_checker;
  }
  return out;
}

export type ComposerLoad = {
  prompt: string;
  lookIds: string[];
  mode: string;
  model: string;
  settings: ComposerSettings;
};

/** What Load into composer puts back: the scene text, the looks, the model, the settings. */
export function composerStateForJob(job: ProjectJob): ComposerLoad {
  return {
    prompt: job.basePrompt ?? job.prompt,
    lookIds: job.looks.map((look) => look.id),
    mode: job.mode,
    model: job.model,
    settings: composerSettingsFromJob(job.settings),
  };
}

export type RerunPlan = {
  body: Record<string, unknown>;
  /** References whose file is gone from Studio, so the request leaves them out. */
  missing: ProjectJobRef[];
};

/** The same request again, count 1×. Settings go back under their Oxen field names. */
export function rerunBodyForJob(job: ProjectJob): RerunPlan {
  const body: Record<string, unknown> = {
    mode: job.mode,
    model: job.model,
    num_generations: 1,
  };
  for (const [field, value] of Object.entries(job.settings)) {
    if (field === "num_generations") continue;
    if (field === "capture_last_frame") {
      if (value === true) body.get_last_frame = true;
      continue;
    }
    body[field] = value;
  }
  if (job.multiPrompt && job.multiPrompt.length > 0) body.multi_prompt = job.multiPrompt;
  body.prompt = job.prompt;
  if (job.looks.length > 0) body.looks = job.looks;
  body.project_id = job.projectId;
  if (job.refs.length > 0) {
    body.refs = job.refs.map(({ kind, number, role, name, key }) => ({ kind, number, role, name, key }));
  }
  if (job.basePrompt) body.base_prompt = job.basePrompt;
  const previousCount = typeof job.settings.num_generations === "number" ? job.settings.num_generations : 1;
  if (job.cost != null) {
    body.estimated_cost = previousCount > 1 ? Math.round((job.cost / previousCount) * 10_000) / 10_000 : job.cost;
  }
  const missing: ProjectJobRef[] = [];
  const images: string[] = [];
  const imageRoles: string[] = [];
  const videos: string[] = [];
  const videoRoles: string[] = [];
  const audios: string[] = [];
  for (const ref of job.refs) {
    if (!ref.url) {
      missing.push(ref);
      continue;
    }
    switch (ref.kind) {
      case "image":
        images.push(ref.url);
        imageRoles.push(ref.role ?? "character");
        break;
      case "video":
        videos.push(ref.url);
        videoRoles.push(ref.role ?? "character");
        break;
      case "audio":
        audios.push(ref.url);
        break;
      default: {
        const _never: never = ref.kind;
        return _never;
      }
    }
  }
  if (images.length > 0) {
    body.images = images;
    body.image_roles = imageRoles;
  }
  if (videos.length > 0) {
    body.videos = videos;
    body.video_roles = videoRoles;
  }
  if (audios.length > 0) body.audios = audios;
  return { body, missing };
}

/**
 * The cast with each item switched on when the job attached it and off when it did not.
 * Null when none of the job's references is in the cast any more.
 */
export function castMatchingJob(
  entries: readonly CastEntry[],
  items: readonly CastItem[],
  refs: readonly ProjectJobRef[],
): CastEntry[] | null {
  const wanted = new Set(refs.map((ref) => ref.key));
  if (!items.some((item) => wanted.has(item.key))) return null;
  return entries.map((entry) => {
    if (entry.type === "file") return { ...entry, active: wanted.has(entry.key) };
    const members = entry.items.map((item) =>
      item.excluded ? item : { ...item, active: wanted.has(item.key) },
    );
    return { ...entry, active: members.some((item) => !item.excluded && item.active), items: members };
  });
}

export type JobCastFile = { kind: CastKind; name: string; key: string; url: string | null };

/** Finished outputs with a Studio copy, ready to join the cast as loose items. */
export function castFilesForJob(
  job: Pick<ProjectJob, "prompt" | "basePrompt">,
  outputs: readonly ProjectJobOutput[],
): JobCastFile[] {
  const files: JobCastFile[] = [];
  for (const output of outputs) {
    if (output.status !== "succeeded" || !output.resultKey) continue;
    const kind = output.mediaType;
    if (kind !== "image" && kind !== "video" && kind !== "audio") continue;
    files.push({
      kind,
      key: output.resultKey,
      url: output.resultUrl,
      name: downloadFilename({
        id: output.id,
        mediaType: kind,
        prompt: job.basePrompt ?? job.prompt,
        resultUrl: output.resultUrl,
      }),
    });
  }
  return files;
}

export type JobFilter = { model: string; status: "" | "done" | "failed" | "running" };

export function filterJobs(jobs: readonly ProjectJob[], filter: JobFilter): ProjectJob[] {
  return jobs.filter((job) => {
    if (filter.model && job.model !== filter.model) return false;
    switch (filter.status) {
      case "":
        return true;
      case "done":
        return job.status === "succeeded";
      case "failed":
        return job.status === "failed" || job.status === "partial" || job.status === "cancelled";
      case "running":
        return job.status === "queued" || job.status === "running";
      default: {
        const _never: never = filter.status;
        return _never;
      }
    }
  });
}
