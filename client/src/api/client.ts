export interface HealthResponse {
  status: 'ok';
  db: 'connected';
}

export interface ContactMessage {
  name: string;
  email: string;
  message: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    // Merged after the spread so a caller passing its own headers extends the
    // defaults instead of replacing them and losing Content-Type.
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request to ${path} failed with ${response.status}: ${body}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

/** POST /api/contact — the route is specified in the handoff but not built yet. */
export function sendContactMessage(message: ContactMessage): Promise<void> {
  return request<void>('/contact', {
    method: 'POST',
    body: JSON.stringify(message),
  });
}
