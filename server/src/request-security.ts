export interface OriginCheckInput {
  origin: string | undefined;
  host: string | undefined;
  forwardedHost?: string;
  forwardedProtocol?: string;
  secureCookies: boolean;
  allowedOrigins: ReadonlySet<string>;
}

export function configuredAllowedOrigins(value: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const item of value?.split(",") ?? []) {
    const normalized = normalizeOrigin(item);
    if (normalized) origins.add(normalized);
  }
  return origins;
}

export function isAllowedMutationOrigin(input: OriginCheckInput): boolean {
  if (!input.origin) return true;
  const origin = normalizeOrigin(input.origin);
  if (!origin) return false;

  const publicHost = firstForwardedValue(input.forwardedHost) || input.host;
  const publicProtocol = firstForwardedValue(input.forwardedProtocol)
    || (input.secureCookies ? "https" : "http");
  if (publicHost && origin === `${publicProtocol}://${publicHost}`) return true;

  return input.allowedOrigins.has(origin);
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function firstForwardedValue(value: string | undefined): string | undefined {
  return value?.split(",")[0]?.trim().toLowerCase() || undefined;
}
