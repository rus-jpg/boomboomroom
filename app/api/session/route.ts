import { NextResponse } from "next/server";
import { currentSession } from "@/lib/server/session";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ session: null }, { status: 200 });
  return NextResponse.json({ session });
}
