import { getTrustedForwardedHeader } from "@/lib/trusted-proxy";

export function requestPublicOrigin(request: Request, configuredValue = process.env.NEXT_PUBLIC_SITE_URL || "") {
    const configured = normalizeHttpOrigin(configuredValue);
    const requestOrigin = resolveRequestOrigin(request);

    // A local development server may be reached through a different loopback
    // hostname/port than the value in NEXT_PUBLIC_SITE_URL (for example,
    // 127.0.0.1:3100 versus localhost:3000). In that case the request's
    // concrete origin is the trusted origin to use for same-origin checks.
    if (configured && !(isLoopbackOrigin(configured) && isLoopbackOrigin(requestOrigin))) return configured;
    return requestOrigin;
}

export function requestPublicOriginFromHeaders(headers: Headers, fallbackValue = "http://localhost:3000", configuredValue = process.env.NEXT_PUBLIC_SITE_URL || "") {
    const configured = normalizeHttpOrigin(configuredValue);
    const fallback = normalizeHttpOrigin(fallbackValue) || "http://localhost:3000";
    const requestOrigin = resolveHeadersOrigin(headers, fallback);

    if (configured && !(isLoopbackOrigin(configured) && isLoopbackOrigin(requestOrigin))) return configured;
    return requestOrigin;
}

export function normalizeHttpOrigin(value: string) {
    try {
        const url = new URL(value.trim().replace(/\/+$/, ""));
        return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
    } catch {
        return "";
    }
}

function hostnameFromHost(host: string) {
    try {
        return new URL(`http://${host}`).hostname;
    } catch {
        return "";
    }
}

function isLoopbackHostname(hostname: string) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isLoopbackOrigin(origin: string) {
    try {
        return isLoopbackHostname(new URL(origin).hostname);
    } catch {
        return false;
    }
}

function resolveRequestOrigin(request: Request) {
    const requestUrl = new URL(request.url);
    const host = getTrustedForwardedHeader(request.headers, "x-forwarded-host") || request.headers.get("host")?.trim() || requestUrl.host;
    const protocol = getTrustedForwardedHeader(request.headers, "x-forwarded-proto") || requestUrl.protocol.replace(/:$/, "");
    return normalizeHttpOrigin(`${protocol}://${host}`) || requestUrl.origin;
}

function resolveHeadersOrigin(headers: Headers, fallback: string) {
    const fallbackUrl = new URL(fallback);
    const host = getTrustedForwardedHeader(headers, "x-forwarded-host") || headers.get("host")?.trim() || fallbackUrl.host;
    const protocol = getTrustedForwardedHeader(headers, "x-forwarded-proto") || (isLoopbackHostname(hostnameFromHost(host)) ? "http" : "https");
    return normalizeHttpOrigin(`${protocol}://${host}`) || fallback;
}
