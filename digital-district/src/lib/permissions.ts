// Role-based access control. Roles are assigned per staff member by the owner;
// each role grants a fixed set of permissions that every admin page and action checks on the server.
import type { UserRole } from "@prisma/client";

export const PERMISSIONS = [
  "dashboard.view",
  "finance.view",
  "expenses.manage",
  "products.manage",
  "inventory.manage",
  "promotions.manage",
  "orders.view",
  "orders.manage",
  "orders.fulfill",
  "payments.verify",
  "refunds.manage",
  "customers.view",
  "customers.manage",
  "customers.export",
  "reviews.moderate",
  "support.manage",
  "content.manage",
  "settings.manage",
  "staff.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  CUSTOMER: "Customer",
  OWNER: "Owner / Super Admin",
  PRODUCT_MANAGER: "Product Manager",
  ORDER_MANAGER: "Order Manager",
  FULFILLMENT: "Fulfilment Staff",
  FINANCE: "Finance / Reports Viewer",
  SUPPORT: "Customer Support",
};

export const STAFF_ROLES: UserRole[] = ["OWNER", "PRODUCT_MANAGER", "ORDER_MANAGER", "FULFILLMENT", "FINANCE", "SUPPORT"];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  CUSTOMER: [],
  OWNER: PERMISSIONS,
  PRODUCT_MANAGER: ["dashboard.view", "products.manage", "inventory.manage", "promotions.manage", "content.manage", "reviews.moderate"],
  ORDER_MANAGER: ["dashboard.view", "orders.view", "orders.manage", "orders.fulfill", "payments.verify", "customers.view", "customers.manage", "support.manage"],
  FULFILLMENT: ["dashboard.view", "orders.view", "orders.fulfill", "inventory.manage"],
  FINANCE: ["dashboard.view", "finance.view", "expenses.manage", "orders.view", "payments.verify", "refunds.manage"],
  SUPPORT: ["dashboard.view", "orders.view", "customers.view", "customers.manage", "support.manage", "reviews.moderate"],
};

export function isStaffRole(role: UserRole): boolean {
  return role !== "CUSTOMER";
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
