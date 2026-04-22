import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Simulation endpoint removed. Chat simulation will be rebuilt on the skill runtime." },
    { status: 501 },
  );
}
