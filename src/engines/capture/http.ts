import type { HostRef } from '../attribution';

export type HttpParts = {
  request: string;
  response: string | null;
  method: string;
  host: string | null;
  port: number | null;
  path: string;
};

export function httpParts(text: string): HttpParts {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  const respAt = lines.findIndex((l, i) => i > 0 && /^HTTP\/\d(\.\d)? \d{3}/.test(l));
  const reqLines = respAt === -1 ? lines : lines.slice(0, respAt);
  const request = reqLines.join('\n').trimEnd();
  const response = respAt === -1 ? null : lines.slice(respAt).join('\n').trimEnd();

  const [method = '', target = '/'] = (reqLines[0] ?? '').trim().split(/\s+/);
  let path = target;
  let host: string | null = null;
  let port: number | null = null;
  const abs = target.match(/^https?:\/\/([^/?#]+)(.*)$/i);
  if (abs) {
    path = abs[2] || '/';
    ({ host, port } = splitHostPort(abs[1]));
  }
  const header = reqLines.slice(1).find((l) => /^host:/i.test(l));
  if (header) {
    // The Host header names the host; a portless one keeps an absolute request line's port.
    const named = splitHostPort(header.replace(/^host:/i, '').trim());
    host = named.host ?? host;
    port = named.port ?? port;
  }
  return { request, response, method, host, port, path };
}

function splitHostPort(value: string): { host: string | null; port: number | null } {
  const m = value.match(/^(.*?)(?::(\d+))?$/);
  return { host: m?.[1] || null, port: m?.[2] ? Number(m[2]) : null };
}

export function httpTitle(parts: HttpParts, attributed: HostRef | null): string {
  const h = parts.host?.toLowerCase() ?? null;
  const same = !!h && !!attributed && (h === attributed.ip?.toLowerCase() || h === attributed.name.toLowerCase());
  const portPart = parts.port !== null ? `:${parts.port}` : '';
  const shown = same || !parts.host ? portPart : `${parts.host}${portPart}`;
  return `${parts.method} ${shown}${parts.path}`;
}
