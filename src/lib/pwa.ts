import { generationNotifyCopy, type GenerationNotifyInput } from "../../worker/notify-copy";
import { api } from "./api";

const NOTIFIED_KEY = "ds-studio-notified-ids";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredInstall: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function readNotified(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(NOTIFIED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function markNotified(id: string) {
  const next = readNotified();
  next.add(id);
  try {
    window.sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify([...next].slice(-80)));
  } catch {
    /* ignore quota */
  }
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export function canUseNotifications(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

export function canUsePush(): boolean {
  return canUseNotifications() && "PushManager" in window;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export function listenForInstallPrompt(): () => void {
  function onPrompt(event: Event) {
    event.preventDefault();
    deferredInstall = event as BeforeInstallPromptEvent;
    for (const listener of installListeners) listener();
  }
  window.addEventListener("beforeinstallprompt", onPrompt);
  return () => window.removeEventListener("beforeinstallprompt", onPrompt);
}

export function canPromptInstall(): boolean {
  return deferredInstall != null;
}

export function onInstallAvailable(listener: () => void): () => void {
  installListeners.add(listener);
  return () => {
    installListeners.delete(listener);
  };
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredInstall) return "unavailable";
  const event = deferredInstall;
  deferredInstall = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  for (const listener of installListeners) listener();
  return outcome;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!canUsePush()) return null;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export async function enablePushNotifications(): Promise<{
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
}> {
  if (!canUseNotifications()) {
    return { permission: "unsupported", subscribed: false };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { permission, subscribed: false };
  }
  await registerServiceWorker();
  if (!canUsePush()) {
    return { permission, subscribed: false };
  }
  const config = await api.pushConfig();
  if (!config.enabled || !config.vapidPublicKey) {
    return { permission, subscribed: false };
  }
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
    const applicationServerKey = Uint8Array.from(
      urlBase64ToUint8Array(config.vapidPublicKey),
    );
    const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    }));
  await api.subscribePush(subscription.toJSON());
  return { permission, subscribed: true };
}

export async function disablePushNotifications(): Promise<void> {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  try {
    await api.unsubscribePush(subscription.endpoint);
  } catch {
    /* still drop the browser subscription */
  }
  await subscription.unsubscribe();
}

export async function notifyGenerationLocal(generation: GenerationNotifyInput): Promise<void> {
  if (!canUseNotifications() || Notification.permission !== "granted") return;
  if (readNotified().has(generation.id)) return;
  const push = await currentPushSubscription();
  if (push) return;
  markNotified(generation.id);
  const copy = generationNotifyCopy(generation);
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (registration) {
    await registration.showNotification(copy.title, {
      body: copy.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: copy.tag,
      data: { url: copy.url },
    });
    return;
  }
  new Notification(copy.title, { body: copy.body, icon: "/icon-192.png", tag: copy.tag });
}

export function bootPwa() {
  void registerServiceWorker();
  listenForInstallPrompt();
}
