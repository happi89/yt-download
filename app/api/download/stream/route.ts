import { NextRequest } from "next/server"
import { getJob } from "@/lib/download-jobs"

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("id")

  if (!jobId) {
    return new Response("Missing job id", { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const interval = setInterval(() => {
        const job = getJob(jobId)

        if (!job) {
          send({ status: "error", error: "Job not found" })
          clearInterval(interval)
          controller.close()
          return
        }

        send(job)

        if (job.status === "ready" || job.status === "error") {
          clearInterval(interval)
          controller.close()
        }
      }, 500)

      request.signal.addEventListener("abort", () => {
        clearInterval(interval)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}