export const FREE_OPERATIONS = 3;
export function canStartOperation(completedOperations: number, subscribed: boolean) { return subscribed || completedOperations < FREE_OPERATIONS; }
export function entitlementMessage(completedOperations: number, subscribed: boolean) { if (subscribed) return 'Active subscription'; if (completedOperations < FREE_OPERATIONS) return `${FREE_OPERATIONS - completedOperations} free analyses remaining`; return 'Subscription required'; }
