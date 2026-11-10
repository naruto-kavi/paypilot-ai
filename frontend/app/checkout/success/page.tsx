
"use client";

import { useEffect, useRef, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type PaymentResult = {
  success: boolean;
  message: string;
  order_id: string;
  capture_id?: string | null;
  status: string;
  capture_status?: string;
  product?: string;
  product_id?: number;
  quantity?: number;
  amount?: string;
  currency?: string;
  original_amount_inr?: string;
};

export default function CheckoutSuccessPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [alreadyCaptured, setAlreadyCaptured] = useState(false);
  const [payment, setPayment] = useState<PaymentResult | null>(null);
  const [orderId, setOrderId] = useState("");

  const captureStarted = useRef(false);

  async function capturePayment(id: string) {
    setLoading(true);
    setError("");
    setAlreadyCaptured(false);
    setPayment(null);

    try {
      const response = await fetch(
        `${API_URL}/api/payments/capture-order`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            order_id: id,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : "Payment capture could not be completed.";

        // PayPal orders cannot be captured more than once.
        // Do not attempt another capture for an already-captured order.
        if (detail.toLowerCase().includes("already been captured")) {
          setAlreadyCaptured(true);
          return;
        }

        throw new Error(detail);
      }

      const result = data as PaymentResult;

      const orderCompleted = result.status === "COMPLETED";
      const captureCompleted =
        result.capture_status === "COMPLETED" ||
        result.status === "COMPLETED";

      if (!result.success || !orderCompleted || !captureCompleted) {
        throw new Error(
          result.message || "PayPal has not confirmed the payment."
        );
      }

      setPayment(result);
    } catch (err) {
      console.error("Payment capture error:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Unable to verify your payment."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setError("PayPal order ID was not found in the return URL.");
      setLoading(false);
      return;
    }

    setOrderId(token);

    if (captureStarted.current) {
      return;
    }

    captureStarted.current = true;
    void capturePayment(token);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#080d19] px-5 py-10 text-white">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#111a2b] p-8 shadow-2xl sm:p-10">

        {/* LOADING */}
        {loading && (
          <div className="py-10 text-center">
            <div className="mx-auto mb-6 h-14 w-14 animate-spin rounded-full border-4 border-blue-500/20 border-t-blue-500" />

            <h1 className="text-2xl font-bold">
              Verifying your payment
            </h1>

            <p className="mt-3 text-sm text-slate-400">
              Please wait while PayPilot AI securely confirms
              your PayPal transaction.
            </p>
          </div>
        )}

        {/* FIRST-TIME PAYMENT SUCCESS */}
        {!loading && payment && (
          <div className="text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10 text-5xl text-green-400">
              ✓
            </div>

            <p className="mt-6 text-sm font-medium uppercase tracking-widest text-green-400">
              Payment successful
            </p>

            <h1 className="mt-3 text-3xl font-bold">
              Thank you for shopping!
            </h1>

            <p className="mt-3 text-sm text-slate-400">
              Your payment has been successfully captured
              and verified by PayPal.
            </p>

            <div className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-[#0c1322] p-5 text-left">
              <div className="flex justify-between gap-4">
                <span className="text-sm text-slate-400">
                  Product
                </span>
                <span className="text-right text-sm font-semibold">
                  {payment.product || "Product"}
                </span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-sm text-slate-400">
                  Quantity
                </span>
                <span className="text-sm font-semibold">
                  {payment.quantity ?? "-"}
                </span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-sm text-slate-400">
                  Payment amount
                </span>
                <span className="text-sm font-semibold text-green-400">
                  {payment.currency} {payment.amount}
                </span>
              </div>

              {payment.original_amount_inr && (
                <div className="flex justify-between gap-4">
                  <span className="text-sm text-slate-400">
                    Original price
                  </span>
                  <span className="text-sm font-semibold">
                    ₹{payment.original_amount_inr}
                  </span>
                </div>
              )}

              <div className="border-t border-white/10 pt-4">
                <p className="text-xs text-slate-500">
                  PayPal Order ID
                </p>
                <p className="mt-1 break-all text-xs text-slate-300">
                  {payment.order_id}
                </p>
              </div>

              {payment.capture_id && (
                <div>
                  <p className="text-xs text-slate-500">
                    Capture ID
                  </p>
                  <p className="mt-1 break-all text-xs text-slate-300">
                    {payment.capture_id}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between border-t border-white/10 pt-4">
                <span className="text-sm text-slate-400">
                  Transaction status
                </span>
                <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-400">
                  COMPLETED
                </span>
              </div>
            </div>

            <a
              href="/"
              className="mt-8 inline-block w-full rounded-xl bg-blue-600 px-6 py-4 text-center text-sm font-semibold transition hover:bg-blue-500"
            >
              Continue Shopping
            </a>
          </div>
        )}

        {/* ALREADY CAPTURED */}
        {!loading && alreadyCaptured && (
          <div className="text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-blue-500/10 text-5xl text-blue-400">
              ✓
            </div>

            <p className="mt-6 text-sm font-medium uppercase tracking-widest text-blue-400">
              Order already processed
            </p>

            <h1 className="mt-3 text-3xl font-bold">
              Payment was already captured
            </h1>

            <p className="mt-4 text-sm leading-6 text-slate-400">
              PayPal reports that this order has already been captured.
              A second capture was not attempted. Please check your
              PayPal Sandbox activity or transaction history for
              the payment details.
            </p>

            <div className="mt-8 rounded-2xl border border-white/10 bg-[#0c1322] p-5 text-left">
              <p className="text-xs text-slate-500">
                PayPal Order ID
              </p>
              <p className="mt-2 break-all text-sm text-slate-300">
                {orderId}
              </p>

              <div className="mt-4 border-t border-white/10 pt-4">
                <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-400">
                  ALREADY CAPTURED
                </span>
              </div>
            </div>

            <a
              href="/"
              className="mt-8 inline-block w-full rounded-xl bg-blue-600 px-6 py-4 text-center text-sm font-semibold transition hover:bg-blue-500"
            >
              Continue Shopping
            </a>
          </div>
        )}

        {/* PAYMENT FAILURE */}
        {!loading && error && (
          <div className="text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10 text-4xl text-red-400">
              !
            </div>

            <h1 className="mt-6 text-2xl font-bold">
              Payment verification failed
            </h1>

            <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
              {error}
            </p>

            {orderId && (
              <div className="mt-5 rounded-xl bg-[#0c1322] p-4 text-left">
                <p className="text-xs text-slate-500">
                  PayPal Order ID
                </p>
                <p className="mt-1 break-all text-xs text-slate-300">
                  {orderId}
                </p>
              </div>
            )}

            <button
              onClick={() => {
                if (orderId) {
                  void capturePayment(orderId);
                }
              }}
              disabled={!orderId}
              className="mt-6 w-full rounded-xl bg-blue-600 px-6 py-4 text-sm font-semibold hover:bg-blue-500 disabled:opacity-50"
            >
              Retry Payment Verification
            </button>

            <a
              href="/"
              className="mt-4 block text-sm text-slate-400 hover:text-white"
            >
              Return to PayPilot AI
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
