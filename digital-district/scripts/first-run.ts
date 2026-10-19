// First-run setup used by the local trial (docker-compose.local.yml): if no owner account exists yet,
// prints a one-time invitation link so you can create one. Never creates a password itself.
import { PrismaClient } from "@prisma/client";
import { createStaffInvitation } from "../src/lib/accounts";

const db = new PrismaClient();

async function main() {
  if (await db.user.count({ where: { role: "OWNER", isActive: true } })) {
    console.log("\nAn owner account already exists. Sign in at http://localhost:3000/login\n");
    return;
  }
  const email = process.env.LOCAL_OWNER_EMAIL || "owner@example.com";
  const url = await createStaffInvitation(email, "OWNER", "Owner", null);
  console.log("\n==============================================================");
  console.log(" Digital District is ready. Create your owner account here:");
  console.log(`   ${url}`);
  console.log(` (sign-in email: ${email} — link valid 72 hours, works once)`);
  console.log(" Store: http://localhost:3000    Admin: http://localhost:3000/admin");
  console.log("==============================================================\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
