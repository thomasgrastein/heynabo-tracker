/*
  Warnings:

  - You are about to drop the column `locationId` on the `Order` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_locationId_fkey";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "locationId";
