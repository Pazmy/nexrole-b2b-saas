export const ROLE = {
  SUPER_ADMIN: "SuperAdmin",
  MEMBER: "Member",
  DEVELOPER: "Developer",
} as const;

export const SUBSCRIPTION_STATUS = {
  PAST_DUE: "past_due",
  UNPAID: "unpaid",
  ACTIVE: "active",
  FREE: "free",
  CANCELED: "canceled",
} as const;
