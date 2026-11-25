import { registerReads } from "../../lib/storeChange";

export const payloadBuildsKey = (eid: string) => ["payloadBuilds", eid] as const;

registerReads(["payloadBuilds"], ["payloadBuild"]);
