import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

export type OrdersChangePayload = RealtimePostgresChangesPayload<{
  [key: string]: unknown;
}>;

type SubscribeOrdersOptions = {
  /** 채널 이름 접두사 (고유 suffix 자동 부여) */
  channelPrefix: string;
  /** INSERT / UPDATE 수신 시 호출 */
  onChange: (payload: OrdersChangePayload) => void;
  /** order_items 변화도 감지할지 (키오스크 대기열 품목 반영용) */
  includeOrderItems?: boolean;
  /** UPDATE만 특정 order id 필터 (손님 결제 완료 감지) */
  orderIdFilter?: string;
  onStatus?: (status: string, err?: Error) => void;
};

/**
 * orders(·order_items) Realtime 구독.
 * - INSERT / UPDATE / DELETE 명시 구독
 * - 언마운트 시 channel.unsubscribe + removeChannel
 * - React Strict Mode 중복 구독 방지를 위해 채널명에 고유 suffix 사용
 */
export function subscribeOrdersRealtime(
  options: SubscribeOrdersOptions
): () => void {
  const supabase = getSupabase();
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const channelName = `${options.channelPrefix}:${suffix}`;
  let channel: RealtimeChannel = supabase.channel(channelName);

  const handleChange = (payload: OrdersChangePayload) => {
    options.onChange(payload);
  };

  if (options.orderIdFilter) {
    channel = channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "sck",
        table: "orders",
        filter: `id=eq.${options.orderIdFilter}`,
      },
      handleChange
    );
    // filter + REPLICA IDENTITY 미설정 환경을 위한 폴백 (클라이언트에서 id 재확인)
    channel = channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "sck",
        table: "orders",
      },
      (payload) => {
        const next = (payload.new ?? {}) as { id?: string };
        if (String(next.id ?? "") === options.orderIdFilter) {
          handleChange(payload as OrdersChangePayload);
        }
      }
    );
  } else {
    channel = channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "sck", table: "orders" },
        handleChange
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "sck", table: "orders" },
        handleChange
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "sck", table: "orders" },
        handleChange
      );

    if (options.includeOrderItems) {
      channel = channel
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "sck", table: "order_items" },
          handleChange
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "sck", table: "order_items" },
          handleChange
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "sck", table: "order_items" },
          handleChange
        );
    }
  }

  channel.subscribe((status, err) => {
    if (status === "SUBSCRIBED") {
      console.info(`[realtime] ${channelName} subscribed`);
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.error(`[realtime] ${channelName} ${status}`, err);
    }
    options.onStatus?.(status, err);
  });

  return () => {
    void supabase.removeChannel(channel);
  };
}

/** DELETE payload에서 삭제된 orders.id 추출 (REPLICA IDENTITY FULL 필요) */
export function getDeletedOrderId(
  payload: OrdersChangePayload
): string | null {
  if (payload.eventType !== "DELETE") return null;
  if (payload.table && payload.table !== "orders") return null;
  const oldRow = (payload.old ?? {}) as { id?: string };
  const id = String(oldRow.id ?? "").trim();
  return id || null;
}
