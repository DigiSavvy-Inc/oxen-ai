import type { ComposerPreset } from "./api";

export function suggestedPresetName(input: {
  numGenerations: number;
  aspectRatio?: string;
  quality?: string;
  resolution?: string;
}): string {
  const parts = [`${Math.min(4, Math.max(1, Math.round(input.numGenerations || 1)))}×`];
  if (input.aspectRatio?.trim()) parts.push(input.aspectRatio.trim());
  if (input.quality?.trim()) parts.push(input.quality.trim());
  if (input.resolution?.trim()) parts.push(input.resolution.trim());
  return parts.join(" · ").slice(0, 40);
}

export function presetSummary(preset: ComposerPreset): string {
  const parts = [`${preset.numGenerations}×`];
  if (preset.aspectRatio) parts.push(preset.aspectRatio);
  if (preset.quality) parts.push(preset.quality);
  if (preset.resolution) parts.push(preset.resolution);
  if (preset.duration) parts.push(preset.duration);
  return parts.join(" · ");
}

export function presetFromControls(input: {
  id: string;
  name: string;
  numGenerations: number;
  aspectRatio?: string;
  quality?: string;
  resolution?: string;
  duration?: string;
  generateAudio?: boolean;
  outputFormat?: string;
}): ComposerPreset {
  const preset: ComposerPreset = {
    id: input.id,
    name: input.name.trim().slice(0, 40) || suggestedPresetName(input),
    numGenerations: Math.min(4, Math.max(1, Math.round(input.numGenerations || 1))),
  };
  if (input.aspectRatio?.trim()) preset.aspectRatio = input.aspectRatio.trim();
  if (input.quality?.trim()) preset.quality = input.quality.trim();
  if (input.resolution?.trim()) preset.resolution = input.resolution.trim();
  if (input.duration?.trim()) preset.duration = input.duration.trim();
  if (input.outputFormat?.trim()) preset.outputFormat = input.outputFormat.trim();
  if (typeof input.generateAudio === "boolean") preset.generateAudio = input.generateAudio;
  return preset;
}
