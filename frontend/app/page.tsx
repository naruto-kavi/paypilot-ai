
"use client";

import { useEffect, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type AgentResponse = {
  success: boolean;
  agent: string;
  response: string;
  budget: number;
  currency: string;
};

type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  description: string;
  ram: string;
  storage: string;
};

type CreateOrderResponse = {
  success: boolean;
  order_id: string;
  status: string;
  product: string;
  product_id: number;
  quantity: number;
  amount: string;
  currency: string;
  original_amount_inr: string;
  approval_url: string;
};

type Payment = {
  id: number;
  order_id: string;
  capture_id: string | null;
  product_id: number;
  product: string;
  quantity: number;
  original_amount_inr: string;
  amount: string;
  currency: string;
  status: string;
  created_at: string;
};

type PaymentHistoryResponse = {
  success: boolean;
  count: number;
  payments: Payment[];
};

export default function Home() {
  const [backendStatus, setBackendStatus] = useState("Checking...");
  const [budget, setBudget] = useState(60000);
  const [activeView, setActiveView] = useState<"dashboard" | "transactions" | "insights">("dashboard");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const [products, setProducts] = useState<Product[]>([]);
  const [productLoading, setProductLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");

  const [message, setMessage] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const [checkoutLoadingId, setCheckoutLoadingId] =
    useState<number | null>(null);

  const [checkoutError, setCheckoutError] = useState("");

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm PayPilot AI. Tell me what you want to buy, and I'll help you find products within your budget.",
    },
  ]);

  // Backend health check
  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then((res) => {
        if (!res.ok) throw new Error("Backend unavailable");
        return res.json();
      })
      .then(() => setBackendStatus("Connected"))
      .catch(() => setBackendStatus("Offline"));
  }, []);

  // Load products from FastAPI
  async function loadProducts(query = "") {
    setProductLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();

      if (query.trim()) {
        params.set("q", query.trim());
      }

      const response = await fetch(
        `${API_URL}/api/products?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error("Unable to load products");
      }

      const data: Product[] = await response.json();
      setProducts(data);
    } catch (err) {
      console.error("Product loading error:", err);
      setError("Could not connect to the product service.");
    } finally {
      setProductLoading(false);
    }
  }

  useEffect(() => {
    void loadProducts();
  }, []);

  // Search products
  function searchProducts() {
    void loadProducts(searchQuery);
  }

  // Load saved PayPal transactions from the backend.
  async function loadPaymentHistory() {
    setHistoryLoading(true);
    setHistoryError("");

    try {
      const response = await fetch(
        `${API_URL}/api/payments/history?limit=100&offset=0`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Unable to load payment history."
        );
      }

      const result = data as PaymentHistoryResponse;
      setPayments(Array.isArray(result.payments) ? result.payments : []);
    } catch (err) {
      console.error("Payment history error:", err);
      setHistoryError(
        err instanceof Error
          ? err.message
          : "Could not connect to the payment history service."
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  function openTransactions() {
    setActiveView("transactions");
    void loadPaymentHistory();
  }

  // Filter products within budget
  const affordableProducts = products.filter(
    (product) => product.price <= budget
  );

  // Create PayPal order and redirect buyer
  async function buyProduct(product: Product) {
    if (checkoutLoadingId !== null) return;

    setCheckoutLoadingId(product.id);
    setCheckoutError("");

    try {
      const response = await fetch(
        `${API_URL}/api/payments/create-order`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            product_id: product.id,
            quantity: 1,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Unable to create PayPal order."
        );
      }

      const order = data as CreateOrderResponse;

      if (!order.success || !order.approval_url || !order.order_id) {
        throw new Error(
          "PayPal did not return a valid checkout URL."
        );
      }

      // Redirect to PayPal Sandbox checkout
      window.location.assign(order.approval_url);
    } catch (err) {
      console.error("Checkout error:", err);

      setCheckoutError(
        err instanceof Error
          ? err.message
          : "Unable to start checkout. Please try again."
      );

      setCheckoutLoadingId(null);
    }
  }

  // Send message to AI shopping agent
  async function sendMessage() {
    const userMessage = message.trim();

    if (!userMessage || chatLoading) return;

    setMessages((previous) => [
      ...previous,
      {
        role: "user",
        content: userMessage,
      },
    ]);

    setMessage("");
    setChatLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/agent/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage,
          budget,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : "The AI assistant could not process your request.";

        throw new Error(detail);
      }

      const agentResponse = data as AgentResponse;

      if (!agentResponse.success || !agentResponse.response) {
        throw new Error("The AI assistant returned an empty response.");
      }

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: agentResponse.response,
        },
      ]);
    } catch (err) {
      console.error("PayPilot AI chat error:", err);

      const errorMessage =
        err instanceof Error
          ? err.message
          : "Could not connect to PayPilot AI. Check that the backend and Ollama are running.";

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: `Sorry, something went wrong: ${errorMessage}`,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#080d19] text-white">
      <div className="flex min-h-screen">

        {/* SIDEBAR */}

        <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 bg-[#0c1322] p-6 md:flex">

          <div className="mb-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-xl font-bold">
              P
            </div>

            <div>
              <h1 className="text-lg font-bold">PayPilot AI</h1>
              <p className="text-xs text-slate-400">
                Smart Commerce Agent
              </p>
            </div>
          </div>

          <nav className="space-y-3">
            <button
              onClick={() => setActiveView("dashboard")}
              className={`w-full rounded-xl px-4 py-3 text-left text-sm transition ${
                activeView === "dashboard"
                  ? "bg-blue-600/20 text-blue-400"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              ✦ AI Shopping Assistant
            </button>

            <button
              onClick={openTransactions}
              className={`w-full rounded-xl px-4 py-3 text-left text-sm transition ${
                activeView === "transactions"
                  ? "bg-blue-600/20 text-blue-400"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              ▣ Payment History
            </button>

            <button
              onClick={() => {
                setActiveView("insights");
                void loadPaymentHistory();
              }}
              className={`w-full rounded-xl px-4 py-3 text-left text-sm transition ${
                activeView === "insights"
                  ? "bg-blue-600/20 text-blue-400"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              ◫ Spending Insights
            </button>

            <div className="rounded-xl px-4 py-3 text-sm text-slate-500">
              ⚙ Settings
            </div>
          </nav>

          <div className="mt-auto rounded-xl border border-white/10 p-4">
            <p className="text-xs text-slate-400">
              Backend Status
            </p>

            <p className="mt-2 text-sm font-medium">
              <span
                className={`mr-2 ${
                  backendStatus === "Connected"
                    ? "text-green-400"
                    : backendStatus === "Offline"
                    ? "text-red-400"
                    : "text-yellow-400"
                }`}
              >
                ●
              </span>

              {backendStatus}
            </p>
          </div>
        </aside>

        {/* MAIN CONTENT */}

        <section className="min-w-0 flex-1">

          {/* HEADER */}

          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5 md:px-10">
            <div>
              <h2 className="text-xl font-semibold">
                {activeView === "dashboard"
                  ? "AI Shopping Assistant"
                  : activeView === "transactions"
                    ? "Payment History"
                    : "Spending Insights"}
              </h2>

              <p className="mt-1 text-sm text-slate-400">
                {activeView === "dashboard"
                  ? "Intelligent shopping. Trusted payments."
                  : activeView === "transactions"
                    ? "Your saved PayPal Sandbox transactions."
                    : "Understand your purchases and spending patterns."}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (activeView === "dashboard") {
                    openTransactions();
                  } else {
                    setActiveView("dashboard");
                  }
                }}
                className="rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300 transition hover:bg-white/5"
              >
                {activeView === "dashboard" ? "▣ Payment History" : "✦ Shopping"}
              </button>
              <button
                onClick={() => {
                  setActiveView("insights");
                  void loadPaymentHistory();
                }}
                className="rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300 transition hover:bg-white/5"
              >
                ◫ Insights
              </button>
              <div className="rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs text-blue-400">
                PayPal Sandbox
              </div>
            </div>
          </header>

          {/* DASHBOARD */}

          {activeView === "dashboard" ? (
          <div className="mx-auto max-w-6xl space-y-8 p-6 md:p-10">

            {/* BUDGET AND AGENT CARDS */}

            <div className="grid gap-5 md:grid-cols-2">

              <div className="rounded-2xl border border-white/10 bg-[#111a2b] p-6">
                <p className="text-sm text-slate-400">
                  Your shopping budget
                </p>

                <div className="mt-3 flex items-center justify-between">
                  <h3 className="text-3xl font-bold">
                    ₹{budget.toLocaleString("en-IN")}
                  </h3>

                  <span className="rounded-lg bg-blue-500/10 px-3 py-2 text-xs text-blue-400">
                    Monthly
                  </span>
                </div>

                <input
                  type="range"
                  min="10000"
                  max="100000"
                  step="5000"
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  className="mt-5 w-full accent-blue-500"
                />

                <p className="mt-2 text-xs text-slate-500">
                  Adjust your budget to explore products.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#111a2b] p-6">
                <p className="text-sm text-slate-400">
                  AI Shopping Agent
                </p>

                <h3 className="mt-3 text-2xl font-semibold">
                  Ready to assist
                </h3>

                <p className="mt-2 text-sm text-slate-400">
                  Discover products, compare prices, and prepare
                  secure PayPal checkout.
                </p>

                <div className="mt-4 inline-flex rounded-full bg-green-500/10 px-3 py-1 text-xs text-green-400">
                  ● Sandbox mode
                </div>
              </div>
            </div>

            {/* PRODUCT CATALOG */}

            <section>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">
                    Explore Products
                  </h3>

                  <p className="mt-1 text-sm text-slate-400">
                    Products retrieved from FastAPI backend
                  </p>
                </div>

                <span className="text-xs text-slate-400">
                  {affordableProducts.length} within budget
                </span>
              </div>

              {/* SEARCH */}

              <div className="mb-5 flex gap-3">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") searchProducts();
                  }}
                  placeholder="Search laptops, products..."
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#111a2b] px-4 py-3 text-sm outline-none focus:border-blue-500"
                />

                <button
                  onClick={searchProducts}
                  disabled={productLoading}
                  className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
                >
                  Search
                </button>

                <button
                  onClick={() => {
                    setSearchQuery("");
                    void loadProducts();
                  }}
                  className="rounded-xl border border-white/10 px-4 py-3 text-sm hover:bg-white/5"
                >
                  Reset
                </button>
              </div>

              {/* CHECKOUT ERROR */}

              {checkoutError && (
                <div className="mb-5 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
                  {checkoutError}
                </div>
              )}

              {/* PRODUCTS */}

              {productLoading ? (
                <div className="rounded-xl border border-white/10 p-10 text-center text-slate-400">
                  Loading products...
                </div>
              ) : error ? (
                <div className="rounded-xl border border-red-500/20 p-8 text-center text-red-400">
                  {error}

                  <button
                    onClick={() => void loadProducts(searchQuery)}
                    className="ml-3 underline"
                  >
                    Retry
                  </button>
                </div>
              ) : products.length === 0 ? (
                <div className="rounded-xl border border-white/10 p-10 text-center text-slate-400">
                  No products found. Try another search.
                </div>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">

                  {products.map((product) => (
                    <div
                      key={product.id}
                      className="rounded-2xl border border-white/10 bg-[#111a2b] p-5 transition hover:border-blue-500/50"
                    >
                      <div className="flex h-32 items-center justify-center rounded-xl bg-[#18243a] text-5xl">
                        💻
                      </div>

                      <p className="mt-4 text-xs text-blue-400">
                        {product.category}
                      </p>

                      <h4 className="mt-1 font-semibold">
                        {product.name}
                      </h4>

                      <p className="mt-2 text-xs text-slate-400">
                        {product.ram} RAM · {product.storage}
                      </p>

                      <p className="mt-2 text-sm text-slate-400">
                        {product.description}
                      </p>

                      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-lg font-bold">
                          ₹{product.price.toLocaleString("en-IN")}
                        </span>

                        <span
                          className={`rounded-lg px-3 py-1 text-xs ${
                            product.price <= budget
                              ? "bg-green-500/10 text-green-400"
                              : "bg-red-500/10 text-red-400"
                          }`}
                        >
                          {product.price <= budget
                            ? "Within budget"
                            : "Over budget"}
                        </span>
                      </div>

                      {/* BUY NOW BUTTON */}

                      <button
                        onClick={() => void buyProduct(product)}
                        disabled={checkoutLoadingId !== null}
                        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {checkoutLoadingId === product.id ? (
                          <>
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            Creating PayPal Order...
                          </>
                        ) : (
                          <>
                            Buy Now
                            <span>→</span>
                          </>
                        )}
                      </button>

                    </div>
                  ))}

                </div>
              )}
            </section>

            {/* AI CHAT */}

            <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#111a2b]">

              <div className="border-b border-white/10 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-xl">
                    ✦
                  </div>

                  <div>
                    <h3 className="font-semibold">
                      Talk to PayPilot AI
                    </h3>

                    <p className="mt-1 text-xs text-slate-400">
                      Your intelligent shopping companion · Llama 3.1
                    </p>
                  </div>
                </div>
              </div>

              <div className="max-h-80 min-h-40 space-y-4 overflow-y-auto p-5">

                {messages.map((msg, index) => (
                  <div
                    key={index}
                    className={`flex ${
                      msg.role === "user"
                        ? "justify-end"
                        : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-xl p-4 text-sm ${
                        msg.role === "user"
                          ? "bg-blue-600 text-white"
                          : "bg-[#1b2940] text-slate-200"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}

                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-xl bg-[#1b2940] p-4 text-sm text-slate-300">
                      PayPilot AI is thinking...
                    </div>
                  </div>
                )}

              </div>

              <div className="flex gap-3 border-t border-white/10 p-5">
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                  disabled={chatLoading}
                  placeholder="e.g. Find a laptop for AI development under ₹60,000"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#0c1322] px-4 py-3 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
                />

                <button
                  onClick={() => void sendMessage()}
                  disabled={!message.trim() || chatLoading}
                  className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
                >
                  {chatLoading ? "Thinking..." : "Send"}
                </button>
              </div>
            </section>

            {/* FOOTER */}

            <footer className="border-t border-white/10 py-5 text-center text-xs text-slate-500">
              PayPilot AI · AI-powered Agentic Commerce ·
              Powered by PayPal Sandbox
            </footer>

          </div>
          ) : activeView === "transactions" ? (
            <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Your transactions</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    Completed payments saved in your PayPilot database.
                  </p>
                </div>
                <button
                  onClick={() => void loadPaymentHistory()}
                  disabled={historyLoading}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-sm hover:bg-white/5 disabled:opacity-50"
                >
                  {historyLoading ? "Refreshing..." : "↻ Refresh"}
                </button>
              </div>

              {historyError && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
                  {historyError}
                  <button
                    onClick={() => void loadPaymentHistory()}
                    className="ml-3 underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-[#111a2b] p-5">
                  <p className="text-sm text-slate-400">Saved transactions</p>
                  <p className="mt-2 text-3xl font-bold">{payments.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#111a2b] p-5">
                  <p className="text-sm text-slate-400">Total product spend</p>
                  <p className="mt-2 text-3xl font-bold">
                    ₹{payments
                      .reduce((total, payment) => total + Number(payment.original_amount_inr || 0), 0)
                      .toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Based on saved INR product amounts
                  </p>
                </div>
              </div>

              {historyLoading && payments.length === 0 ? (
                <div className="rounded-2xl border border-white/10 p-10 text-center text-slate-400">
                  Loading payment history...
                </div>
              ) : historyError && payments.length === 0 ? null : payments.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-[#111a2b] p-10 text-center">
                  <div className="text-4xl">▣</div>
                  <h4 className="mt-3 font-semibold">No transactions yet</h4>
                  <p className="mt-2 text-sm text-slate-400">
                    Completed PayPal purchases will appear here.
                  </p>
                  <button
                    onClick={() => setActiveView("dashboard")}
                    className="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold hover:bg-blue-500"
                  >
                    Explore products
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {payments.map((payment) => (
                    <article
                      key={payment.id}
                      className="rounded-2xl border border-white/10 bg-[#111a2b] p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#18243a] text-2xl">
                            💻
                          </div>
                          <div>
                            <h4 className="font-semibold">{payment.product}</h4>
                            <p className="mt-1 text-xs text-slate-400">
                              Quantity: {payment.quantity} · Transaction #{payment.id}
                            </p>
                          </div>
                        </div>
                        <span className="rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
                          {payment.status}
                        </span>
                      </div>

                      <div className="mt-5 grid gap-4 border-t border-white/10 pt-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <p className="text-xs text-slate-500">Original amount</p>
                          <p className="mt-1 font-semibold">
                            ₹{Number(payment.original_amount_inr).toLocaleString("en-IN")}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">PayPal amount</p>
                          <p className="mt-1 font-semibold">
                            {payment.currency} {Number(payment.amount).toFixed(2)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Date</p>
                          <p className="mt-1 text-sm">
                            {new Date(payment.created_at).toLocaleString("en-IN")}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Product ID</p>
                          <p className="mt-1 text-sm">{payment.product_id}</p>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2 rounded-xl bg-[#0c1322] p-3 text-xs text-slate-400">
                        <p className="break-all">
                          <span className="text-slate-500">PayPal Order: </span>
                          {payment.order_id}
                        </p>
                        <p className="break-all">
                          <span className="text-slate-500">Capture ID: </span>
                          {payment.capture_id || "Not available"}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              <footer className="border-t border-white/10 py-5 text-center text-xs text-slate-500">
                PayPilot AI · Transaction records retrieved from SQLite
              </footer>
            </div>
          ) : (
            <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Spending overview</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    Insights calculated from your saved payment records.
                  </p>
                </div>
                <button
                  onClick={() => void loadPaymentHistory()}
                  disabled={historyLoading}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-sm hover:bg-white/5 disabled:opacity-50"
                >
                  {historyLoading ? "Refreshing..." : "↻ Refresh"}
                </button>
              </div>

              {historyError && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
                  {historyError}
                </div>
              )}

              {(() => {
                const totalInr = payments.reduce(
                  (sum, payment) => sum + Number(payment.original_amount_inr || 0),
                  0
                );
                const totalUsd = payments.reduce(
                  (sum, payment) => sum + Number(payment.amount || 0),
                  0
                );
                const totalItems = payments.reduce(
                  (sum, payment) => sum + payment.quantity,
                  0
                );
                const averageInr = payments.length ? totalInr / payments.length : 0;
                const productTotals = payments.reduce<Record<string, number>>(
                  (totals, payment) => {
                    totals[payment.product] =
                      (totals[payment.product] || 0) +
                      Number(payment.original_amount_inr || 0);
                    return totals;
                  },
                  {}
                );
                const productEntries = Object.entries(productTotals).sort(
                  (a, b) => b[1] - a[1]
                );
                const highestProduct = productEntries[0];
                const maxProductSpend = highestProduct?.[1] || 0;

                return (
                  <>
                    {historyLoading && payments.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 p-10 text-center text-slate-400">
                        Loading spending insights...
                      </div>
                    ) : payments.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-[#111a2b] p-10 text-center">
                        <div className="text-4xl">◫</div>
                        <h4 className="mt-3 font-semibold">Not enough data yet</h4>
                        <p className="mt-2 text-sm text-slate-400">
                          Complete a purchase to start seeing your spending insights.
                        </p>
                        <button
                          onClick={() => setActiveView("dashboard")}
                          className="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold hover:bg-blue-500"
                        >
                          Explore products
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl border border-white/10 bg-[#111a2b] p-5">
                            <p className="text-sm text-slate-400">Total spent</p>
                            <p className="mt-2 text-2xl font-bold">
                              ₹{totalInr.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">Original product values</p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-[#111a2b] p-5">
                            <p className="text-sm text-slate-400">Completed purchases</p>
                            <p className="mt-2 text-2xl font-bold">{payments.length}</p>
                            <p className="mt-1 text-xs text-slate-500">Saved transaction records</p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-[#111a2b] p-5">
                            <p className="text-sm text-slate-400">Items purchased</p>
                            <p className="mt-2 text-2xl font-bold">{totalItems}</p>
                            <p className="mt-1 text-xs text-slate-500">Total quantity</p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-[#111a2b] p-5">
                            <p className="text-sm text-slate-400">Average order value</p>
                            <p className="mt-2 text-2xl font-bold">
                              ₹{averageInr.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">Per saved transaction</p>
                          </div>
                        </div>

                        <div className="grid gap-5 lg:grid-cols-2">
                          <section className="rounded-2xl border border-white/10 bg-[#111a2b] p-6">
                            <h4 className="font-semibold">Spending by product</h4>
                            <p className="mt-1 text-xs text-slate-400">
                              Total INR amount grouped by product
                            </p>
                            <div className="mt-6 space-y-5">
                              {productEntries.map(([name, amount]) => (
                                <div key={name}>
                                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                                    <span className="truncate text-slate-300">{name}</span>
                                    <span className="font-medium">
                                      ₹{amount.toLocaleString("en-IN")}
                                    </span>
                                  </div>
                                  <div className="h-2 overflow-hidden rounded-full bg-[#26334a]">
                                    <div
                                      className="h-full rounded-full bg-blue-500"
                                      style={{
                                        width: `${maxProductSpend ? (amount / maxProductSpend) * 100 : 0}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </section>

                          <section className="rounded-2xl border border-white/10 bg-[#111a2b] p-6">
                            <h4 className="font-semibold">Payment summary</h4>
                            <p className="mt-1 text-xs text-slate-400">
                              Based on stored PayPal Sandbox records
                            </p>
                            <div className="mt-6 space-y-4">
                              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                                <span className="text-sm text-slate-400">PayPal total</span>
                                <span className="font-semibold">
                                  USD {totalUsd.toFixed(2)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                                <span className="text-sm text-slate-400">Most purchased product</span>
                                <span className="max-w-[55%] text-right text-sm font-semibold">
                                  {highestProduct?.[0] || "—"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                                <span className="text-sm text-slate-400">Product categories</span>
                                <span className="font-semibold">{productEntries.length}</span>
                              </div>
                              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                                <p className="text-sm font-medium text-blue-300">Spending insight</p>
                                <p className="mt-2 text-sm text-slate-300">
                                  {payments.length === 1
                                    ? "You have one saved purchase. More transactions will help reveal spending patterns."
                                    : `You have ${payments.length} saved purchases across ${productEntries.length} product type(s). Your average order value is ₹${averageInr.toLocaleString("en-IN", { maximumFractionDigits: 2 })}.`}
                                </p>
                              </div>
                            </div>
                          </section>
                        </div>

                        <p className="text-xs text-slate-500">
                          Note: These are lifetime totals from the currently saved payment history, not a monthly budget analysis.
                          USD totals are shown separately and are not converted again.
                        </p>
                      </>
                    )}
                  </>
                );
              })()}

              <footer className="border-t border-white/10 py-5 text-center text-xs text-slate-500">
                PayPilot AI · Spending insights from saved SQLite transactions
              </footer>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
