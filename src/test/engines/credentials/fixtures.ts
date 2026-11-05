import type { Credential, CredAttempt, Username } from "../../../types/credentials";
import type { Host } from "../../../types/host";
import type { Service } from "../../../types/service";

export const NT = "31d6cfe0d16ae931b73c59d7e0c089c0";

export const host = (id: string, extra: Partial<Host> = {}): Host => ({
  id, engagementId: "eng1", name: id, ip: null, os: null, boardColumn: "enumerate", boardManual: false,
  access: "none", createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
  ...extra,
});

export const svc = (hostId: string, port: number, nmapService = "", state = "open"): Service => ({
  id: `${hostId}:${port}`, hostId, port, protocol: "tcp", state, nmapService: nmapService || null,
  nmapVersion: null, confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, createdAt: 0, updatedAt: 0,
});

/** A host with an ip and open services on the given ports. */
export const hostWith = (id: string, ip: string, ports: number[]): { host: Host; services: Service[] } => ({
  host: host(id, { ip }),
  services: ports.map((p) => svc(id, p)),
});

export const byHost = (...hs: { host: Host; services: Service[] }[]): Map<string, Service[]> =>
  new Map(hs.map((h) => [h.host.id, h.services]));

export const cred = (extra: Partial<Credential> = {}): Credential => ({
  id: "c1", engagementId: "eng1", type: "password", username: "u", domain: null, secret: "pw", hashType: null,
  scope: "domain", localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null,
  crackedFrom: null, fromSecretId: null, createdAt: 0, updatedAt: 0, ...extra,
});

let n = 0;
export const att = (extra: Partial<CredAttempt> = {}): CredAttempt => ({
  id: `a${n++}`, engagementId: "eng1", credId: "c1", usernameId: null, hostId: "h1", service: "smb", port: null,
  result: "failed", authMode: "domain", detail: null, logEntryId: null, at: 1000, ...extra,
});

export const user = (id: string, username: string, extra: Partial<Username> = {}): Username => ({
  id, engagementId: "eng1", username, domain: null, sourceHostId: null, source: null, createdAt: 0, ...extra,
});
