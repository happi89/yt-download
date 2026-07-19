"use client"

import { useState } from "react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type JobStatus = "starting" | "downloading" | "processing" | "ready" | "error"

export default function Page() {
  const [url, setUrl] = useState("")
  const [format, setFormat] = useState<"mp4" | "mp3">("mp4")
  const [mode, setMode] = useState<"video" | "playlist">("video")
  const [isDownloading, setIsDownloading] = useState(false)
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [percent, setPercent] = useState(0)
  const [currentItem, setCurrentItem] = useState(0)
  const [totalItems, setTotalItems] = useState(0)
  const [message, setMessage] = useState("")
  const { resolvedTheme, setTheme } = useTheme()

  const handleDownload = async () => {
    if (!url.trim()) {
      setMessage("Please enter a YouTube URL.")
      return
    }

    setIsDownloading(true)
    setMessage("")
    setStatus("starting")
    setPercent(0)
    setCurrentItem(0)
    setTotalItems(0)

    try {
      const startResponse = await fetch("/api/download/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, format, mode }),
      })

      const startData = await startResponse.json()

      if (!startResponse.ok) {
        throw new Error(startData.error || "Unable to start download")
      }

      const jobId = startData.jobId as string
      await streamProgress(jobId)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Download failed")
      setIsDownloading(false)
      setStatus(null)
    }
  }

  const streamProgress = (jobId: string) => {
    return new Promise<void>((resolve, reject) => {
      const eventSource = new EventSource(`/api/download/stream?id=${jobId}`)

      eventSource.onmessage = async (event) => {
        const job = JSON.parse(event.data)

        setStatus(job.status)
        setPercent(job.percent ?? 0)
        setCurrentItem(job.currentItem ?? 0)
        setTotalItems(job.totalItems ?? 0)

        if (job.status === "ready") {
          eventSource.close()
          try {
            await fetchAndSaveFile(jobId)
            setMessage("Download complete")
            setUrl("")
          } catch (error) {
            reject(error)
          } finally {
            setIsDownloading(false)
            setStatus(null)
          }
        }

        if (job.status === "error") {
          eventSource.close()
          setIsDownloading(false)
          setStatus(null)
          reject(new Error(job.error || "Download failed"))
        }
      }

      eventSource.onerror = () => {
        eventSource.close()
        setIsDownloading(false)
        setStatus(null)
        reject(new Error("Lost connection while downloading"))
      }
    })
  }

  const fetchAndSaveFile = async (jobId: string) => {
    const response = await fetch(`/api/download/file?id=${jobId}`)

    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || "Unable to fetch finished file")
    }

    const blob = await response.blob()
    const contentDisposition = response.headers.get("content-disposition") || ""
    const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i)
    const downloadName =
      filenameMatch?.[1] ||
      (mode === "playlist" ? "playlist.zip" : `youtube-video.${format}`)

    const downloadUrl = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = downloadUrl
    link.download = downloadName
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(downloadUrl)
  }

  const statusLabel = () => {
    if (status === "starting") return "Starting..."
    if (status === "downloading") {
      if (mode === "playlist" && totalItems > 0) {
        return `Downloading video ${currentItem} of ${totalItems} — ${percent}%`
      }
      return `Downloading... ${percent}%`
    }
    if (status === "processing") return "Finishing up..."
    return null
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-[#ffffff] p-6 text-[#000000] dark:bg-[#000000] dark:text-[#ffffff]">
      <div className="flex flex-col gap-4 text-sm leading-loose">
        <div>
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                handleDownload()
              }
            }}
            placeholder="Paste a YouTube video or playlist URL"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label
              htmlFor="mode"
              className="text-xs text-foreground dark:text-white"
            >
              Download
            </label>
            <select
              id="mode"
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as "video" | "playlist")
              }
              className="h-8 rounded-lg border border-black/20 bg-background px-2.5 text-sm text-foreground dark:border-white/20 dark:bg-black dark:text-white"
            >
              <option value="video">Single video</option>
              <option value="playlist">Whole playlist</option>
            </select>

            <label
              htmlFor="format"
              className="text-xs text-foreground dark:text-white"
            >
              Format
            </label>
            <select
              id="format"
              value={format}
              onChange={(event) =>
                setFormat(event.target.value as "mp4" | "mp3")
              }
              className="h-8 rounded-lg border border-black/20 bg-background px-2.5 text-sm text-foreground dark:border-white/20 dark:bg-black dark:text-white"
            >
              <option value="mp4">MP4</option>
              <option value="mp3">MP3</option>
            </select>

            <Button onClick={handleDownload} disabled={isDownloading}>
              {isDownloading ? "Downloading..." : "Download"}
            </Button>
          </div>
          {mode === "playlist" ? (
            <div className="mt-1 font-mono text-xs text-foreground/60 dark:text-white/60">
              Downloads all videos in the playlist as a single .tar.gz file.
              This may take a while.
              <br />
              Note: the playlist must be set to <strong>Public</strong> on
              YouTube for this to work reliably.
            </div>
          ) : null}
        </div>

        {isDownloading ? (
          <div className="flex flex-col gap-1">
            <div className="font-mono text-xs text-foreground/80 dark:text-white/80">
              {statusLabel()}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className="h-full bg-black transition-all duration-150 dark:bg-white"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        ) : null}

        {message ? (
          <div className="font-mono text-xs text-foreground/80 dark:text-white/80">
            {message}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 font-mono text-xs text-foreground/80 dark:text-white/80">
          <span>
            (Press <kbd>d</kbd> to toggle dark mode)
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          >
            {resolvedTheme === "dark" ? "Light" : "Dark"}
          </Button>
        </div>
      </div>
    </div>
  )
}
