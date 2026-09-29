# Food API

A REST API for a food delivery service: browse restaurants and their menus, and place, track, update and cancel orders.

**Live API:** https://food-api-sigma-rosy.vercel.app
**Consumer demo:** https://food-api-sigma-rosy.vercel.app/consumer

All endpoints live under `/api/v1`, accept and return JSON, and need no authentication.

## Contents

1. [Overview](#1-overview)
2. [Resource design](#2-resource-design)
3. [Design decisions](#3-design-decisions)
4. [Endpoints](#4-endpoints)
5. [Response envelope](#5-response-envelope)
6. [Error codes](#6-error-codes)
7. [Rate limiting](#7-rate-limiting)
8. [Seed script](#8-seed-script)
9. [Consumer](#9-consumer)
10. [Running locally](#10-running-locally)

---

## 1. Overview

The API models three resources:

- **Restaurant**: a place that sells food, with a cuisine type, address, rating and open/closed flag.
- **MenuItem**: something a restaurant sells, with a price, category and availability flag. Every menu item belongs to exactly one restaurant.
- **Order**: a customer's purchase from one restaurant. An order is made of **OrderItems** (line items), each pointing at one menu item with a quantity and the unit price charged.

```
Restaurant 1 ──── * MenuItem
     │                 │
     1                 1
     │                 │
     * Order 1 ──── * OrderItem
```

A restaurant has many menu items and many orders. An order has many order items. Each order item references one menu item, and every item in an order must come from the order's restaurant.

**Money** is always an integer in minor units (hundredths of the currency unit). `priceMinor: 1506674` means 15,066.74. Divide by 100 to display.

**Timestamps** are ISO 8601 strings in UTC, e.g. `2026-09-28T21:17:22.034Z`.

---

## 2. Resource design

### Restaurant

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique identifier |
| `name` | string | |
| `cuisineType` | string | e.g. `Italian`, `Nigerian`, `Japanese` |
| `address` | string | |
| `rating` | number | 0.0 – 5.0, one decimal place |
| `isOpen` | boolean | Defaults to `true` |
| `createdAt` | string (date-time) | Set by the server |
| `updatedAt` | string (date-time) | Set by the server on every change |
| **Relationships** | | Has many `MenuItem`; has many `Order` |

Cuisine types in the current data: `American`, `Chinese`, `Continental`, `Indian`, `Italian`, `Japanese`, `Lebanese`, `Mexican`, `Nigerian`.

### MenuItem

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique identifier |
| `restaurantId` | string | The owning restaurant |
| `name` | string | |
| `description` | string \| null | Optional |
| `priceMinor` | integer | Price in minor units |
| `category` | string | One of `Starters`, `Mains`, `Sides`, `Drinks`, `Desserts` in the current data |
| `isAvailable` | boolean | Unavailable items cannot be ordered. Defaults to `true` |
| `createdAt` | string (date-time) | |
| `updatedAt` | string (date-time) | |
| **Relationships** | | Belongs to one `Restaurant`; referenced by many `OrderItem`. Deleted if its restaurant is deleted |

### Order

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique identifier |
| `restaurantId` | string | The restaurant the order was placed with |
| `customerName` | string | |
| `customerEmail` | string | |
| `status` | enum | `PENDING`, `CONFIRMED`, `PREPARING`, `DELIVERED`, `CANCELLED`. New orders start as `PENDING` |
| `totalAmountMinor` | integer | Sum of `quantity × priceMinor` over all items, computed by the server |
| `createdAt` | string (date-time) | |
| `updatedAt` | string (date-time) | |
| `items` | OrderItem[] | Included on single-order responses, not on the list |
| **Relationships** | | Belongs to one `Restaurant`; has many `OrderItem` |

### OrderItem

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique identifier |
| `orderId` | string | The owning order |
| `menuItemId` | string | The menu item ordered |
| `quantity` | integer | 1 or more |
| `priceMinor` | integer | Unit price **at the time the order was placed** |
| `createdAt` | string (date-time) | |
| **Relationships** | | Belongs to one `Order` (deleted with it); references one `MenuItem` |

---

## 3. Design decisions

### Why these resources, and how they relate

These are the smallest set of resources that model food ordering without losing information:

- **Restaurant** and **MenuItem** are separate because a menu changes independently of the restaurant (prices move, dishes sell out), and because clients often need one without the other: a restaurant list doesn't need hundreds of dishes, and a cross-restaurant search like "all desserts under 1,000.00" (`GET /menu-items`) doesn't need restaurants.
- **Order** and **OrderItem** are separate because an order holds many dishes, each with its own quantity. A single order row can't hold that.
- **OrderItem copies the unit price** instead of reading it from the menu item. Menu prices change, and an order must keep showing what the customer was actually charged. That is also why `totalAmountMinor` is stored: it's a fact about the purchase, not something to recompute from today's prices.
- An order belongs to **one** restaurant, and the server rejects items from any other restaurant. That matches how delivery works: one kitchen prepares and ships one order.

### Why generated identifiers (cuid) instead of sequential integers

Records created through the API get a [cuid](https://github.com/paralleldrive/cuid), e.g. `cmumlpjd3000004jq2rr3fzzh`, rather than `1, 2, 3…`:

- **They don't leak information.** With sequential IDs, anyone who places an order can see how many orders exist and how fast they're coming in, and can guess other customers' order IDs by adding one. Cuids aren't guessable in sequence.
- **They can be generated anywhere.** No central counter is needed, which suits serverless functions running on many instances, and IDs stay unique if data is ever merged or moved between databases.
- **They're safe in URLs** and roughly ordered by creation time, which keeps database indexes efficient.

Note that the **seed data uses readable fixed IDs** (`restaurant-1`, `menuitem-1-8`, `order-1-0`). The seed script sets them on purpose so that re-running it updates the same rows instead of creating duplicates (see [Seed script](#8-seed-script)). Treat every ID as an opaque string: don't parse it or depend on its format.

### Why offset pagination, and when cursor pagination would be better

List endpoints use `limit` and `offset`:

- **Simple for clients.** "Page 3 of 10 items" is `offset=20&limit=10`. Clients can jump straight to any page, and the `total` in the response lets them show "Showing 21–30 of 50" and a page count.
- **It fits the data.** The dataset is small (tens of restaurants, hundreds of menu items) and changes slowly, so offset pagination's weaknesses don't show up.

**Cursor pagination** (`?after=<last id seen>`) would be the better choice when:

- **Lists are very large.** The database still reads and skips every row before a large offset, so deep pages get slower. A cursor jumps straight to its position using an index.
- **Data changes while the client is paging.** If a new order is inserted while someone reads page 1, every row shifts by one, and page 2 repeats an item. If a row is deleted, one is skipped. A cursor always continues from the last row seen, so nothing repeats or goes missing.
- **The UI is an infinite scroll or feed**, where jumping to page N and showing a total don't matter.

If the order history grows large, `GET /orders` is the first endpoint that should move to cursors.

### The response envelope, and why consistency matters

Every response body is a JSON object with **either** a `data` key **or** an `error` key, never both:

```json
{ "data": ..., "meta": { ... } }
{ "error": { "code": "...", "message": "..." } }
```

Consistency matters because clients can then handle every endpoint with one code path:

- **Success vs failure is checked the same way everywhere.** Check the status code or `"error" in body`. You never need to guess whether a failure came back as a string, an array or an HTML page.
- **Errors can be handled in code, not by reading text.** `code` is a fixed value like `NOT_FOUND` to branch on. `message` is written for humans and may change.
- **Lists and single records differ only in the shape of `data`.** A list is an array plus `meta` for pagination, and a single record is an object. The wrapper stays the same, so adding a field to `meta` later won't break existing clients.
- **Internals never leak.** Unexpected failures return a generic `500` message. Database errors and stack traces stay in the server logs.

See [Response envelope](#5-response-envelope) for full examples.

---

## 4. Endpoints

**Base URL:** `https://food-api-sigma-rosy.vercel.app/api/v1`

### List parameters

All four list endpoints (`GET /restaurants`, `GET /restaurants/:id/menu`, `GET /menu-items`, `GET /orders`) accept these query parameters, as well as their own filters:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer, 1–100 | `20` | Maximum number of items to return |
| `offset` | integer, ≥ 0 | `0` | Number of items to skip |
| `sort` | string | `createdAt` | Field to sort by. Allowed values are listed for each endpoint |
| `order` | `asc` \| `desc` | `desc` | Sort direction |

Unknown query parameters are ignored. If a parameter is given more than once, the first value is used. An invalid value (e.g. `limit=500`, `sort=price`) returns `400`.

All string filters are **exact, case-sensitive matches**: `cuisineType=Italian` works, but `italian` and `Ital` match nothing.

To get the next page, add `limit` to `offset`, and stop when `meta.hasMore` is `false`.

---

### GET /api/v1/restaurants

Lists restaurants. Menu items and orders are not included; fetch a single restaurant or its menu for those.

**Query parameters:** the [list parameters](#list-parameters), plus:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `sort` | `name` \| `rating` \| `createdAt` | `createdAt` | |
| `cuisineType` | string | — | Only restaurants with exactly this cuisine type |
| `minRating` | number, 0–5 | — | Only restaurants rated at least this |

**Example:** the two highest-rated restaurants

```bash
curl "https://food-api-sigma-rosy.vercel.app/api/v1/restaurants?limit=2&sort=rating&order=desc"
```

**Response** `200 OK`

```json
{
  "data": [
    {
      "id": "restaurant-48",
      "name": "Auntie Stehr-Roob's Palace",
      "cuisineType": "Indian",
      "address": "70667 Otto Lane, Lagos, Nigeria",
      "rating": 5,
      "isOpen": true,
      "createdAt": "2026-09-28T21:27:16.701Z",
      "updatedAt": "2026-09-28T21:27:16.701Z"
    },
    {
      "id": "restaurant-26",
      "name": "Sizzle Hermann's Table",
      "cuisineType": "Japanese",
      "address": "9797 Mayfield Road, Lagos, Nigeria",
      "rating": 5,
      "isOpen": true,
      "createdAt": "2026-09-28T21:24:59.264Z",
      "updatedAt": "2026-09-28T21:24:59.264Z"
    }
  ],
  "meta": { "total": 50, "limit": 2, "offset": 0, "hasMore": true }
}
```

More examples:

```bash
# Italian restaurants rated 4 or above
curl "https://food-api-sigma-rosy.vercel.app/api/v1/restaurants?cuisineType=Italian&minRating=4"

# Second page of 10, alphabetical
curl "https://food-api-sigma-rosy.vercel.app/api/v1/restaurants?limit=10&offset=10&sort=name&order=asc"
```

---

### GET /api/v1/restaurants/:id

Gets one restaurant with its **full menu**, sorted by category then name.

**Path parameters:** `id`, the restaurant ID.
**Query parameters:** none.

**Example**

```bash
curl "https://food-api-sigma-rosy.vercel.app/api/v1/restaurants/restaurant-1"
```

**Response** `200 OK` (`menuItems` shortened to two entries here)

```json
{
  "data": {
    "id": "restaurant-1",
    "name": "Royal Stamm's House",
    "cuisineType": "Lebanese",
    "address": "9285 Robel Locks, Lagos, Nigeria",
    "rating": 3.8,
    "isOpen": false,
    "createdAt": "2026-09-28T21:17:22.034Z",
    "updatedAt": "2026-09-28T21:21:05.646Z",
    "menuItems": [
      {
        "id": "menuitem-1-8",
        "restaurantId": "restaurant-1",
        "name": "Baklava",
        "description": "Calculus cognomen vulpes tondeo compello.",
        "priceMinor": 1506674,
        "category": "Desserts",
        "isAvailable": true,
        "createdAt": "2026-09-28T21:17:23.767Z",
        "updatedAt": "2026-09-28T21:21:07.625Z"
      },
      {
        "id": "menuitem-1-0",
        "restaurantId": "restaurant-1",
        "name": "Knafeh",
        "description": "Eos degenero aequitas voluptate expedita celebrer crinis testimonium aurum corroboro.",
        "priceMinor": 1915510,
        "category": "Desserts",
        "isAvailable": true,
        "createdAt": "2026-09-28T21:17:22.363Z",
        "updatedAt": "2026-09-28T21:21:05.856Z"
      }
    ]
  }
}
```

**Errors:** `404` if no restaurant has that ID.

---

### GET /api/v1/restaurants/:id/menu

Lists one restaurant's menu items, with filtering and pagination. Use this instead of the endpoint above when you need only some of the menu.

**Path parameters:** `id`, the restaurant ID.
**Query parameters:** the [list parameters](#list-parameters), plus:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `sort` | `name` \| `priceMinor` \| `createdAt` | `createdAt` | |
| `category` | string | — | Only items in exactly this category, e.g. `Mains` |
| `maxPrice` | integer, ≥ 0 | — | Only items with `priceMinor` ≤ this |
| `isAvailable` | boolean (`true`/`false`/`1`/`0`) | — | Only available (or unavailable) items |

**Example:** a restaurant's mains

```bash
curl "https://food-api-sigma-rosy.vercel.app/api/v1/restaurants/restaurant-1/menu?category=Mains&limit=2"
```

**Response** `200 OK`

```json
{
  "data": [
    {
      "id": "menuitem-1-6",
      "restaurantId": "restaurant-1",
      "name": "Fatteh with Lamb",
      "description": "Caelum averto tantum amaritudo arca.",
      "priceMinor": 1547585,
      "category": "Mains",
      "isAvailable": false,
      "createdAt": "2026-09-28T21:17:23.325Z",
      "updatedAt": "2026-09-28T21:21:07.243Z"
    },
    {
      "id": "menuitem-1-5",
      "restaurantId": "restaurant-1",
      "name": "Chicken Fatteh",
      "description": "Distinctio alter amplexus concedo subseco acervus tempore.",
      "priceMinor": 1272264,
      "category": "Mains",
      "isAvailable": true,
      "createdAt": "2026-09-28T21:17:23.178Z",
      "updatedAt": "2026-09-28T21:21:07.049Z"
    }
  ],
  "meta": { "total": 2, "limit": 2, "offset": 0, "hasMore": false }
}
```

**Errors:** `404` if no restaurant has that ID. An existing restaurant with no matching items returns `200` with an empty `data` array.

---

### GET /api/v1/menu-items

Searches menu items across **all** restaurants.

**Query parameters:** the [list parameters](#list-parameters), plus:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `sort` | `name` \| `priceMinor` \| `createdAt` | `createdAt` | |
| `category` | string | — | Only items in exactly this category |
| `maxPrice` | integer, ≥ 0 | — | Only items with `priceMinor` ≤ this |
| `minPrice` | integer, ≥ 0 | — | Only items with `priceMinor` ≥ this |
| `isAvailable` | boolean (`true`/`false`/`1`/`0`) | — | Only available (or unavailable) items |

`minPrice` and `maxPrice` can be combined to search a price range, e.g. `minPrice=50000&maxPrice=100000`.

**Example:** the cheapest available items under 1,000.00

```bash
curl "https://food-api-sigma-rosy.vercel.app/api/v1/menu-items?maxPrice=100000&isAvailable=true&sort=priceMinor&order=asc&limit=2"
```

**Response** `200 OK`

```json
{
  "data": [
    {
      "id": "menuitem-29-17",
      "restaurantId": "restaurant-29",
      "name": "Chicken Tacos",
      "description": "Terminatio denuo itaque abundans conforto abstergo spero.",
      "priceMinor": 54291,
      "category": "Mains",
      "isAvailable": true,
      "createdAt": "2026-09-28T21:25:27.520Z",
      "updatedAt": "2026-09-28T21:25:27.520Z"
    },
    {
      "id": "menuitem-27-1",
      "restaurantId": "restaurant-27",
      "name": "Pakora",
      "description": "Somniculosus spero benevolentia.",
      "priceMinor": 58474,
      "category": "Starters",
      "isAvailable": true,
      "createdAt": "2026-09-28T21:25:10.264Z",
      "updatedAt": "2026-09-28T21:25:10.264Z"
    }
  ],
  "meta": { "total": 8, "limit": 2, "offset": 0, "hasMore": true }
}
```

---

### GET /api/v1/orders

Lists orders. Line items are not included; fetch a single order for those.

**Query parameters:** the [list parameters](#list-parameters), plus:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `sort` | `createdAt` \| `totalAmountMinor` | `createdAt` | |
| `status` | `PENDING` \| `CONFIRMED` \| `PREPARING` \| `DELIVERED` \| `CANCELLED` | — | Only orders with this status |
| `customerEmail` | string | — | Only orders placed with exactly this email address |

**Example:** the most recent delivered orders

```bash
curl "https://food-api-sigma-rosy.vercel.app/api/v1/orders?status=DELIVERED&limit=2"
```

**Response** `200 OK`

```json
{
  "data": [
    {
      "id": "order-50-6",
      "restaurantId": "restaurant-50",
      "customerName": "Jon Abernathy",
      "customerEmail": "Kristopher_Lockman52@hotmail.com",
      "status": "DELIVERED",
      "totalAmountMinor": 9713497,
      "createdAt": "2026-09-28T21:27:38.061Z",
      "updatedAt": "2026-09-28T21:27:38.061Z"
    },
    {
      "id": "order-49-3",
      "restaurantId": "restaurant-49",
      "customerName": "Erik Herzog",
      "customerEmail": "Edison_Quigley@yahoo.com",
      "status": "DELIVERED",
      "totalAmountMinor": 1612140,
      "createdAt": "2026-09-28T21:27:36.653Z",
      "updatedAt": "2026-09-28T21:27:36.653Z"
    }
  ],
  "meta": { "total": 92, "limit": 2, "offset": 0, "hasMore": true }
}
```

---

### GET /api/v1/orders/:id

Gets one order with its line items.

**Path parameters:** `id`, the order ID.
**Query parameters:** none.

**Example**

```bash
curl "https://food-api-sigma-rosy.vercel.app/api/v1/orders/order-1-0"
```

**Response** `200 OK` (`items` shortened to two entries here)

```json
{
  "data": {
    "id": "order-1-0",
    "restaurantId": "restaurant-1",
    "customerName": "Destini Schowalter",
    "customerEmail": "Peggy.Boehm@hotmail.com",
    "status": "PENDING",
    "totalAmountMinor": 16292331,
    "createdAt": "2026-09-28T21:17:24.433Z",
    "updatedAt": "2026-09-28T21:21:08.423Z",
    "items": [
      {
        "id": "orderitem-1-0-0",
        "orderId": "order-1-0",
        "menuItemId": "menuitem-1-8",
        "quantity": 2,
        "priceMinor": 1506674,
        "createdAt": "2026-09-28T21:17:24.589Z"
      },
      {
        "id": "orderitem-1-0-1",
        "orderId": "order-1-0",
        "menuItemId": "menuitem-1-2",
        "quantity": 3,
        "priceMinor": 1006680,
        "createdAt": "2026-09-28T21:17:24.761Z"
      }
    ]
  }
}
```

**Errors:** `404` if no order has that ID.

---

### POST /api/v1/orders

Places a new order. The server looks up each menu item's current price, stores it on the line item and calculates `totalAmountMinor`. Clients never send prices. All of this happens in one database transaction: either the whole order is created or nothing is.

**Query parameters:** none.

**Request body** (`Content-Type: application/json`)

| Field | Type | Required | Rules |
|---|---|---|---|
| `restaurantId` | string | yes | Must be an existing restaurant |
| `customerName` | string | yes | Not empty (surrounding spaces are trimmed) |
| `customerEmail` | string | yes | A valid email address |
| `items` | array | yes | At least one entry |
| `items[].menuItemId` | string | yes | Must belong to `restaurantId` and have `isAvailable: true` |
| `items[].quantity` | integer | yes | 1 or more |

**Example**

```bash
curl -X POST "https://food-api-sigma-rosy.vercel.app/api/v1/orders" \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "restaurant-1",
    "customerName": "Ada Obi",
    "customerEmail": "ada@example.com",
    "items": [
      { "menuItemId": "menuitem-1-8", "quantity": 2 },
      { "menuItemId": "menuitem-1-5", "quantity": 1 }
    ]
  }'
```

**Response** `201 Created`

```json
{
  "data": {
    "id": "cmumlpjd3000004jq2rr3fzzh",
    "restaurantId": "restaurant-1",
    "customerName": "Ada Obi",
    "customerEmail": "ada@example.com",
    "status": "PENDING",
    "totalAmountMinor": 4285612,
    "createdAt": "2026-09-29T11:36:39.495Z",
    "updatedAt": "2026-09-29T11:36:39.495Z",
    "items": [
      {
        "id": "cmumlpjfx000104jq4upo4p6c",
        "orderId": "cmumlpjd3000004jq2rr3fzzh",
        "menuItemId": "menuitem-1-8",
        "quantity": 2,
        "priceMinor": 1506674,
        "createdAt": "2026-09-29T11:36:39.495Z"
      },
      {
        "id": "cmumlpjfx000204jq9i6ts4w0",
        "orderId": "cmumlpjd3000004jq2rr3fzzh",
        "menuItemId": "menuitem-1-5",
        "quantity": 1,
        "priceMinor": 1272264,
        "createdAt": "2026-09-29T11:36:39.495Z"
      }
    ]
  }
}
```

`totalAmountMinor` is `2 × 1506674 + 1 × 1272264 = 4285612`.

**Errors**

| Status | When |
|---|---|
| `400` | The body isn't valid JSON, or a field is missing or invalid. The message lists every problem found |
| `422` | The body is valid but can't be fulfilled: the restaurant doesn't exist, a menu item doesn't exist or belongs to another restaurant, or a menu item is unavailable |

```json
{
  "error": {
    "code": "UNPROCESSABLE_ENTITY",
    "message": "Menu item(s) currently unavailable: menuitem-1-6."
  }
}
```

---

### PATCH /api/v1/orders/:id

Updates an order's status. `status` is currently the only field that can be changed, and any status can be set from any other; the API doesn't enforce an order of statuses.

**Path parameters:** `id`, the order ID.
**Query parameters:** none.

**Request body** (`Content-Type: application/json`)

| Field | Type | Required | Rules |
|---|---|---|---|
| `status` | string | yes | One of `PENDING`, `CONFIRMED`, `PREPARING`, `DELIVERED`, `CANCELLED` |

**Example**

```bash
curl -X PATCH "https://food-api-sigma-rosy.vercel.app/api/v1/orders/cmumlpjd3000004jq2rr3fzzh" \
  -H "Content-Type: application/json" \
  -d '{ "status": "CONFIRMED" }'
```

Replace the ID with one of your own orders, e.g. the `id` returned by `POST /orders`.

**Response** `200 OK`: the updated order, including its `items`, in the same shape as [GET /orders/:id](#get-apiv1ordersid). `updatedAt` changes; everything else except `status` stays the same.

```json
{
  "data": {
    "id": "cmumlpjd3000004jq2rr3fzzh",
    "restaurantId": "restaurant-1",
    "customerName": "Ada Obi",
    "customerEmail": "ada@example.com",
    "status": "CONFIRMED",
    "totalAmountMinor": 4285612,
    "createdAt": "2026-09-29T11:36:39.495Z",
    "updatedAt": "2026-09-29T11:36:41.304Z",
    "items": [
      {
        "id": "cmumlpjfx000104jq4upo4p6c",
        "orderId": "cmumlpjd3000004jq2rr3fzzh",
        "menuItemId": "menuitem-1-8",
        "quantity": 2,
        "priceMinor": 1506674,
        "createdAt": "2026-09-29T11:36:39.495Z"
      },
      {
        "id": "cmumlpjfx000204jq9i6ts4w0",
        "orderId": "cmumlpjd3000004jq2rr3fzzh",
        "menuItemId": "menuitem-1-5",
        "quantity": 1,
        "priceMinor": 1272264,
        "createdAt": "2026-09-29T11:36:39.495Z"
      }
    ]
  }
}
```

**Errors:** `400` if the body is invalid or has no `status`; `404` if no order has that ID.

---

### DELETE /api/v1/orders/:id

Deletes an order and all its line items. This is permanent. To keep a record of a cancelled order, use `PATCH` with `"status": "CANCELLED"` instead.

**Path parameters:** `id`, the order ID.
**Query parameters:** none.

**Example**

```bash
curl -X DELETE "https://food-api-sigma-rosy.vercel.app/api/v1/orders/cmumlpjd3000004jq2rr3fzzh"
```

Replace the ID with one of your own orders, e.g. the `id` returned by `POST /orders`.

**Response** `200 OK`

```json
{
  "data": { "message": "Order deleted" }
}
```

**Errors:** `404` if no order has that ID, including one that was already deleted.

---

## 5. Response envelope

### Success

Single records:

```json
{
  "data": { "id": "restaurant-1", "name": "Royal Stamm's House", "...": "..." }
}
```

Lists:

```json
{
  "data": [ { "...": "..." }, { "...": "..." } ],
  "meta": {
    "total": 50,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

| `meta` field | Meaning |
|---|---|
| `total` | Number of items matching the filters, across all pages |
| `limit` | The page size used |
| `offset` | The offset used |
| `hasMore` | `true` if more items exist after this page |

### Error

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Order cmumlpjd3000004jq2rr3fzzh was not found."
  }
}
```

| `error` field | Meaning |
|---|---|
| `code` | A fixed identifier to branch on in code (see [Error codes](#6-error-codes)) |
| `message` | A readable explanation for developers. Don't parse it; the wording may change |

Every response also includes an `X-RateLimit-Backend` header (see [Rate limiting](#7-rate-limiting)).

> Paths that don't exist at all (e.g. `/api/v1/customers`) are handled by the framework and return a plain `404` page, not this JSON envelope.

---

## 6. Error codes

| HTTP status | `code` | Meaning | What to do |
|---|---|---|---|
| `400 Bad Request` | `BAD_REQUEST` | The query parameters or body failed validation: wrong type, out of range, unknown `sort` field, invalid enum value, missing required field, or invalid JSON. The message names each field and what's wrong with it | Fix the request. Retrying unchanged will fail again |
| `404 Not Found` | `NOT_FOUND` | The restaurant or order in the path doesn't exist | Check the ID |
| `422 Unprocessable Entity` | `UNPROCESSABLE_ENTITY` | An order request is well-formed but breaks a business rule: unknown restaurant, a menu item not on that restaurant's menu, or an unavailable item | Change the order contents |
| `429 Too Many Requests` | `RATE_LIMIT_EXCEEDED` | More than 100 requests from your IP in the last minute | Wait the number of seconds in the `Retry-After` header, then retry |
| `500 Internal Server Error` | `INTERNAL_SERVER_ERROR` | An unexpected server-side failure, such as the database being unreachable. The message is always generic | Retry later with backoff; the error is logged on the server |

Examples:

```bash
# 400: limit above the maximum
curl "https://food-api-sigma-rosy.vercel.app/api/v1/restaurants?limit=500"
# {"error":{"code":"BAD_REQUEST","message":"Invalid query parameters. limit: limit must be less than or equal to 100"}}

# 404: unknown restaurant
curl "https://food-api-sigma-rosy.vercel.app/api/v1/restaurants/nope"
# {"error":{"code":"NOT_FOUND","message":"Restaurant nope was not found."}}

# 422: ordering from a restaurant that doesn't exist
curl -X POST "https://food-api-sigma-rosy.vercel.app/api/v1/orders" \
  -H "Content-Type: application/json" \
  -d '{"restaurantId":"nope","customerName":"Ada Obi","customerEmail":"ada@example.com","items":[{"menuItemId":"menuitem-1-8","quantity":1}]}'
# {"error":{"code":"UNPROCESSABLE_ENTITY","message":"Restaurant nope does not exist, so the order cannot be placed."}}
```

---

## 7. Rate limiting

Every endpoint is limited to **100 requests per minute per client IP address**, counted with a sliding window across all endpoints together.

When you go over the limit, the API returns `429 Too Many Requests` with a `Retry-After` header giving the number of seconds to wait:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 45
X-RateLimit-Backend: upstash

{"error":{"code":"RATE_LIMIT_EXCEEDED","message":"Rate limit of 100 requests per 60s exceeded. Retry after 45s."}}
```

The count is kept in **Upstash Redis**, so it's shared across every serverless instance serving the API. Without a shared store, each instance would keep its own count, and a client whose requests were spread across instances could go well past the limit.

Every response includes an `X-RateLimit-Backend` header showing which limiter handled the request: `upstash` in production, or `memory` when the API runs without Upstash credentials (local development, where it falls back to a counter in the process's memory).

Check it yourself:

```bash
curl -sI "https://food-api-sigma-rosy.vercel.app/api/v1/restaurants?limit=1" | grep -i x-ratelimit
```

The repo includes a script that sends 101 requests at once and reports the status codes:

```bash
node scripts/rate-limit-test.mjs https://food-api-sigma-rosy.vercel.app 101 101
# Summary (3.6s total): { '200': 100, '429': 1 }
```

---

## 8. Seed script

[`prisma/seed.ts`](prisma/seed.ts) fills the database with realistic sample data: **50 restaurants, 744 menu items, 473 orders and 1,428 order items**, all set in Lagos, Nigeria.

Run it with `DATABASE_URL` set in `.env` and the migrations applied:

```bash
npx prisma migrate deploy   # create the tables (first time only)
npx prisma db seed
```

When it finishes, it prints the row count of each table next to the expected count, and checks that every order's total matches its line items.

**The seed is repeatable. Running it twice produces no duplicates:**

- The data is generated from a fixed random seed, so every run produces the same restaurants, menus and orders.
- Every record has a fixed ID (`restaurant-1`, `menuitem-1-8`, `order-1-0`, …) and is written with an upsert: created if missing, updated if present.

Two things to know when re-running it against a database that's in use:

- Seeded records are **reset to their seeded values**. For example, if you changed `order-1-0` to `CONFIRMED` through the API, re-seeding sets it back to its original status.
- Records created through the API (with cuid IDs) are **left alone**. The seed never deletes anything.

The script connects over the network with generous timeouts and retries each restaurant up to 4 times, so it can cope with a slow or remote database such as Neon.

---

## 9. Consumer

**https://food-api-sigma-rosy.vercel.app/consumer**

A small client app that uses only the public API. Its source is in [`src/app/consumer/page.tsx`](src/app/consumer/page.tsx). It shows how to:

- fetch `GET /restaurants?limit=10` and show name, cuisine, rating and open/closed status
- filter with `cuisineType` as the user types (waiting until typing stops so it doesn't use up the rate limit)
- page through results with `offset` and `meta.hasMore`, showing `meta.total`
- handle loading, empty and error states, including showing the API's `error.message`

> **Calling the API from a browser:** the API doesn't currently send CORS headers, so browser code on another domain can't call it; the browser blocks the response. Server-side code, scripts and `curl` work from anywhere. The consumer works because it's served from the same domain as the API.

---

## 10. Running locally

Requirements: Node.js 20+ and a PostgreSQL database (e.g. a free [Neon](https://neon.tech) database or a local Postgres).

```bash
git clone https://github.com/chimaworlu/food-api.git
cd food-api
npm install

cp .env.example .env        # then set DATABASE_URL
npx prisma generate         # generate the database client
npx prisma migrate deploy   # create the tables
npx prisma db seed          # load sample data

npm run dev                 # http://localhost:3000
```

Environment variables (see [`.env.example`](.env.example)):

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `KV_REST_API_URL` | no | Upstash Redis REST URL. Set automatically by the Vercel KV / Upstash integration. Leave unset to use the in-memory rate limiter |
| `KV_REST_API_TOKEN` | no | Upstash Redis REST token. Required if `KV_REST_API_URL` is set |
| `RATE_LIMIT_MAX` | no | Requests allowed per window. Default `100` |
| `RATE_LIMIT_WINDOW_MS` | no | Rate limit window in milliseconds. Default `60000` |
| `DEFAULT_PAGE_LIMIT` | no | Default `limit` for list endpoints. Default `20` |
| `MAX_PAGE_LIMIT` | no | Maximum `limit` for list endpoints. Default `100` |

**Tech stack:** Next.js 16 (App Router route handlers), Prisma 7 with the `pg` driver adapter, PostgreSQL on Neon, Zod for validation, Upstash Redis for rate limiting, deployed on Vercel.
