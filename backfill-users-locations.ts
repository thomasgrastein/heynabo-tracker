import { PrismaClient } from "./generated/prisma";

const prisma = new PrismaClient();

async function main() {
  // Login to API
  const login = await fetch(`https://${process.env.HEYNABO_HOST}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.HEYNABO_EMAIL,
      password: process.env.HEYNABO_PASSWORD,
    }),
  });
  if (!login.ok) throw new Error(`Login failed: ${login.statusText}`);
  const userData = (await login.json()) as {
    token: string;
    // add other fields if needed
  };
  const token = userData.token;

  // Fetch all locations
  const locationsRes = await fetch(
    `https://${process.env.HEYNABO_HOST}/api/members/locations`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!locationsRes.ok)
    throw new Error(`Locations fetch failed: ${locationsRes.statusText}`);
  const locations = (await locationsRes.json()) as Array<{
    id: number;
    type: string;
    address: string;
    street: string;
    streetNumber: string;
    floor: string;
    ext: string;
    map: any;
    city: string;
    zipCode: string;
    typeId: number;
    hidden: boolean;
  }>;

  // Upsert locations
  for (const location of locations) {
    await prisma.location.upsert({
      where: { id: location.id },
      update: {
        type: location.type,
        address: location.address,
        street: location.street,
        streetNumber: location.streetNumber,
        floor: location.floor,
        ext: location.ext,
        map: location.map,
        city: location.city,
        zipCode: location.zipCode,
        typeId: location.typeId,
        hidden: location.hidden,
      },
      create: {
        id: location.id,
        type: location.type,
        address: location.address,
        street: location.street,
        streetNumber: location.streetNumber,
        floor: location.floor,
        ext: location.ext,
        map: location.map,
        city: location.city,
        zipCode: location.zipCode,
        typeId: location.typeId,
        hidden: location.hidden,
      },
    });
  }
  console.log(`Upserted ${locations.length} locations.`);

  // Fetch all users
  const usersRes = await fetch(
    `https://${process.env.HEYNABO_HOST}/api/members/users`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!usersRes.ok)
    throw new Error(`Users fetch failed: ${usersRes.statusText}`);
  const users = (await usersRes.json()) as {
    list: Array<{
      id: number;
      type: string;
      email: string;
      firstName: string;
      lastName: string;
      phone: string | null;
      emergencyContact: string | null;
      dateOfBirth: string | null;
      description: string | null;
      uiStorage: string | null;
      role: string;
      avatar: string;
      alias: string | null;
      locationId: number;
      isFirstLogin: boolean;
      lastLogin: string | null;
      inviteSent: string | null;
      created: string;
    }>;
  };

  console.log(`Fetched ${users.list.length} users from API.`);

  // Upsert users
  for (const user of users.list) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        type: user.type,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        emergencyContact: user.emergencyContact,
        dateOfBirth: user.dateOfBirth ? new Date(user.dateOfBirth) : null,
        description: user.description,
        uiStorage: user.uiStorage,
        role: user.role,
        avatar: user.avatar,
        alias: user.alias,
        locationId: user.locationId,
        isFirstLogin: user.isFirstLogin,
        lastLogin: user.lastLogin ? new Date(user.lastLogin) : null,
        inviteSent: user.inviteSent ? new Date(user.inviteSent) : null,
        created: new Date(user.created),
      },
      create: {
        id: user.id,
        type: user.type,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        emergencyContact: user.emergencyContact,
        dateOfBirth: user.dateOfBirth ? new Date(user.dateOfBirth) : null,
        description: user.description,
        uiStorage: user.uiStorage,
        role: user.role,
        avatar: user.avatar,
        alias: user.alias,
        locationId: user.locationId,
        isFirstLogin: user.isFirstLogin,
        lastLogin: user.lastLogin ? new Date(user.lastLogin) : null,
        inviteSent: user.inviteSent ? new Date(user.inviteSent) : null,
        created: new Date(user.created),
      },
    });
  }
  console.log(`Upserted ${users.list.length} users.`);
}

main()
  .then(() => {
    console.log("Backfill completed successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error during backfill:", error);
    process.exit(1);
  });
