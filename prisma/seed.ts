import "dotenv/config";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, OrderStatus, Prisma } from "../src/generated/prisma/client";

import { faker } from "@faker-js/faker";

const RESTAURANT_COUNT = 50;
const MENU_ITEMS_PER_RESTAURANT = { min: 10, max: 20 } as const;
const ORDERS_PER_RESTAURANT = { min: 5, max: 15 } as const;
const ITEMS_PER_ORDER = { min: 1, max: 5 } as const;
const QUANTITY_PER_ITEM = { min: 1, max: 5 } as const;
const PRICE_MINOR = { min: 50_000, max: 2_000_000 } as const;
const FAKER_SEED = 20260926;
const RESTAURANTS_PER_BATCH = 2;

/**
 * The database is remote (e.g. Render Frankfurt), so transactions and pool
 * connections need generous timeouts, connection keep-alive, and retry resilience
 * against transient network hiccups.
 */
const POOL_MAX = 10;
const POOL_CONNECTION_TIMEOUT_MS = 45_000;
const TRANSACTION_MAX_WAIT_MS = 60_000;
const TRANSACTION_TIMEOUT_MS = 600_000;

const CUISINES = [
  "Nigerian",
  "Chinese",
  "Italian",
  "American",
  "Indian",
  "Lebanese",
  "Mexican",
  "Japanese",
  "Continental",
] as const;

type CuisineType = (typeof CUISINES)[number];

type Category = "Starters" | "Mains" | "Sides" | "Drinks" | "Desserts";

type MenuItemSpec = { name: string; category: Category };

