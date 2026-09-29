"use client";

import { useEffect, useState } from "react";

import shared from "../page.module.css";
import styles from "./page.module.css";

/** Always the live deployment, never localhost: this page is an external consumer. */
const API_BASE = "https://food-api-sigma-rosy.vercel.app";
const PAGE_SIZE = 10;
const FILTER_DEBOUNCE_MS = 300;

type Restaurant = {
  id: string;
  name: string;
  cuisineType: string;
  rating: number;
  isOpen: boolean;
};

type ListResponse = {
  data: Restaurant[];
  meta: { total: number; limit: number; offset: number; hasMore: boolean };
};

type ErrorResponse = {
  error: { code: string; message: string };
};

type Result =
  | { url: string; ok: true; body: ListResponse }
  | { url: string; ok: false; message: string };

/** cuisineType is an exact match on values like "Italian", so "italian" is normalized to that. */
function normalizeCuisine(value: string): string {
  const trimmed = value.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function buildUrl(offset: number, cuisine: string): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (cuisine !== "") {
    params.set("cuisineType", cuisine);
  }
  return `${API_BASE}/api/v1/restaurants?${params}`;
}

export default function Consumer() {
  const [filterInput, setFilterInput] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  const url = buildUrl(offset, cuisine);
  const isLoading = result?.url !== url;

  useEffect(() => {
    const timer = setTimeout(() => {
      setCuisine(normalizeCuisine(filterInput));
      setOffset(0);
    }, FILTER_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [filterInput]);

  useEffect(() => {
    const controller = new AbortController();

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as ListResponse | ErrorResponse;
        if (!response.ok || "error" in body) {
          throw new Error(
            "error" in body ? body.error.message : `Request failed with status ${response.status}.`,
          );
        }
        setResult({ url, ok: true, body });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setResult({
          url,
          ok: false,
          message: cause instanceof Error ? cause.message : "Could not load restaurants.",
        });
      });

    return () => controller.abort();
  }, [url]);

  const page = !isLoading && result?.ok ? result.body : null;
  const error = !isLoading && result && !result.ok ? result.message : null;

  return (
    <div className={shared.page}>
      <main className={shared.main}>
        <header className={shared.header}>
          <h1 className={shared.title}>Restaurant finder</h1>
          <p className={shared.subtitle}>
            {page
              ? page.meta.total === 0
                ? "0 restaurants"
                : `Showing ${offset + 1}–${offset + page.data.length} of ${page.meta.total} restaurants`
              : "Live data from the Food API"}
          </p>
        </header>

        <div className={styles.controls}>
          <input
            className={styles.input}
            type="search"
            placeholder="Filter by cuisine, e.g. Italian"
            aria-label="Filter by cuisine type"
            value={filterInput}
            onChange={(event) => setFilterInput(event.target.value)}
          />
          <button
            className={styles.button}
            type="button"
            disabled={isLoading || offset === 0}
            onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
          >
            Previous page
          </button>
          <button
            className={styles.button}
            type="button"
            disabled={isLoading || !page?.meta.hasMore}
            onClick={() => setOffset((current) => current + PAGE_SIZE)}
          >
            Next page
          </button>
        </div>

        {isLoading && <p className={shared.empty}>Loading restaurants…</p>}

        {error !== null && (
          <p role="alert" className={shared.error}>
            {error}
          </p>
        )}

        {page && page.data.length === 0 && (
          <p className={shared.empty}>
            No restaurants match {cuisine === "" ? "this filter" : `“${cuisine}”`}.
          </p>
        )}

        {page && page.data.length > 0 && (
          <ul className={styles.list}>
            {page.data.map((restaurant) => (
              <li key={restaurant.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <h2 className={shared.cardName}>{restaurant.name}</h2>
                  <p className={shared.cardCuisine}>{restaurant.cuisineType}</p>
                </div>
                <span className={styles.rating}>★ {restaurant.rating.toFixed(1)}</span>
                <span className={restaurant.isOpen ? styles.open : styles.closed}>
                  {restaurant.isOpen ? "Open" : "Closed"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
