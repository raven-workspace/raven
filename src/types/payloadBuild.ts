/** The LHOST/LPORT a baked payload (served script, msfvenom file, uploaded shell) was last built with for a host. */
export interface PayloadBuild {
  engagementId: string;
  hostId: string;
  payloadId: string;
  lhost: string;
  lport: string;
  at: number;
}
