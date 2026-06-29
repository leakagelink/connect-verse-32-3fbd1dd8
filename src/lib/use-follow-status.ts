import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFollowStatusBatch } from "@/lib/follows.functions";

export type FollowStatus = "accepted" | "pending" | null;

/** Batch-fetch outgoing follow status (me -> them) for a list of user ids. */
export function useFollowStatusMap(userIds: string[]) {
  const fn = useServerFn(getFollowStatusBatch);
  const ids = [...new Set(userIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["follow-status", ids],
    queryFn: () => fn({ data: { userIds: ids } }) as Promise<Record<string, FollowStatus>>,
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
}