const CUISINE_MENU: Record<CuisineType, MenuItemSpec[]> = {
  Nigerian: [
    { name: "Puff Puff", category: "Starters" },
    { name: "Suya Skewers", category: "Starters" },
    { name: "Chin Chin", category: "Starters" },
    { name: "Pepper Soup", category: "Starters" },
    { name: "Jollof Rice", category: "Mains" },
    { name: "Fried Rice", category: "Mains" },
    { name: "Egusi Soup with Fufu", category: "Mains" },
    { name: "Banga Soup", category: "Mains" },
    { name: "Nkwobi", category: "Mains" },
    { name: "Okro Soup with Ewedu", category: "Mains" },
    { name: "Fried Plantain", category: "Sides" },
    { name: "Coleslaw", category: "Sides" },
    { name: "Suya Spice Dip", category: "Sides" },
    { name: "Yam and Egg Sauce", category: "Sides" },
    { name: "Chapman", category: "Drinks" },
    { name: "Zobo", category: "Drinks" },
    { name: "Kunu", category: "Drinks" },
    { name: "Ginger Drink", category: "Drinks" },
    { name: "Akarakun Coconut Candy", category: "Desserts" },
    { name: "Coconut Bread", category: "Desserts" },
    { name: "Coconut Cookies", category: "Desserts" },
  ],
  Chinese: [
    { name: "Spring Rolls", category: "Starters" },
    { name: "Crispy Wontons", category: "Starters" },
    { name: "Steamed Dumplings", category: "Starters" },
    { name: "Egg Roll", category: "Starters" },
    { name: "Kung Pao Chicken", category: "Mains" },
    { name: "Sweet and Sour Chicken", category: "Mains" },
    { name: "Beef with Black Bean Sauce", category: "Mains" },
    { name: "Shrimp Fried Rice", category: "Mains" },
    { name: "Vegetable Chow Mein", category: "Mains" },
    { name: "Pad Thai Noodles", category: "Mains" },
    { name: "Seasonal Vegetables", category: "Sides" },
    { name: "Fried Rice", category: "Sides" },
    { name: "Spring Onion Salad", category: "Sides" },
    { name: "Jasmine Tea", category: "Drinks" },
    { name: "Lychee Soda", category: "Drinks" },
    { name: "Jujube Tea", category: "Drinks" },
    { name: "Chinese Yoghurt", category: "Desserts" },
    { name: "Sesame Ball", category: "Desserts" },
    { name: "Almond Cookie", category: "Desserts" },
  ],
  Italian: [
    { name: "Bruschetta al Pomodoro", category: "Starters" },
    { name: "Arancini", category: "Starters" },
    { name: "Calamari Fritti", category: "Starters" },
    { name: "Caprese Salad", category: "Starters" },
    { name: "Spaghetti Carbonara", category: "Mains" },
    { name: "Lasagna alla Bolognese", category: "Mains" },
    { name: "Chicken Parmigiana", category: "Mains" },
    { name: "Risotto ai Funghi", category: "Mains" },
    { name: "Grilled Branzino", category: "Mains" },
    { name: "Margherita Pizza", category: "Mains" },
    { name: "Garlic Bread", category: "Sides" },
    { name: "Rocket Salad", category: "Sides" },
    { name: "Seasonal Vegetables", category: "Sides" },
    { name: "Espresso", category: "Drinks" },
    { name: "Aperol Spritz", category: "Drinks" },
    { name: "Sparkling Water", category: "Drinks" },
    { name: "Tiramisu", category: "Desserts" },
    { name: "Panna Cotta", category: "Desserts" },
    { name: "Gelato", category: "Desserts" },
  ],
  American: [
    { name: "Buffalo Wings", category: "Starters" },
    { name: "Onion Rings", category: "Starters" },
    { name: "Loaded Nachos", category: "Starters" },
    { name: "Spinach Artichoke Dip", category: "Starters" },
    { name: "Smash Burger", category: "Mains" },
    { name: "Crispy Fried Chicken", category: "Mains" },
    { name: "Mac and Cheese", category: "Mains" },
    { name: "New York Cheesesteak", category: "Mains" },
    { name: "BBQ Ribs", category: "Mains" },
    { name: "Veggie Burger", category: "Mains" },
    { name: "French Fries", category: "Sides" },
    { name: "House Salad", category: "Sides" },
    { name: "Coleslaw", category: "Sides" },
    { name: "Sweet Tea", category: "Drinks" },
    { name: "Root Beer Float", category: "Drinks" },
    { name: "Lemonade", category: "Drinks" },
    { name: "Apple Pie", category: "Desserts" },
    { name: "Brownie Sundae", category: "Desserts" },
    { name: "Chocolate Chip Cookie", category: "Desserts" },
  ],
  Indian: [
    { name: "Samosa", category: "Starters" },
    { name: "Pakora", category: "Starters" },
    { name: "Chicken Tikka", category: "Starters" },
    { name: "Onion Bhaji", category: "Starters" },
    { name: "Butter Chicken", category: "Mains" },
    { name: "Paneer Butter Masala", category: "Mains" },
    { name: "Lamb Rogan Josh", category: "Mains" },
    { name: "Chana Masala", category: "Mains" },
    { name: "Biryani", category: "Mains" },
    { name: "Palak Paneer with Naan", category: "Mains" },
    { name: "Garlic Naan", category: "Sides" },
    { name: "Raita", category: "Sides" },
    { name: "Masala Fries", category: "Sides" },
    { name: "Mango Lassi", category: "Drinks" },
    { name: "Masala Chai", category: "Drinks" },
    { name: "Fresh Lime Soda", category: "Drinks" },
    { name: "Gulab Jamun", category: "Desserts" },
    { name: "Jalebi", category: "Desserts" },
    { name: "Kulfi", category: "Desserts" },
  ],
  Lebanese: [
    { name: "Hummus with Pita", category: "Starters" },
    { name: "Baba Ganoush", category: "Starters" },
    { name: "Tabbouleh", category: "Starters" },
    { name: "Fatteh", category: "Starters" },
    { name: "Chicken Shawarma", category: "Mains" },
    { name: "Kebab Halabi", category: "Mains" },
    { name: "Lamb Chops with Rice", category: "Mains" },
    { name: "Fish Taouzia", category: "Mains" },
    { name: "Fatteh with Lamb", category: "Mains" },
    { name: "Chicken Fatteh", category: "Mains" },
    { name: "Foul Medames", category: "Sides" },
    { name: "Rocket and Tomato Salad", category: "Sides" },
    { name: "Rice with Tomato", category: "Sides" },
    { name: "Mint Lemonade", category: "Drinks" },
    { name: "Rose Water Sharbat", category: "Drinks" },
    { name: "Arabic Coffee", category: "Drinks" },
    { name: "Baklava", category: "Desserts" },
    { name: "Knafeh", category: "Desserts" },
    { name: "Mahalabia", category: "Desserts" },
  ],
  Mexican: [
    { name: "Guacamole with Chips", category: "Starters" },
    { name: "Tostada", category: "Starters" },
    { name: "Quesadilla", category: "Starters" },
    { name: "Elote", category: "Starters" },
    { name: "Chicken Tacos", category: "Mains" },
    { name: "Carne Asada Burrito", category: "Mains" },
    { name: "Enchiladas Rojas", category: "Mains" },
    { name: "Fajitas", category: "Mains" },
    { name: "Chilli Con Carne", category: "Mains" },
    { name: "Tinga Tacos", category: "Mains" },
    { name: "Refried Beans", category: "Sides" },
    { name: "Mexican Street Corn", category: "Sides" },
    { name: "Salsa and Nachos", category: "Sides" },
    { name: "Horchata", category: "Drinks" },
    { name: "Agua de Jamaica", category: "Drinks" },
    { name: "Margarita", category: "Drinks" },
    { name: "Churros", category: "Desserts" },
    { name: "Flan", category: "Desserts" },
    { name: "Dulce de Leche Cheesecake", category: "Desserts" },
  ],
  Japanese: [
    { name: "Edamame", category: "Starters" },
    { name: "Gyoza", category: "Starters" },
    { name: "Crispy Soft Shell Crab", category: "Starters" },
    { name: "Miso Soup", category: "Starters" },
    { name: "Chicken Katsu Curry", category: "Mains" },
    { name: "Salmon Sashimi", category: "Mains" },
    { name: "Tonkotsu Ramen", category: "Mains" },
    { name: "Chicken Teriyaki", category: "Mains" },
    { name: "Vegetable Tempura", category: "Mains" },
    { name: "Beef Donburi", category: "Mains" },
    { name: "Gohan", category: "Sides" },
    { name: "Wakame Salad", category: "Sides" },
    { name: "Agedashi Tofu", category: "Sides" },
    { name: "Green Tea", category: "Drinks" },
    { name: "Yuzu Lemonade", category: "Drinks" },
    { name: "Ramune", category: "Drinks" },
    { name: "Mochi Ice Cream", category: "Desserts" },
    { name: "Dorayaki", category: "Desserts" },
    { name: "Matcha Cake", category: "Desserts" },
  ],
  Continental: [
    { name: "Chicken Caesar Salad", category: "Starters" },
    { name: "Tomato Bruschetta", category: "Starters" },
    { name: "Cream of Mushroom Soup", category: "Starters" },
    { name: "Waldorf Salad", category: "Starters" },
    { name: "Grilled Chicken Breast", category: "Mains" },
    { name: "Beef Steak with Pepper Sauce", category: "Mains" },
    { name: "Baked Fish with Vegetables", category: "Mains" },
    { name: "Pasta primavera", category: "Mains" },
    { name: "Chicken and Prawn Platter", category: "Mains" },
    { name: "Club Sandwich", category: "Mains" },
    { name: "Garlic Fries", category: "Sides" },
    { name: "Seasonal Vegetable Medley", category: "Sides" },
    { name: "House Slaw", category: "Sides" },
    { name: "Fresh Fruit Juice", category: "Drinks" },
    { name: "Iced Tea", category: "Drinks" },
    { name: "Sparkling Water", category: "Drinks" },
    { name: "Cheesecake", category: "Desserts" },
    { name: "Chocolate Gateau", category: "Desserts" },
    { name: "Ice Cream", category: "Desserts" },
  ],
};

