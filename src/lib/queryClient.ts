import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { reportError } from "./lockSignal";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: reportError }),
    mutationCache: new MutationCache({ onError: reportError }),
    defaultOptions: {
      // Local IPC, not a network: no background refetching, no retries on errors like `locked`.
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
      mutations: { retry: false },
    },
  });
}
