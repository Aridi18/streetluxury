import { db, type Tx } from "./db";
import type { Permission } from "./permissions";

/** In-app notification for staff holding `permission`. */
export async function notifyStaff(
  n: { type: string; title: string; body?: string; link?: string; permission?: Permission },
  client: Tx | typeof db = db,
) {
  await client.notification.create({
    data: { type: n.type, title: n.title, body: n.body, link: n.link, permission: n.permission ?? "dashboard.view" },
  });
}