const NAME_PREFIXES = [
  "Mama",
  "Alhaji",
  "Baba",
  "Uncle",
  "Auntie",
  "Chef",
  "Oba",
  "Chief",
  "King",
  "Queen",
  "Royal",
  "Golden",
  "Spice",
  "Taste",
  "Sizzle",
] as const;

const NAME_SUFFIXES = [
  "Kitchen",
  "Grill",
  "House",
  "Junctions",
  "Palace",
  "Canteen",
  "Bistro",
  "Spot",
  "Hub",
  "Table",
  "Lounge",
  "Bakery",
] as const;

const ORDER_STATUSES = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
] as const;

type MenuItemPlan = {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  priceMinor: number;
  category: string;
  isAvailable: boolean;
};

type OrderItemPlan = {
  id: string;
  orderId: string;
  menuItemId: string;
  quantity: number;
  priceMinor: number;
};

type OrderPlan = {
  id: string;
  restaurantId: string;
  customerName: string;
  customerEmail: string;
  status: (typeof ORDER_STATUSES)[number];
  totalAmountMinor: number;
  items: OrderItemPlan[];
};

type RestaurantPlan = {
  id: string;
  name: string;
  cuisineType: string;
  address: string;
  rating: number;
  isOpen: boolean;
  menuItems: MenuItemPlan[];
  orders: OrderPlan[];
};

