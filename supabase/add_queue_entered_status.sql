-- queues: 입장 승인(entered) 상태 추가 (Supabase SQL Editor에서 1회 실행)

alter table sck.queues drop constraint if exists queues_status_check;

alter table sck.queues
  add constraint queues_status_check
  check (status in ('waiting', 'entered', 'ordering', 'completed', 'cancelled'));
