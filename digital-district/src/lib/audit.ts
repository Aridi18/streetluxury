import type { Prisma, User } from "@prisma/client";
import { db, type Tx } from "./db";

type Actor = Pick<User, "id" | "name"> | null;

/** Records a significant administrative action. */
export async function audit(
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | null,
  summary?: string,
  data?: Prisma.InputJsonValue,
  client: Tx | typeof db = db,
) {
  await client.auditLog.create({
    data: { actorId: actor?.id ?? null, actorName: actor?.name ?? "System", action, entity, entityId, summary, data },
  });
}
