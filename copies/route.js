import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  const apiKey = process.env.LOCATIONIQ_KEY;
  const baseUrl = process.env.LOCATIONIQ_URL;
  const limit = process.env.LOCATIONIQ_SEARCH_LIMIT;

  // Logic Branching:
  if (lat && lon) {
    // 1. REVERSE GEOCODE LOGIC
    const url = `${baseUrl}/reverse?key=${apiKey}&lat=${lat}&lon=${lon}&format=json`;
    const res = await fetch(url);
    const data = await res.json();
    return NextResponse.json(data);
  }

  if (query) {
    // 2. SEARCH LOGIC
    const url = `${baseUrl}/autocomplete?key=${apiKey}&q=${query}&limit=${limit}`;
    const res = await fetch(url);
    const data = await res.json();
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
}
