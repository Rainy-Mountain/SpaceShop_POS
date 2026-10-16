/** 결제 식별자는 시각이 아닌 저장된 영수증/주문 ID를 사용한다. */
export function paymentKey(log: {
  id: string;
  paymentGroupId?: string | null;
  orderId?: string | null;
}): string {
  if (log.paymentGroupId) return `pg:${log.paymentGroupId}`;
  if (log.orderId) return `ord:${log.orderId}`;
  // ID가 없는 과거 데이터는 같은 초에 발생했다는 이유로 합치지 않는다.
  return `legacy:${log.id}`;
}

export function countPayments(logs: Parameters<typeof paymentKey>[0][]): number {
  return new Set(logs.map(paymentKey)).size;
}
