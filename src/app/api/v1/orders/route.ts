import { z } from "zod";

import {
  OrderStatus,
  type Prisma,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { enforceRateLimit, withRateLimitHeaders } from "@/lib/rate-limit";
import {
  created,
  internalError,
  success,
  unprocessable,
} from "@/lib/response";
import {
  listQuerySchema,
  queryFilters,
  validateJsonBody,
  validateQuery,
} from "@/lib/validate-query";

const SORTABLE_FIELDS = ["createdAt", "totalAmountMinor"] as const;

const querySchema = listQuerySchema(SORTABLE_FIELDS, {
  filters: {
    status: z.enum(OrderStatus).optional(),
    customerEmail: queryFilters.string("customerEmail"),
  },
});

const createOrderSchema = z.object({
  restaurantId: z
    .string({ error: "restaurantId must be a string" })
    .min(1, "restaurantId must not be empty"),
  customerName: z
    .string({ error: "customerName must be a string" })
    .trim()
    .min(1, "customerName must not be empty"),
  customerEmail: z.email("customerEmail must be a valid email address"),
  items: z
    .array(
      z.object({
        menuItemId: z
          .string({ error: "menuItemId must be a string" })
          .min(1, "menuItemId must not be empty"),
        quantity: z
          .number({ error: "quantity must be a number" })
          .int("quantity must be an integer")
          .min(1, "quantity must be at least 1"),
      }),
    )
    .min(1, "items must contain at least one item"),
});

/** Business-rule rejection inside the transaction, surfaced as 422. */
class UnprocessableOrderError extends Error {}

const ORDER_LIST_SELECT = {
  id: true,
  restaurantId: true,
  customerName: true,
  customerEmail: true,
  status: true,
  totalAmountMinor: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrderSelect;

export async function GET(request: Request) {
  const rateLimit = await enforceRateLimit(request);
  if (rateLimit.response) {
    return rateLimit.response;
  }

  return withRateLimitHeaders(await listOrders(request), rateLimit);
}

async function listOrders(request: Request) {
  const query = validateQuery(request, querySchema);
  if (!query.ok) {
    return query.response;
  }

  const { limit, offset, sort, order, status, customerEmail } = query.data;

  const where: Prisma.OrderWhereInput = {
    ...(status === undefined ? {} : { status }),
    ...(customerEmail === undefined ? {} : { customerEmail }),
  };

  const orderBy = { [sort]: order } as Prisma.OrderOrderByWithRelationInput;

  try {
    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        select: ORDER_LIST_SELECT,
      }),
      prisma.order.count({ where }),
    ]);

    return success(orders, {
      total,
      limit,
      offset,
      hasMore: offset + orders.length < total,
    });
  } catch (cause) {
    return internalError("GET /api/v1/orders failed", cause);
  }
}

export async function POST(request: Request) {
  const rateLimit = await enforceRateLimit(request);
  if (rateLimit.response) {
    return rateLimit.response;
  }

  return withRateLimitHeaders(await createOrder(request), rateLimit);
}

async function createOrder(request: Request) {
  const body = await validateJsonBody(request, createOrderSchema);
  if (!body.ok) {
    return body.response;
  }

  const { restaurantId, customerName, customerEmail, items } = body.data;
  const requestedIds = [...new Set(items.map((item) => item.menuItemId))];

  try {
    const order = await prisma.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.findUnique({
        where: { id: restaurantId },
        select: { id: true },
      });

      if (!restaurant) {
        throw new UnprocessableOrderError(
          `Restaurant ${restaurantId} does not exist, so the order cannot be placed.`,
        );
      }

      const menuItems = await tx.menuItem.findMany({
        where: { id: { in: requestedIds }, restaurantId },
        select: { id: true, priceMinor: true, isAvailable: true },
      });

      if (menuItems.length !== requestedIds.length) {
        const found = new Set(menuItems.map((item) => item.id));
        const unknown = requestedIds.filter((id) => !found.has(id));
        throw new UnprocessableOrderError(
          `Menu item(s) not found for this restaurant: ${unknown.join(", ")}.`,
        );
      }

      const unavailable = menuItems.filter((item) => !item.isAvailable);
      if (unavailable.length > 0) {
        throw new UnprocessableOrderError(
          `Menu item(s) currently unavailable: ${unavailable
            .map((item) => item.id)
            .join(", ")}.`,
        );
      }

      const priceByMenuItemId = new Map(
        menuItems.map((item) => [item.id, item.priceMinor]),
      );

      const lines = items.map((item) => ({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        priceMinor: priceByMenuItemId.get(item.menuItemId) ?? 0,
      }));

      const totalAmountMinor = lines.reduce(
        (sum, line) => sum + line.priceMinor * line.quantity,
        0,
      );

      return tx.order.create({
        data: {
          restaurantId,
          customerName,
          customerEmail,
          status: OrderStatus.PENDING,
          totalAmountMinor,
          items: { create: lines },
        },
        include: { items: true },
      });
    });

    return created(order);
  } catch (cause) {
    if (cause instanceof UnprocessableOrderError) {
      return unprocessable(cause.message);
    }
    return internalError("POST /api/v1/orders failed", cause);
  }
}
