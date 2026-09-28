import { z } from "zod";

import { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { enforceRateLimit, withRateLimitHeaders } from "@/lib/rate-limit";
import {
  badRequest,
  internalError,
  notFound,
  success,
} from "@/lib/response";
import { validateJsonBody } from "@/lib/validate-query";

type RouteContext = { params: Promise<{ id: string }> };

const updateOrderSchema = z.object({
  status: z.enum(OrderStatus, { error: "status must be a valid order status" }).optional(),
});

export async function GET(request: Request, { params }: RouteContext) {
  const rateLimit = await enforceRateLimit(request);
  if (rateLimit.response) {
    return rateLimit.response;
  }

  const { id } = await params;
  return withRateLimitHeaders(await getOrder(id), rateLimit);
}

async function getOrder(id: string) {
  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      return notFound(`Order ${id} was not found.`);
    }

    return success(order);
  } catch (cause) {
    return internalError(`GET /api/v1/orders/${id} failed`, cause);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const rateLimit = await enforceRateLimit(request);
  if (rateLimit.response) {
    return rateLimit.response;
  }

  const { id } = await params;
  return withRateLimitHeaders(await updateOrder(request, id), rateLimit);
}

async function updateOrder(request: Request, id: string) {
  const body = await validateJsonBody(request, updateOrderSchema);

  if (!body.ok) {
    return body.response;
  }

  if (body.data.status === undefined) {
    return badRequest(
      'No updatable fields supplied. Send at least one of: { "status": "CONFIRMED" }.',
    );
  }

  const { status } = body.data;

  try {
    const existing = await prisma.order.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return notFound(`Order ${id} was not found.`);
    }

    const order = await prisma.order.update({
      where: { id },
      data: { status },
      include: { items: true },
    });

    return success(order);
  } catch (cause) {
    return internalError(`PATCH /api/v1/orders/${id} failed`, cause);
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const rateLimit = await enforceRateLimit(request);
  if (rateLimit.response) {
    return rateLimit.response;
  }

  const { id } = await params;
  return withRateLimitHeaders(await deleteOrder(id), rateLimit);
}

async function deleteOrder(id: string) {
  try {
    // OrderItem rows cascade on delete, so one statement is enough.
    const deleted = await prisma.order.deleteMany({ where: { id } });

    if (deleted.count === 0) {
      return notFound(`Order ${id} was not found.`);
    }

    return success({ message: "Order deleted" });
  } catch (cause) {
    return internalError(`DELETE /api/v1/orders/${id} failed`, cause);
  }
}
