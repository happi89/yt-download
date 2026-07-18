import { spawn } from "child_process"
import { mkdtemp, readdir, stat } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { randomUUID } from "crypto"
import * as tar from "tar"
import { NextRequest, NextResponse } from "next/server"
import { createJob, updateJob, getJob } from "@/lib/download-jobs"

const YTDLP_BIN = process.env.YTDLP_BIN || "yt-dlp"

function sanitizeTitle(title: string) {
  const normalized = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  return (
    normalized
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .trim() || "video"
  )
}

function isYouTubeUrl(url: string) {
  try {
    const { hostname } = new URL(url)
    return [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtu.be",
      "music.youtube.com",
    ].includes(hostname)
  } catch {
    return false
  }
}

async function tarDirectory(
  sourceDir: string,
  outPath: string,
  files: string[]
): Promise<void> {
  await tar.create(
    {
      gzip: true,
      file: outPath,
      cwd: sourceDir,
    },
    files
  )
}

export async function POST(request: NextRequest) {
  const { url, format, mode } = await request.json()

  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json(
      { error: "Please enter a YouTube video URL." },
      { status: 400 }
    )
  }

  if (!isYouTubeUrl(url)) {
    return NextResponse.json(
      { error: "Only YouTube URLs are supported." },
      { status: 400 }
    )
  }

  const selectedFormat = format === "mp3" ? "mp3" : "mp4"
  const playlist = mode === "playlist"

  const jobId = randomUUID()
  createJob(jobId, { status: "starting", totalItems: playlist ? 0 : 1 })

  // Fire off the download in the background; don't await it here.
  runDownloadJob(jobId, url, selectedFormat, playlist).catch((error) => {
    updateJob(jobId, {
      status: "error",
      error: error instanceof Error ? error.message : "Download failed",
    })
  })

  return NextResponse.json({ jobId })
}

async function runDownloadJob(
  jobId: string,
  url: string,
  selectedFormat: "mp3" | "mp4",
  playlist: boolean
) {
  const tempDir = await mkdtemp(join(tmpdir(), "yt-download-"))
  updateJob(jobId, { tempDir, status: "downloading" })

  const outputTemplate = playlist
    ? join(tempDir, "%(playlist_index)03d - %(title)s.%(ext)s")
    : join(tempDir, "%(title)s.%(ext)s")

  const playlistFlag = playlist ? "--yes-playlist" : "--no-playlist"

  const printArgs = playlist
    ? ["--print", "before_dl:PLAYLIST_ITEM %(playlist_index)s/%(n_entries)s"]
    : []

  const ytDlpArgs =
    selectedFormat === "mp3"
      ? [
          playlistFlag,
          "--newline",
          "--ignore-errors",
          ...printArgs,
          "--extract-audio",
          "--audio-format",
          "mp3",
          "--audio-quality",
          "0",
          "--output",
          outputTemplate,
          url,
        ]
      : [
          playlistFlag,
          "--newline",
          "--ignore-errors",
          ...printArgs,
          "--format",
          "best[ext=mp4][height<=?1080]/bestvideo[height<=?1080]+bestaudio/best",
          "--output",
          outputTemplate,
          url,
        ]

  // Collected here so it's available for error messages even if we don't reject.
  let stderrBuffer = ""

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, ytDlpArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    })

    let stdoutLineBuffer = ""
    let stderrLineBuffer = ""

    const handleLine = (line: string) => {
      const playlistMatch = line.match(/^PLAYLIST_ITEM (\d+)\/(\d+)$/)
      if (playlistMatch) {
        updateJob(jobId, {
          currentItem: Number(playlistMatch[1]),
          totalItems: Number(playlistMatch[2]),
          percent: 0,
        })
        return
      }

      const percentMatch = line.match(/\[download\]\s+([\d.]+)%/)
      if (percentMatch) {
        const job = getJob(jobId)
        const itemPercent = Number(percentMatch[1])

        if (playlist && job && job.totalItems > 0) {
          const completedItems = Math.max(0, job.currentItem - 1)
          const overall =
            ((completedItems + itemPercent / 100) / job.totalItems) * 100
          updateJob(jobId, { percent: Math.min(100, Math.round(overall)) })
        } else {
          updateJob(jobId, { percent: Math.round(itemPercent) })
        }
      }
    }

    proc.stdout.on("data", (chunk) => {
      stdoutLineBuffer += chunk.toString()
      const lines = stdoutLineBuffer.split("\n")
      stdoutLineBuffer = lines.pop() || ""
      lines.forEach(handleLine)
    })

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString()
      stderrBuffer += text // keep full buffer in case we need it for an error message

      stderrLineBuffer += text
      const lines = stderrLineBuffer.split("\n")
      stderrLineBuffer = lines.pop() || ""
      lines.forEach(handleLine) // yt-dlp's [download] progress lines land here
    })

    proc.on("error", reject)

    proc.on("close", (exitCode) => {
      // With --ignore-errors, yt-dlp can exit non-zero even when it
      // successfully downloaded everything except one or two bad videos.
      // Don't treat that as fatal here — just log it. We decide success
      // or failure afterward based on whether any files actually landed
      // in tempDir.
      if (exitCode !== 0) {
        console.warn(
          `yt-dlp exited with code ${exitCode} (some items may have been skipped):`,
          stderrBuffer
        )
      }
      resolve()
    })
  })

  updateJob(jobId, { status: "processing", percent: 100 })

  const files = await readdir(tempDir)
  if (files.length === 0) {
    throw new Error(
      stderrBuffer || "yt-dlp completed but did not produce any files"
    )
  }

  if (playlist) {
    const tarPath = join(tempDir, "..", `playlist-${jobId}.tar.gz`)
    await tarDirectory(tempDir, tarPath, files)

    updateJob(jobId, {
      status: "ready",
      filePath: tarPath,
      fileName: "playlist.tar.gz",
      contentType: "application/gzip",
    })
    return
  }

  const outputFile = files.find((file) => file.endsWith(`.${selectedFormat}`))
  if (!outputFile) {
    throw new Error(
      stderrBuffer || "yt-dlp completed but did not produce a file"
    )
  }

  const fileStat = await stat(join(tempDir, outputFile))
  if (fileStat.size === 0) {
    throw new Error("Downloaded file is empty")
  }

  const safeName = sanitizeTitle(outputFile.replace(/\.[^.]+$/, ""))

  updateJob(jobId, {
    status: "ready",
    filePath: join(tempDir, outputFile),
    fileName: `${safeName}.${selectedFormat}`,
    contentType: selectedFormat === "mp3" ? "audio/mpeg" : "video/mp4",
  })
}
