// Food API v1 - deployed
"use client";

import { useEffect, useState } from "react";

import styles from "./page.module.css";

type Restaurant = {
  id: string;
  name: string;
  cuisineType: string;
  address: string;
};

type ListResponse = {
  data: Restaurant[];
  meta: { total: number; limit: number; offset: number; hasMore: boolean };
};

type ErrorResponse = {
  error: { code: string; message: string };
};

const PAGE_SIZE = 20;

export default function Home() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAllRestaurants() {
      const collected: Restaurant[] = [];
      let offset = 0;
      let hasMore = true;
      let reportedTotal = 0;

      try {
        while (hasMore) {
          const url = `/api/v1/restaurants?limit=${PAGE_SIZE}&offset=${offset}&sort=name&order=asc`;
          const response = await fetch(url, { signal: controller.signal });
          const body = (await response.json()) as ListResponse | ErrorResponse;

          if (!response.ok || "error" in body) {
            throw new Error(
              "error" in body
                ? body.error.message
                : `Request failed with status ${response.status}.`,
            );
          }

          collected.push(...body.data);
          reportedTotal = body.meta.total;
          offset += body.data.length;
          hasMore = body.meta.hasMore && body.data.length > 0;
        }

        setRestaurants(collected);
        setTotal(reportedTotal);
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) {
          return;
        }
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load restaurants.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadAllRestaurants();

    return () => controller.abort();
  }, []);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.title}>Restaurants</h1>
          <p className={styles.subtitle}>
            {isLoading
              ? "Loading restaurants…"
              : error === null
                ? `${restaurants.length} of ${total} shown`
                : "Unavailable"}
          </p>
        </header>

        {error !== null && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}

        {restaurants.length > 0 && (
          <ul className={styles.grid}>
            {restaurants.map((restaurant) => (
              <li key={restaurant.id} className={styles.card}>
                <h2 className={styles.cardName}>{restaurant.name}</h2>
                <p className={styles.cardCuisine}>{restaurant.cuisineType}</p>
                <p className={styles.cardAddress}>{restaurant.address}</p>
              </li>
            ))}
          </ul>
        )}

        {!isLoading && error === null && restaurants.length === 0 && (
          <p className={styles.empty}>No restaurants found.</p>
        )}
      </main>
    </div>
  );
}