function pickMenuItemSpecs(
  cuisine: CuisineType,
  count: number,
): MenuItemSpec[] {
  const catalogue = CUISINE_MENU[cuisine];
  const remaining = [...catalogue];
  const chosen: MenuItemSpec[] = [];

  while (chosen.length < count) {
    if (remaining.length === 0) {
      remaining.push(...catalogue);
    }
    const index = faker.number.int({ min: 0, max: remaining.length - 1 });
    const [spec] = remaining.splice(index, 1);
    if (spec) {
      chosen.push(spec);
    }
  }

  return chosen;
}

function buildRestaurantPlan(index: number): RestaurantPlan {
  const restaurantId = `restaurant-${index}`;
  const cuisine = faker.helpers.arrayElement(CUISINES);

  const menuItemCount = faker.number.int(MENU_ITEMS_PER_RESTAURANT);
  const specs = pickMenuItemSpecs(cuisine, menuItemCount);

  const menuItems: MenuItemPlan[] = specs.map((spec, itemIndex) => ({
    id: `menuitem-${index}-${itemIndex}`,
    restaurantId,
    name: spec.name,
    description: faker.lorem.sentence(),
    priceMinor: faker.number.int(PRICE_MINOR),
    category: spec.category,
    isAvailable: faker.helpers.weightedArrayElement([
      { value: true, weight: 80 },
      { value: false, weight: 20 },
    ]),
  }));

  const orderCount = faker.number.int(ORDERS_PER_RESTAURANT);

  const orders: OrderPlan[] = Array.from({ length: orderCount }, (_, orderIndex) => {
    const orderId = `order-${index}-${orderIndex}`;
    const lineCount = faker.number.int(ITEMS_PER_ORDER);

    const shuffled = [...menuItems];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = faker.number.int({ min: 0, max: i });
      const a = shuffled[i]!;
      const b = shuffled[j]!;
      shuffled[i] = b;
      shuffled[j] = a;
    }

    const lines = shuffled.slice(0, Math.min(lineCount, shuffled.length));

    const items: OrderItemPlan[] = lines.map((line, lineIndex) => ({
      id: `orderitem-${index}-${orderIndex}-${lineIndex}`,
      orderId,
      menuItemId: line.id,
      quantity: faker.number.int(QUANTITY_PER_ITEM),
      priceMinor: line.priceMinor,
    }));

    const totalAmountMinor = items.reduce(
      (total, item) => total + item.quantity * item.priceMinor,
      0,
    );

    return {
      id: orderId,
      restaurantId,
      customerName: faker.person.fullName(),
      customerEmail: faker.internet.email(),
      status: faker.helpers.arrayElement(ORDER_STATUSES),
      totalAmountMinor,
      items,
    };
  });

  return {
    id: restaurantId,
    name: `${faker.helpers.arrayElement(NAME_PREFIXES)} ${faker.person.lastName()}'s ${faker.helpers.arrayElement(NAME_SUFFIXES)}`,
    cuisineType: cuisine,
    address: `${faker.location.streetAddress()}, Lagos, Nigeria`,
    rating: Math.round(faker.number.float({ min: 3.0, max: 5.0 }) * 10) / 10,
    isOpen: faker.datatype.boolean(),
    menuItems,
    orders,
  };
}

function buildPlans(): RestaurantPlan[] {
  faker.seed(FAKER_SEED);
  return Array.from({ length: RESTAURANT_COUNT }, (_, i) =>
    buildRestaurantPlan(i + 1),
  );
}

async function upsertRestaurant(prisma: PrismaClient, plan: RestaurantPlan) {
  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.restaurant.upsert({
      where: { id: plan.id },
      create: {
        id: plan.id,
        name: plan.name,
        cuisineType: plan.cuisineType,
        address: plan.address,
        rating: plan.rating,
        isOpen: plan.isOpen,
      },
      update: {
        name: plan.name,
        cuisineType: plan.cuisineType,
        address: plan.address,
        rating: plan.rating,
        isOpen: plan.isOpen,
      },
    }),
  ];

  for (const item of plan.menuItems) {
    operations.push(
      prisma.menuItem.upsert({
        where: { id: item.id },
        create: item,
        update: {
          name: item.name,
          description: item.description,
          priceMinor: item.priceMinor,
          category: item.category,
          isAvailable: item.isAvailable,
        },
      }),
    );
  }

  for (const order of plan.orders) {
    operations.push(
      prisma.order.upsert({
        where: { id: order.id },
        create: {
          id: order.id,
          restaurantId: order.restaurantId,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          status: order.status,
          totalAmountMinor: order.totalAmountMinor,
        },
        update: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          status: order.status,
          totalAmountMinor: order.totalAmountMinor,
        },
      }),
    );

    for (const line of order.items) {
      operations.push(
        prisma.orderItem.upsert({
          where: { id: line.id },
          create: line,
          update: { quantity: line.quantity, priceMinor: line.priceMinor },
        }),
      );
    }
  }

  await prisma.$transaction(operations);
}

