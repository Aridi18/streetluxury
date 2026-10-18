import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { runScheduledJobs } from "@/lib/jobs";

/** Called by the scheduler with `Authorization: Bearer <CRON_SECRET>`. */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!env.cronSecret || !safeEqual(auth, `Bearer ${env.cronSecret}`)) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json(await runScheduledJobs());
}
