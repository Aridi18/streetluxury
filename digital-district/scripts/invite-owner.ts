// Creates a one-time invitation link for the store owner (or another Owner-level admin).
// Run on the server:  npm run owner:invite -- owner@example.com "Owner Name"
// The link is printed here (and emailed if SMTP is configured). It expires after 72 hours and works once.
// No password is ever generated, stored in code, or printed.
import { PrismaClient } from "@prisma/client";
import { createStaffInvitation } from "../src/lib/accounts";

const db = new PrismaClient();

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Usage: npm run owner:invite -- owner@example.com "Owner Name"');
    process.exit(1);
  }
  const url = await createStaffInvitation(email.toLowerCase(), "OWNER", nameParts.join(" ") || null, null);
  console.log("\nOwner invitation created. Open this link within 72 hours to set your password:\n");
  console.log(`  ${url}\n`);
  console.log("Keep this link private — anyone who opens it can create the owner account.\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
