import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BASE_DIR = path.join(process.cwd(), "public");
const PACK_BASES = [
  path.join(
    BASE_DIR,
    "UprightPianoKW-SFZ+FLAC-20220221",
    "UprightPianoKW-SFZ+FLAC-20220221"
  ),
  path.join(BASE_DIR, "UprightPianoKW-SFZ+FLAC-20220221"),
];

function isSafeRelativePath(rel) {
  return (
    typeof rel === "string" &&
    rel.length > 0 &&
    !path.isAbsolute(rel) &&
    !rel.includes("..")
  );
}

export async function GET(request) {
  const relPath = request.nextUrl.searchParams.get("path") ?? "";
  if (!isSafeRelativePath(relPath)) {
    return NextResponse.json({ error: "Invalid sample path" }, { status: 400 });
  }

  for (let i = 0; i < PACK_BASES.length; i++) {
    const fullPath = path.join(PACK_BASES[i], relPath);
    try {
      const data = await fs.readFile(fullPath);
      return new NextResponse(data, {
        status: 200,
        headers: {
          "Content-Type": "audio/flac",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch (_) {
      // Try next known pack base.
    }
  }

  return NextResponse.json({ error: "Sample not found" }, { status: 404 });
}
