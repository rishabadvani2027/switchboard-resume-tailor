export const FREE_OPERATIONS = 3;
export const PRO_PRICE_USD = 9.99;

export function canStartOperation(completedOperations: number, subscribed: boolean) {
  return subscribed || completedOperations < FREE_OPERATIONS;
}

export function entitlementMessage(completedOperations: number, subscribed: boolean) {
  if (subscribed) return 'Active subscription';
  if (completedOperations < FREE_OPERATIONS) {
    const remaining = FREE_OPERATIONS - completedOperations;
    return `${remaining} free ${remaining === 1 ? 'analysis' : 'analyses'} remaining`;
  }
  return 'Subscription required';
}
