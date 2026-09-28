import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { enforceRateLimit, withRateLimitHeaders } from "@/lib/rate-limit";
import { internalError, success } from "@/lib/response";
import { listQuerySchema, queryFilters, validateQuery } from "@/lib/validate-query";

const SORTABLE_FIELDS = ["name", "rating", "createdAt"] as const;

const querySchema = listQuerySchema(SORTABLE_FIELDS, {
  filters: {
    cuisineType: queryFilters.string("cuisineType"),
    minRating: queryFilters.float({ label: "minRating", min: 0, max: 5 }),
  },
});

/**
 * Explicit projection: the list contract must never leak menuItems or orders,
 * so they are not merely omitted but impossible to select by accident.
 */
const LIST_SELECT = {
  id: true,
  name: true,
  cuisineType: true,
  address: true,
  rating: true,
  isOpen: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RestaurantSelect;

export async function GET(request: Request) {
  const rateLimit = await enforceRateLimit(request);
  if (rateLimit.response) {
    return rateLimit.response;
  }

  return withRateLimitHeaders(await listRestaurants(request), rateLimit);
}

async function listRestaurants(request: Request) {
  const query = validateQuery(request, querySchema);
  if (!query.ok) {
    return query.response;
  }

  const { limit, offset, sort, order, cuisineType, minRating } = query.data;

  const where: Prisma.RestaurantWhereInput = {
    ...(cuisineType === undefined ? {} : { cuisineType }),
    ...(minRating === undefined ? {} : { rating: { gte: minRating } }),
  };

  const orderBy = { [sort]: order } as Prisma.RestaurantOrderByWithRelationInput;

  try {
    const [restaurants, total] = await prisma.$transaction([
      prisma.restaurant.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        select: LIST_SELECT,
      }),
      prisma.restaurant.count({ where }),
    ]);

    return success(restaurants, {
      total,
      limit,
      offset,
      hasMore: offset + restaurants.length < total,
    });
  } catch (cause) {
    return internalError("GET /api/v1/restaurants failed", cause);
  }
}
