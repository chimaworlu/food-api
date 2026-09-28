import { prisma } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { internalError, notFound, success } from "@/lib/response";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const limited = await enforceRateLimit(request);
  if (limited) {
    return limited;
  }

  const { id } = await params;

  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id },
      include: {
        menuItems: { orderBy: [{ category: "asc" }, { name: "asc" }] },
      },
    });

    if (!restaurant) {
      return notFound(`Restaurant ${id} was not found.`);
    }

    return success(restaurant);
  } catch (cause) {
    return internalError(`GET /api/v1/restaurants/${id} failed`, cause);
  }
}
