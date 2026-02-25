#!/usr/bin/env node
"use strict";

const { stdin, stdout } = process;

function emit(payload, code) {
  stdout.write(JSON.stringify(payload));
  process.exit(code);
}

function parseIsoDate(raw) {
  if (typeof raw === "string" && raw.trim()) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function extractReceiptId(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;

  const m1 = s.match(/\/receipt\/([^/]+)\//);
  if (m1) return m1[1];
  const m2 = s.match(/\/receipt\/([^/]+)$/);
  if (m2) return m2[1];
  if (/^[A-Za-z0-9_-]{8,}$/.test(s)) return s;
  return null;
}

function findReceiptIdDeep(value) {
  const direct = extractReceiptId(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const out = findReceiptIdDeep(item);
      if (out) return out;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;

  const obj = value;
  for (const key of [
    "id",
    "approvedReceiptUuid",
    "receiptUuid",
    "uuid",
    "printUrl",
    "receiptUrl",
    "url",
    "link",
  ]) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const out = findReceiptIdDeep(obj[key]);
      if (out) return out;
    }
  }
  for (const nested of Object.values(obj)) {
    const out = findReceiptIdDeep(nested);
    if (out) return out;
  }
  return null;
}

function classifyError(message) {
  const msg = String(message || "").toLowerCase();
  if (
    msg.includes("wrong password") ||
    msg.includes("invalid password") ||
    msg.includes("invalid credentials") ||
    msg.includes("unauthorized") ||
    msg.includes("auth failed") ||
    msg.includes("401")
  ) {
    return { status: 401, retryable: false };
  }
  if (msg.includes("429") || msg.includes("too many") || msg.includes("rate limit")) {
    return { status: 429, retryable: true };
  }
  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("connect") ||
    msg.includes("connection") ||
    msg.includes("network") ||
    msg.includes("socket")
  ) {
    return { status: 504, retryable: true };
  }
  return { status: 502, retryable: true };
}

async function main() {
  let MoyNalog;
  try {
    MoyNalog = require("moy-nalog");
  } catch (error) {
    emit(
      {
        ok: false,
        error: `moy-nalog import failed: ${error && error.message ? error.message : String(error)}`,
        status: 502,
        retryable: true,
      },
      1,
    );
    return;
  }

  let raw = "";
  for await (const chunk of stdin) {
    raw += String(chunk);
  }

  if (!raw.trim()) {
    emit({ ok: false, error: "empty input", status: 400, retryable: false }, 1);
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    emit({ ok: false, error: "invalid json input", status: 400, retryable: false }, 1);
    return;
  }

  const inn = String(payload.inn || "").trim();
  const password = String(payload.password || "").trim();
  const mode = String(payload.mode || "income").trim().toLowerCase();

  if (!inn || !password) {
    emit({ ok: false, error: "missing inn/password", status: 400, retryable: false }, 1);
    return;
  }
  if (!["income", "auth"].includes(mode)) {
    emit({ ok: false, error: "invalid mode", status: 400, retryable: false }, 1);
    return;
  }

  const client = new MoyNalog({
    username: inn,
    password,
  });

  try {
    if (mode === "auth") {
      if (typeof client.call === "function") {
        await client.call("incomes/summary");
      } else if (typeof client.addIncome === "function") {
        // Fallback auth probe if call() is unavailable.
        await client.addIncome({
          name: "Auth check",
          amount: 1.0,
        });
      }
      emit({ ok: true, message: "NaloGO auth successful" }, 0);
      return;
    }

    const name = String(payload.name || "").trim();
    const amountRaw = Number(payload.amountRub);
    const amount = Number.isFinite(amountRaw) ? Number(amountRaw.toFixed(2)) : NaN;
    if (!name) {
      emit({ ok: false, error: "missing income name", status: 400, retryable: false }, 1);
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      emit({ ok: false, error: "invalid amount", status: 400, retryable: false }, 1);
      return;
    }

    const opTime = parseIsoDate(payload.operationTimeIso);
    let receipt = null;
    if (typeof client.addIncome === "function") {
      // Preferred official helper path.
      try {
        receipt = await client.addIncome({ name, amount });
      } catch {
        // Backward-compat path used by old releases of the package.
        receipt = await client.addIncome(opTime, amount, name);
      }
    } else if (typeof client.call === "function") {
      const dateToLocalISO =
        typeof client.dateToLocalISO === "function"
          ? (d) => client.dateToLocalISO(d)
          : (d) => d.toISOString();
      receipt = await client.call("income", {
        paymentType: "CASH",
        inn: null,
        ignoreMaxTotalIncomeRestriction: false,
        client: {
          contactPhone: null,
          displayName: null,
          incomeType: "FROM_INDIVIDUAL",
        },
        requestTime: dateToLocalISO(new Date()),
        operationTime: dateToLocalISO(opTime),
        services: [
          {
            name,
            amount,
            quantity: 1,
          },
        ],
        totalAmount: amount,
      });
    } else {
      emit(
        {
          ok: false,
          error: "moy-nalog client does not expose addIncome/call methods",
          status: 502,
          retryable: false,
        },
        1,
      );
      return;
    }

    const receiptId = findReceiptIdDeep(receipt);
    if (!receiptId) {
      const snippet = String(receipt).slice(0, 350);
      emit(
        {
          ok: false,
          error: `moy-nalog did not return receipt id: ${snippet}`,
          status: 502,
          retryable: true,
        },
        1,
      );
      return;
    }

    const printUrl =
      receipt && typeof receipt === "object" && typeof receipt.printUrl === "string"
        ? receipt.printUrl
        : null;
    emit({ ok: true, receiptUuid: receiptId, receiptUrl: printUrl }, 0);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    const mapped = classifyError(message);
    emit(
      {
        ok: false,
        error: `moy-nalog request failed: ${message}`,
        status: mapped.status,
        retryable: mapped.retryable,
      },
      1,
    );
  }
}

main();
