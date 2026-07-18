import { readFile, rm } from "fs/promises"
import { NextRequest, NextResponse } from "next/server"
import { getJob, deleteJob } from "@/lib/download-jobs"

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("id")

  if (!jobId) {
    return NextResponse.json({ error: "Missing job id" }, { status: 400 })
  }

  const job = getJob(jobId)

  if (!job || job.status !== "ready" || !job.filePath) {
    return NextResponse.json({ error: "File not ready" }, { status: 404 })
  }

  try {
    const fileBuffer = await readFile(job.filePath)

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": job.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${job.fileName}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    return NextResponse.json({ error: "Unable to read file" }, { status: 500 })
  } finally {
  if (job.tempDir) {
    await rm(job.tempDir, { recursive: true, force: true }).catch(() => {})
  }
  if (job.filePath && job.filePath.endsWith(".zip")) {
    await rm(job.filePath, { force: true }).catch(() => {})
  }
  await deleteJob(jobId)
  }
}