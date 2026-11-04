export type ServiceProtocol = "tcp" | "udp";

/** Mirrors the Rust `Service`. `nmap*` are scan guesses; `confirmed*` are only ever set by the user. */
export interface Service {
  id: string;
  hostId: string;
  port: number;
  protocol: ServiceProtocol;
  state: string;
  nmapService: string | null;
  nmapVersion: string | null;
  confirmedProduct: string | null;
  confirmedVersion: string | null;
  confirmedEntryId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Mirrors the Rust `ScanPort`: one parsed nmap port line. */
export interface ScanPort {
  port: number;
  protocol: ServiceProtocol;
  state: string;
  service: string;
  version: string;
}

/** Mirrors the Rust `ServiceInput` (create and full update). */
export interface ServiceInput {
  port: number;
  protocol?: ServiceProtocol;
  nmapService?: string | null;
  nmapVersion?: string | null;
}

/** Mirrors the Rust `ConfirmInput`. */
export interface ConfirmInput {
  product: string;
  version?: string | null;
  entryId?: string | null;
}
