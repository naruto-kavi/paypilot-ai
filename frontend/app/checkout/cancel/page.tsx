
"use client";

import { useEffect, useState } from "react";

export default function CheckoutCancelPage() {
  const [orderId, setOrderId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOrderId(params.get("token") || "");
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#080d19] px-5 py-10 text-white">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#111a2b] p-8 text-center shadow-2xl sm:p-10">

        {/* Cancellation Icon */}
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/10 text-5xl text-amber-400">
          ×
        </div>

        <p className="mt-6 text-sm font-semibold uppercase tracking-widest text-amber-400">
          Checkout Cancelled
        </p>

        <h1 className="mt-3 text-3xl font-bold">
          Your payment wasn't completed
        </h1>

        <p className="mt-4 text-sm leading-6 text-slate-400">
          You cancelled or returned from PayPal before completing
          your purchase. No successful payment has been confirmed
          by PayPilot AI.
        </p>

        {/* Order Information */}
        {orderId && (
          <div className="mt-8 rounded-2xl border border-white/10 bg-[#0c1322] p-5 text-left">
            <p className="text-xs text-slate-500">
              PayPal Order ID
            </p>

            <p className="mt-2 break-all text-sm text-slate-300">
              {orderId}
            </p>

            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
              <span className="text-sm text-slate-400">
                Checkout status
              </span>

              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
                CANCELLED
              </span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-8 space-y-3">

          <a
            href="/"
            className="block w-full rounded-xl bg-blue-600 px-6 py-4 text-sm font-semibold transition hover:bg-blue-500"
          >
            Return to PayPilot AI
          </a>

          <button
            onClick={() => window.history.back()}
            className="w-full rounded-xl border border-white/10 px-6 py-4 text-sm font-semibold text-slate-300 transition hover:bg-white/5"
          >
            Go Back
          </button>

        </div>

        <p className="mt-8 text-xs text-slate-500">
          Need help? Return to PayPilot AI and our shopping
          assistant can help you with your purchase.
        </p>

      </div>
    </main>
  );
}
