import { PrismaClient } from "./generated/prisma";

const prisma = new PrismaClient();

const main = async () => {
  const login = await fetch(`https://${process.env.HEYNABO_HOST}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: process.env.HEYNABO_EMAIL,
      password: process.env.HEYNABO_PASSWORD,
    }),
  });
  if (!login.ok) {
    throw new Error(`Login failed: ${login.statusText}`);
  }
  const userData = (await login.json()) as {
    id: number;
    type: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    emergencyContact: string | null;
    dateOfBirth: string | null;
    description: string | null;
    uiStorage: string; // Assuming this is a JSON string
    role: string;
    roles: any[]; // Assuming this can be an array of objects
    avatar: string;
    alias: string | null;
    locationId: number;
    isFirstLogin: boolean;
    lastLogin: string;
    inviteSent: string;
    created: string;
    token: string;
  };
  console.log(
    `Logged in as ${userData.firstName} ${userData.lastName} (${userData.email})`
  );
  const booking = await fetch(
    `https://${process.env.HEYNABO_HOST}/api/members/bookings/items/${process.env.HEYNABO_BOOKING_ID}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userData.token}`,
      },
    }
  );
  if (!booking.ok) {
    throw new Error(`Booking fetch failed: ${booking.statusText}`);
  }

  const bookingData = (await booking.json()) as {
    id: number;
    type: string;
    name: string;
    description: string;
    userCommentText: string;
    created: string;
    status: string;
    price: string;
    fee: string;
    allowExemptPayment: boolean;
    locationId: number | null;
    locationText: string | null;
    durationType: string;
    accountantCategory: any; // Assuming this can be null or an object
    ordersVisible: boolean;
    availability: {
      durationPeriod: number;
      durationPeriodUnit: string;
      startTime: string;
      endTime: string;
      timeZone: string;
      singleSlotBookings: any; // Assuming this can be null or an object
      activeWeekDays: string[];
    };
    pauses: any[]; // Assuming this is an array of objects
    orders: Array<{
      id: number;
      type: string;
      bookingId: number;
      userId: number;
      status: string;
      userComment: string;
      start: string;
      end: string;
      created: string;
    }>;
  };

  console.log(`Booking ID: ${bookingData.id}`);

  // Upsert all current ACTIVE orders and update lastSeenActiveAt
  const now = new Date();
  const activeOrderIds = bookingData.orders.map((order) => order.id);
  for (const order of bookingData.orders) {
    await prisma.order.upsert({
      where: { id: order.id },
      update: {
        status: order.status,
        lastSeenActiveAt: order.status === "ACTIVE" ? now : null,
      },
      create: {
        id: order.id,
        type: order.type,
        bookingId: order.bookingId,
        userId: order.userId,
        status: order.status,
        userComment: order.userComment,
        start: new Date(order.start),
        end: new Date(order.end),
        created: new Date(order.created),
        lastSeenActiveAt: order.status === "ACTIVE" ? now : null,
      },
    });
  }

  // Find orders in DB that were previously ACTIVE but are not in the current API response
  const previouslyActiveOrders = await prisma.order.findMany({
    where: {
      lastSeenActiveAt: { not: null },
      id: { notIn: activeOrderIds },
    },
  });
  for (const order of previouslyActiveOrders) {
    const now = new Date();
    const orderEnd = new Date(order.end);
    let newStatus = "INACTIVE";
    if (now < orderEnd) {
      newStatus = "DELETED";
    }
    console.log(
      `Order ${
        order.id
      } is no longer ACTIVE (last seen at ${order.lastSeenActiveAt?.toISOString()}) - setting status to ${newStatus}`
    );
    // Update the order to set status
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: newStatus,
      },
    });
  }

  // --- ENFORCE BOOKING/ORDER RULES ---
  // 1. No locationId (from user) can have more than one future order
  // 2. No locationId (from user) can have more than 2 orders per year
  // 3. No locationId > 39 is allowed to have orders

  // Get all orders with their users and user.locationId
  const allOrders = await prisma.order.findMany({
    include: { user: true },
  });

  // Group orders by user.locationId
  const ordersByLocation: Record<number, typeof allOrders> = {};
  for (const order of allOrders) {
    const locId = order.user?.locationId;
    if (!locId) continue;
    if (!ordersByLocation[locId]) ordersByLocation[locId] = [];
    ordersByLocation[locId].push(order);
  }

  const nowDate = new Date();
  const currentYear = nowDate.getFullYear();

  const locationViolations: Record<string, string[]> = {};

  // Fetch all locations and users for mapping
  const allLocations = await prisma.location.findMany();
  const allUsers = await prisma.user.findMany();
  // Use address, city, and id for location display
  const locationMap = Object.fromEntries(
    allLocations.map((l) => [
      l.id,
      `${l.address || ""}, ${l.city || ""}`.replace(/^, |, $/g, "") ||
        `Location #${l.id}`,
    ])
  );
  const userMap = Object.fromEntries(
    allUsers.map((u) => [u.id, `${u.firstName} ${u.lastName}`])
  );

  for (const [locId, orders] of Object.entries(ordersByLocation)) {
    // Rule 1: More than one future order
    const futureOrders = orders
      .filter((o) => o.start > nowDate)
      .sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
      );
    if (futureOrders.length > 1) {
      const details = futureOrders
        .map(
          (o) =>
            `(${userMap[o.userId] || o.userId}, ${new Date(
              o.start
            ).toLocaleString("en-GB", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })})`
        )
        .join(" ");
      const msg = `Has more than one future booking ${details}`;
      if (!locationViolations[locId]) locationViolations[locId] = [];
      locationViolations[locId].push(`${msg}`);
      console.log(`${locationMap[locId] || `Location #${locId}`}: ${msg}`);
    }
    // Rule 2: More than 2 orders per year
    const ordersThisYear = orders
      .filter((o) => new Date(o.start).getFullYear() === currentYear)
      .sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
      );
    if (ordersThisYear.length > 2) {
      const details = ordersThisYear
        .map(
          (o) =>
            `(${userMap[o.userId] || o.userId}, ${new Date(
              o.start
            ).toLocaleString("en-GB", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })})`
        )
        .join(" ");
      const msg = `Has more than 2 bookings in ${currentYear} ${details}`;
      if (!locationViolations[locId]) locationViolations[locId] = [];
      locationViolations[locId].push(`${msg}`);
      console.log(`${locationMap[locId] || `Location #${locId}`}: ${msg}`);
    }
  }

  // Rule 3: locationId > 39 is not allowed to have orders
  for (const [locId, orders] of Object.entries(ordersByLocation)) {
    const sortedOrders = orders
      .slice()
      .sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
      );
    if (Number(locId) > 39 && sortedOrders.length > 0) {
      const details = sortedOrders
        .map(
          (o) =>
            `(${userMap[o.userId] || o.userId}, ${new Date(
              o.start
            ).toLocaleString("en-GB", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })})`
        )
        .join(" ");
      const msg = `Is not allowed to have bookings ${details}`;
      if (!locationViolations[locId]) locationViolations[locId] = [];
      locationViolations[locId].push(`${msg}`);
      console.log(`${locationMap[locId] || `Location #${locId}`}: ${msg}`);
    }
  }

  // Build grouped violation paragraphs
  const violationParagraphs: string[] = [];
  for (const [locId, violations] of Object.entries(locationViolations)) {
    violationParagraphs.push(
      `<p><b>${
        locationMap[locId] || `Location #${locId}`
      }</b><br>${violations.join("<br>")}</p>`
    );
  }

  // Post violation summary to group if there are violations
  if (violationParagraphs.length > 0) {
    const today = nowDate.toLocaleDateString("en-GB");
    const postBody = {
      headline: `<p>Current rule violations (${today})</p>`,
      text: violationParagraphs.join("\n"),
      groupId: "12",
      public: false,
    };
    const postResp = await fetch(
      `https://${process.env.HEYNABO_HOST}/api/members/posts`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userData.token}`,
        },
        body: JSON.stringify(postBody),
      }
    );
    if (!postResp.ok) {
      console.error("Failed to post violation summary:", await postResp.text());
    } else {
      console.log("Violation summary posted to group 12.");
    }
  }
  // --- END ENFORCE BOOKING/ORDER RULES ---
};

main()
  .then(() => {
    console.log("Script executed successfully.");
  })
  .catch((error) => {
    console.error("Error executing script:", error);
    process.exit(1);
  });
