/** The user's call on a service. `null` on the service means no call yet. */
export type ServiceVerdict = "candidate" | "untested" | "dead_end";

/** Mirrors the Rust `HostIdentity`: who the user is on a host. One per host. */
export interface HostIdentity {
  hostId: string;
  username: string;
  privileges: string[];
  groups: string[];
  entryId: string | null;
  updatedAt: number;
}

export type VectorStatus = "try" | "untested" | "ruled_out";
export type VectorSource = "auto" | "manual";

/** Mirrors the Rust `PrivescVector`. */
export interface PrivescVector {
  id: string;
  hostId: string;
  title: string;
  status: VectorStatus;
  source: VectorSource;
  createdAt: number;
  updatedAt: number;
}

/** Mirrors the Rust `VectorInput`. */
export interface VectorInput {
  title: string;
  status: VectorStatus;
  source: VectorSource;
}
