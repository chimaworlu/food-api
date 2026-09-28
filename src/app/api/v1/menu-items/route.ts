import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { internalError, success } from "@/lib/response";
import { listQuerySchema, queryFilters, validateQuery } from "@/lib/validate-query";

const SORTABLE_FIELDS = ["name", "priceMinor", "createdAt"] as const;

const querySchema = listQuerySchema(SORTABLE_FIELDS, {
  filters: {
    category: queryFilters.string("category"),
    maxPrice: queryFilters.int("maxPrice"),
    minPrice: queryFilters.int("minPrice"),
    isAvailable: queryFilters.boolean("isAvailable"),
  },
});

export async function GET(request: Request) {
  const limited = await enforceRateLimit(request);
  if (limited) {
    return limited;
  }

  const query = validateQuery(request, querySchema);
  if (!query.ok) {
    return query.response;
  }

  const { limit, offset, sort, order, category, maxPrice, minPrice, isAvailable } =
    query.data;

  const where: Prisma.MenuItemWhereInput = {
    ...(category === undefined ? {} : { category }),
    ...(maxPrice === undefined ? {} : { priceMinor: { lte: maxPrice } }),
    ...(minPrice === undefined ? {} : { priceMinor: { gte: minPrice } }),
    ...(isAvailable === undefined ? {} : { isAvailable }),
  };

  const orderBy = { [sort]: order } as Prisma.MenuItemOrderByWithRelationInput;

  try {
    const [menuItems, total] = await prisma.$transaction([
      prisma.menuItem.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        select: {
          id: true,
          restaurantId: true,
          name: true,
          description: true,
          priceMinor: true,
          category: true,
          isAvailable: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.menuItem.count({ where }),
    ]);

    return success(menuItems, {
      total,
      limit,
      offset,
      hasMore: offset + menuItems.length < total,
    });
  } catch (cause) {
    return internalError("GET /api/v1/menu-items failed", cause);
  }
}
