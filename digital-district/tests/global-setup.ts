import { execSync } from "node:child_process";

// Applies migrations to the dedicated test database. Tests clear tables themselves (see tests/helpers.ts).
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://dd:dd@localhost:5432/digital_district_test";
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
