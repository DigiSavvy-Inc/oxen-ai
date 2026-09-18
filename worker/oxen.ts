const OXEN_BASE = "https://hub.oxen.ai/api/ai";

export type OxenModel = {
  id: string;
  display_name?: string;
  description?: string | null;
  endpoint?: string;
  capabilities?: {
    input?: string[];
    output?: string[];
  };
  pricing?: Record<string, unknown>;
  request_schema?: Record<string, unknown> | null;
  developer?: { name?: string; logo?: string } | null;
};

async function oxenFetch(
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${OXEN_BASE}${path}`, { ...init, headers });
}

export async function listModels(apiKey: string): Promise<OxenModel[]> {
  const res = await oxenFetch("/models", apiKey);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Oxen models failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { data?: OxenModel[] };
  return data.data ?? [];
}

export async function enqueueGeneration(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ generation_id: string; status: string }[]> {
  const res = await oxenFetch("/queue", apiKey, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    generations?: { generation_id: string; status: string }[];
    error?: { message?: string; detail?: string; title?: string };
    status_message?: string;
  };
  if (!res.ok) {
    throw new Error(
      data.error?.detail ||
        data.error?.message ||
        data.error?.title ||
        data.status_message ||
        `Oxen enqueue failed (${res.status})`,
    );
  }
  return data.generations ?? [];
}

export async function getGeneration(
  apiKey: string,
  generationId: string,
): Promise<Record<string, unknown>> {
  const res = await oxenFetch(`/queue/${encodeURIComponent(generationId)}`, apiKey);
  const data = (await res.json()) as Record<string, unknown> & {
    error?: { message?: string; detail?: string };
  };
  if (!res.ok) {
    throw new Error(
      data.error?.detail ||
        data.error?.message ||
        `Oxen status failed (${res.status})`,
    );
  }
  return data;
}

export async function listQueue(
  apiKey: string,
  query: URLSearchParams,
): Promise<Record<string, unknown>> {
  const qs = query.toString();
  const res = await oxenFetch(`/queue${qs ? `?${qs}` : ""}`, apiKey);
  const data = (await res.json()) as Record<string, unknown> & {
    error?: { message?: string; detail?: string };
  };
  if (!res.ok) {
    throw new Error(
      data.error?.detail ||
        data.error?.message ||
        `Oxen queue list failed (${res.status})`,
    );
  }
  return data;
}

export async function cancelGeneration(
  apiKey: string,
  generationId: string,
): Promise<void> {
  const res = await oxenFetch(`/queue/${encodeURIComponent(generationId)}`, apiKey, {
    method: "DELETE",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Oxen cancel failed (${res.status}): ${text}`);
  }
}
