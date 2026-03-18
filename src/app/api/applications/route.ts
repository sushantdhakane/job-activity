import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const ALLOWED_SORT_FIELDS = new Set([
  "emailDate",
  "company",
  "status",
  "dateApplied",
  "createdAt",
]);

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status")?.trim() || "";
    const platform = searchParams.get("platform")?.trim() || "";
    const search = searchParams.get("search")?.trim() || "";
    const requestedSortBy = searchParams.get("sortBy") || "emailDate";
    const sortBy = ALLOWED_SORT_FIELDS.has(requestedSortBy)
      ? requestedSortBy
      : "emailDate";
    const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

    // Build where clause
    const where: Prisma.JobApplicationWhereInput = { userId };
    if (status) where.status = status;
    if (platform) where.platform = platform;
    if (search) {
      where.OR = [
        { company: { contains: search, mode: "insensitive" } },
        { role: { contains: search, mode: "insensitive" } },
        { emailSubject: { contains: search, mode: "insensitive" } },
        { platform: { contains: search, mode: "insensitive" } },
      ];
    }

    // Fetch applications
    const applications = await prisma.jobApplication.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
    });

    // Fetch stats
    const stats = await prisma.jobApplication.groupBy({
      by: ["status"],
      where: { userId },
      _count: { id: true },
    });

    const lastSync = await prisma.syncLog.findFirst({
      where: { userId },
      orderBy: { syncedAt: "desc" },
    });

    return NextResponse.json({
      applications,
      stats: stats.reduce(
        (acc, s) => {
          acc[s.status] = s._count.id;
          return acc;
        },
        {} as Record<string, number>
      ),
      totalCount: applications.length,
      lastSyncAt: lastSync?.syncedAt || null,
    });
  } catch (error) {
    console.error("Failed to fetch applications:", error);
    return NextResponse.json(
      { error: "Failed to fetch applications" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { id, status, interviewRound } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Application ID required" },
        { status: 400 }
      );
    }

    // Verify ownership
    const app = await prisma.jobApplication.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!app) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updated = await prisma.jobApplication.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(interviewRound !== undefined && { interviewRound }),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update application:", error);
    return NextResponse.json(
      { error: "Failed to update application" },
      { status: 500 }
    );
  }
}
