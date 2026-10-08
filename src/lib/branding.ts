import { useCallback, useEffect, useState } from "react";
import { api, type InstanceBranding } from "./api";
import { setActiveBranding } from "./pwa";

export const DEFAULT_SITE_NAME = "Oxen Studio";
export const DEFAULT_LOGO_URL = "/oxen-logo.svg";

/** Class for the header mark. The bundled Oxen glyph is cropped tight into a circle. */
export function brandMarkClass(url: string): string {
  const path = url.split("?")[0] ?? url;
  const bundled = path === DEFAULT_LOGO_URL || path.endsWith("/oxen-logo.svg");
  return bundled ? "brand-mark-img is-bundled" : "brand-mark-img";
}

export const DEFAULT_BRANDING: InstanceBranding = {
  name: DEFAULT_SITE_NAME,
  savedName: null,
  logoUrl: DEFAULT_LOGO_URL,
  logoType: "image/svg+xml",
  customLogo: false,
};

export function applyDocumentBranding(branding: InstanceBranding) {
  if (typeof document === "undefined") return;
  document.title = branding.name;
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) {
    icon.type = branding.logoType || "image/svg+xml";
    icon.href = branding.logoUrl;
  }
  const apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (apple) apple.href = branding.logoUrl;
  const appTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
  if (appTitle) appTitle.content = branding.name;
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (description) description.content = `${branding.name} — image and video generation`;
  setActiveBranding(branding.name, branding.logoUrl);
}

export function useInstanceBranding() {
  const [branding, setBrandingState] = useState<InstanceBranding>(DEFAULT_BRANDING);

  const setBranding = useCallback((next: InstanceBranding) => {
    setBrandingState(next);
    applyDocumentBranding(next);
  }, []);

  const refresh = useCallback(async () => {
    const next = await api.branding();
    setBranding(next);
    return next;
  }, [setBranding]);

  useEffect(() => {
    void refresh().catch(() => {
      applyDocumentBranding(DEFAULT_BRANDING);
    });
  }, [refresh]);

  return { branding, setBranding, refresh };
}
