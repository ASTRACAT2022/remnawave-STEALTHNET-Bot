"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "../../components/admin-shell";
import { Card, Notice, SmallButton } from "../../components/ui";
import { apiRequest, formatDate } from "../../lib/api";

type User = { id: string; short_id: string; status: string };
type Squad = { id: string; name: string };

type Plan = {
  id: string;
  name: string;
  price: number;
  currency: string;
  duration_days: number;
  traffic_limit_bytes: number;
  max_devices: number;
  is_active: boolean;
  squad_id?: string | null;
};

type Order = {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  total_amount: number;
  currency: string;
  created_at: string;
  paid_at: string | null;
};

type Payment = {
  id: string;
  order_id: string;
  provider: string;
  external_payment_id: string;
  status: string;
  amount: number;
  currency: string;
};

type ReconcileResult = {
  dry_run: boolean;
  total_users_checked: number;
  eligible_users: number;
  users_to_update: number;
  users_updated: number;
  skipped_without_plan_mapping: number;
  changed_user_ids: string[];
};

export default function ClientBillingPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null);

  const [planForm, setPlanForm] = useState({
    name: "",
    price: "9.99",
    currency: "USD",
    duration_days: "30",
    traffic_limit_bytes: "0",
    max_devices: "3",
    squad_id: "",
  });

  const [orderForm, setOrderForm] = useState({ user_id: "", plan_id: "" });
  const [paymentForm, setPaymentForm] = useState({ order_id: "", external_payment_id: "", provider: "manual" });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [userData, squadData, planData, orderData, paymentData] = await Promise.all([
        apiRequest<{ items: User[] }>("/api/v1/users?limit=200").then((x) => x.items),
        apiRequest<Squad[]>("/api/v1/squads"),
        apiRequest<Plan[]>("/api/v1/plans"),
        apiRequest<Order[]>("/api/v1/orders?limit=200"),
        apiRequest<Payment[]>("/api/v1/payments?limit=200"),
      ]);
      setUsers(userData);
      setSquads(squadData);
      setPlans(planData);
      setOrders(orderData);
      setPayments(paymentData);
      if (!orderForm.user_id && userData.length > 0) {
        setOrderForm((prev) => ({ ...prev, user_id: userData[0].id }));
      }
      if (!orderForm.plan_id && planData.length > 0) {
        setOrderForm((prev) => ({ ...prev, plan_id: planData[0].id }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing data");
    }
  }, [orderForm.user_id, orderForm.plan_id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>, ok: string) {
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  return (
    <AdminShell
      title="Client Billing"
      subtitle="Plans, orders and payment activation"
      actions={<SmallButton onClick={() => void load()}>Refresh</SmallButton>}
    >
      <Notice type="error" message={error} />
      <Notice type="success" message={success} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Create Plan">
          <div className="space-y-2">
            <input className="input" placeholder="Name" value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Price" value={planForm.price} onChange={(e) => setPlanForm({ ...planForm, price: e.target.value })} />
              <input
                className="input"
                placeholder="Currency"
                value={planForm.currency}
                onChange={(e) => setPlanForm({ ...planForm, currency: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className="input"
                placeholder="Duration days"
                value={planForm.duration_days}
                onChange={(e) => setPlanForm({ ...planForm, duration_days: e.target.value })}
              />
              <input
                className="input"
                placeholder="Max devices"
                value={planForm.max_devices}
                onChange={(e) => setPlanForm({ ...planForm, max_devices: e.target.value })}
              />
            </div>
            <input
              className="input"
              placeholder="Traffic limit bytes"
              value={planForm.traffic_limit_bytes}
              onChange={(e) => setPlanForm({ ...planForm, traffic_limit_bytes: e.target.value })}
            />
            <select className="select" value={planForm.squad_id} onChange={(e) => setPlanForm({ ...planForm, squad_id: e.target.value })}>
              <option value="">No squad binding</option>
              {squads.map((squad) => (
                <option key={squad.id} value={squad.id}>
                  {squad.name}
                </option>
              ))}
            </select>
            <button
              className="btn"
              type="button"
              disabled={!planForm.name.trim()}
              onClick={() =>
                void run(
                  async () => {
                    await apiRequest("/api/v1/plans", {
                      method: "POST",
                      body: JSON.stringify({
                        name: planForm.name,
                        price: Number(planForm.price),
                        currency: planForm.currency,
                        duration_days: Number(planForm.duration_days),
                        traffic_limit_bytes: Number(planForm.traffic_limit_bytes),
                        max_devices: Number(planForm.max_devices),
                        squad_id: planForm.squad_id || null,
                      }),
                    });
                    setPlanForm({
                      name: "",
                      price: "9.99",
                      currency: "USD",
                      duration_days: "30",
                      traffic_limit_bytes: "0",
                      max_devices: "3",
                      squad_id: "",
                    });
                  },
                  "Plan created",
                )
              }
            >
              Create Plan
            </button>
          </div>
        </Card>

        <Card title="Create Order">
          <div className="space-y-2">
            <select className="select" value={orderForm.user_id} onChange={(e) => setOrderForm({ ...orderForm, user_id: e.target.value })}>
              <option value="">Select user</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.short_id} ({user.status})
                </option>
              ))}
            </select>
            <select className="select" value={orderForm.plan_id} onChange={(e) => setOrderForm({ ...orderForm, plan_id: e.target.value })}>
              <option value="">Select plan</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} ({plan.price} {plan.currency})
                </option>
              ))}
            </select>
            <button
              className="btn"
              type="button"
              disabled={!orderForm.user_id || !orderForm.plan_id}
              onClick={() =>
                void run(
                  async () => {
                    const idempotencyKey = `order-${Date.now()}`;
                    await apiRequest("/api/v1/orders", {
                      method: "POST",
                      headers: { "Idempotency-Key": idempotencyKey },
                      body: JSON.stringify({ user_id: orderForm.user_id, plan_id: orderForm.plan_id }),
                    });
                  },
                  "Order created",
                )
              }
            >
              Create Order
            </button>
          </div>
        </Card>

        <Card title="Confirm Payment">
          <div className="space-y-2">
            <select className="select" value={paymentForm.order_id} onChange={(e) => setPaymentForm({ ...paymentForm, order_id: e.target.value })}>
              <option value="">Select order</option>
              {orders.filter((o) => o.status !== "paid").map((order) => (
                <option key={order.id} value={order.id}>
                  {order.id.slice(0, 8)} ({order.total_amount} {order.currency})
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="external_payment_id"
              value={paymentForm.external_payment_id}
              onChange={(e) => setPaymentForm({ ...paymentForm, external_payment_id: e.target.value })}
            />
            <input className="input" placeholder="provider" value={paymentForm.provider} onChange={(e) => setPaymentForm({ ...paymentForm, provider: e.target.value })} />
            <button
              className="btn"
              type="button"
              disabled={!paymentForm.order_id || !paymentForm.external_payment_id}
              onClick={() =>
                void run(
                  async () => {
                    await apiRequest("/api/v1/payments/confirm", {
                      method: "POST",
                      body: JSON.stringify(paymentForm),
                    });
                    setPaymentForm({ order_id: "", external_payment_id: "", provider: "manual" });
                  },
                  "Payment confirmed and subscription activated",
                )
              }
            >
              Confirm Payment
            </button>
          </div>
        </Card>
      </div>

      <Card title="User Squad Recovery">
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary"
            type="button"
            onClick={() =>
              void run(
                async () => {
                  const result = await apiRequest<ReconcileResult>("/api/v1/plans/reconcile-user-squads", {
                    method: "POST",
                    body: JSON.stringify({ dry_run: true }),
                  });
                  setReconcileResult(result);
                },
                "Dry-run completed",
              )
            }
          >
            Dry-run Reconcile
          </button>
          <button
            className="btn"
            type="button"
            onClick={() =>
              void run(
                async () => {
                  const result = await apiRequest<ReconcileResult>("/api/v1/plans/reconcile-user-squads", {
                    method: "POST",
                    body: JSON.stringify({ dry_run: false }),
                  });
                  setReconcileResult(result);
                },
                "Reconcile applied",
              )
            }
          >
            Apply Reconcile
          </button>
        </div>
        {reconcileResult ? (
          <pre className="mt-3 overflow-x-auto rounded-md bg-black/5 p-2 text-xs">{JSON.stringify(reconcileResult, null, 2)}</pre>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Plans">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Squad</th>
                  <th>Price</th>
                  <th>Duration</th>
                  <th>Limit</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id}>
                    <td>{plan.name}</td>
                    <td>{squads.find((squad) => squad.id === plan.squad_id)?.name ?? "-"}</td>
                    <td>
                      {plan.price} {plan.currency}
                    </td>
                    <td>{plan.duration_days}d</td>
                    <td>{plan.traffic_limit_bytes}</td>
                  </tr>
                ))}
                {plans.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-black/50">
                      No plans yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Orders & Payments">
          <div className="space-y-3">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 12).map((order) => (
                    <tr key={order.id}>
                      <td className="font-mono text-xs">{order.id.slice(0, 10)}</td>
                      <td>{order.status}</td>
                      <td>
                        {order.total_amount} {order.currency}
                      </td>
                      <td>{formatDate(order.created_at)}</td>
                    </tr>
                  ))}
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-black/50">
                        No orders
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <p className="label">Recent Payments</p>
            <div className="space-y-1">
              {payments.slice(0, 8).map((payment) => (
                <div key={payment.id} className="rounded-lg border border-black/10 px-3 py-2 text-xs">
                  {payment.provider} / {payment.status} / {payment.amount} {payment.currency} ({payment.external_payment_id})
                </div>
              ))}
              {payments.length === 0 ? <p className="text-xs text-black/55">No payments yet.</p> : null}
            </div>
          </div>
        </Card>
      </div>
    </AdminShell>
  );
}
