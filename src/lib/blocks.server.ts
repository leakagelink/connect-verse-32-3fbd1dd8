/**
 * Shared block enforcement for server code.
 *
 * A block must stop every interaction path, not just chat: gifts, follow
 * requests, call invites and call starts all go through here.
 */

type MinimalClient = {
  from: (table: string) => {
    select: (cols: string) => {
      or: (filter: string) => { limit: (n: number) => Promise<{ data: unknown[] | null }> };
    };
  };
};

export async function isBlockedBetween(
  db: unknown,
  a: string,
  b: string,
): Promise<boolean> {
  const client = db as MinimalClient;
  const { data } = await client
    .from("blocks")
    .select("id")
    .or(
      `and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`,
    )
    .limit(1);
  return !!data && data.length > 0;
}

export async function assertNotBlocked(
  db: unknown,
  a: string,
  b: string,
  message = "You can't interact with this person.",
): Promise<void> {
  if (await isBlockedBetween(db, a, b)) {
    throw new Error(message);
  }
}