async function upsertRestaurantWithRetry(
  prisma: PrismaClient,
  plan: RestaurantPlan,
  maxRetries = 4,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await upsertRestaurant(prisma, plan);
      return;
    } catch (err: unknown) {
      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt) {
        throw err;
      }
      const delayMs = attempt * 2500;
      console.warn(
        `[seed] Notice: Retrying restaurant "${plan.name}" (attempt ${attempt}/${maxRetries}) in ${delayMs / 1000}s due to transient connection issue...`,
      );
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
}

async function main() {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env (postgresql://postgres:postgres@localhost:5433/food_api?schema=public).",
    );
  }

  const pool = new pg.Pool({
    connectionString,
    max: POOL_MAX,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    keepAlive: true,
  });

  pool.on("error", (err) => {
    console.warn("[seed] Pool background warning:", err.message);
  });

  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({
    adapter,
    transactionOptions: {
      maxWait: TRANSACTION_MAX_WAIT_MS,
      timeout: TRANSACTION_TIMEOUT_MS,
    },
  });

  try {
    console.log("Warming up remote database connection...");
    await prisma.$queryRaw`SELECT 1`;
    console.log("Database connection established! Starting seed...");

    const plans = buildPlans();
    const expected = {
      restaurants: plans.length,
      menuItems: plans.reduce((n, p) => n + p.menuItems.length, 0),
      orders: plans.reduce((n, p) => n + p.orders.length, 0),
      orderItems: plans.reduce(
        (n, p) => n + p.orders.reduce((m, o) => m + o.items.length, 0),
        0,
      ),
    };

    for (let i = 0; i < plans.length; i += RESTAURANTS_PER_BATCH) {
      const batch = plans.slice(i, i + RESTAURANTS_PER_BATCH);
      await Promise.all(
        batch.map((plan) => upsertRestaurantWithRetry(prisma, plan)),
      );
      const completed = Math.min(i + RESTAURANTS_PER_BATCH, plans.length);
      console.log(`  [${completed}/${plans.length}] Restaurants seeded...`);
    }

    const [restaurants, menuItems, orders, orderItems] = await Promise.all([
      prisma.restaurant.count(),
      prisma.menuItem.count(),
      prisma.order.count(),
      prisma.orderItem.count(),
    ]);

    console.log("Seed complete.");
    console.log(`  restaurants  ${restaurants} (expected ${expected.restaurants})`);
    console.log(`  menuItems    ${menuItems} (expected ${expected.menuItems})`);
    console.log(`  orders       ${orders} (expected ${expected.orders})`);
    console.log(`  orderItems   ${orderItems} (expected ${expected.orderItems})`);

    const badTotals = await prisma.order.findMany({
      select: {
        id: true,
        totalAmountMinor: true,
        items: { select: { quantity: true, priceMinor: true } },
      },
    });

    const mismatched = badTotals.filter(
      (order) =>
        order.totalAmountMinor !==
        order.items.reduce((t, i) => t + i.quantity * i.priceMinor, 0),
    );

    if (mismatched.length > 0) {
      throw new Error(
        `${mismatched.length} order(s) have a totalAmountMinor that does not match their items.`,
      );
    }

    const [distinctRestaurants, distinctMenuItems, distinctOrders, distinctOrderItems] =
      await Promise.all([
        prisma.restaurant.findMany({ distinct: ["id"], select: { id: true } }),
        prisma.menuItem.findMany({ distinct: ["id"], select: { id: true } }),
        prisma.order.findMany({ distinct: ["id"], select: { id: true } }),
        prisma.orderItem.findMany({ distinct: ["id"], select: { id: true } }),
      ]);

    console.log(
      `  distinct ids  restaurants=${distinctRestaurants.length} menuItems=${distinctMenuItems.length} orders=${distinctOrders.length} orderItems=${distinctOrderItems.length}`,
    );
    console.log("  order totals verified against line items");
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
