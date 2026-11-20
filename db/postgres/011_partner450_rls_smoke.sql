-- Disposable PostgreSQL RLS role matrix: two users, two purchases, one referrer.
INSERT INTO partner450_orders(id,buyer_id,org_id,package_id,amount_cents,currency,status,created_at,updated_at)
 VALUES ('r7_order_alice','u_alice','o_alice','growth_setup_40k',4000000,'RUB','issued','2026-11-20','2026-11-20'),
        ('r7_order_bob','u_bob','o_bob','enterprise_setup_200k',20000000,'RUB','paid','2026-11-20','2026-11-20');
INSERT INTO partner450_commissions(id,order_id,buyer_id,referrer_id,initial_cents,amount_cents,status,held_until,created_at,updated_at)
 VALUES ('r7_commission_bob','r7_order_bob','u_bob','u_alice',2000000,2000000,'pending','2026-12-04','2026-11-20','2026-11-20');
BEGIN;
SET LOCAL ROLE proof_app;
SELECT set_config('app.user_id','u_alice',true);
SELECT 1 / CASE WHEN (SELECT COUNT(*) FROM partner450_orders)=1 THEN 1 ELSE 0 END AS alice_can_only_read_own_orders;
SELECT 1 / CASE WHEN (SELECT COUNT(*) FROM partner450_commissions)=1 THEN 1 ELSE 0 END AS alice_reads_only_own_commissions;
ROLLBACK;
BEGIN;
SET LOCAL ROLE proof_app;
SELECT set_config('app.user_id','u_bob',true);
SELECT 1 / CASE WHEN (SELECT COUNT(*) FROM partner450_orders)=1 THEN 1 ELSE 0 END AS bob_can_only_read_own_orders;
SELECT 1 / CASE WHEN (SELECT COUNT(*) FROM partner450_commissions)=0 THEN 1 ELSE 0 END AS bob_cannot_read_alices_commission;
ROLLBACK;
BEGIN;
SET LOCAL ROLE proof_app;
SELECT 1 / CASE WHEN (SELECT COUNT(*) FROM partner450_orders)=0 THEN 1 ELSE 0 END AS no_actor_no_orders;
SELECT 1 / CASE WHEN (SELECT COUNT(*) FROM partner450_commissions)=0 THEN 1 ELSE 0 END AS no_actor_no_commissions;
ROLLBACK;
