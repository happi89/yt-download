import { spawn } from "child_process"
import { mkdtemp, readdir, readFile, rm, stat } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import * as tar from "tar"
import { NextRequest, NextResponse } from "next/server"

const YTDLP_BIN = process.env.YTDLP_BIN || "yt-dlp"
const PROCESS_TIMEOUT_MS = 15 * 60 * 1000 // playlists take longer — 15 min

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

function runProcess(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    })

    let stdout = ""
    let stderr = ""
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill("SIGKILL")
    }, timeoutMs)

    proc.stdout.on("data", (chunk) => (stdout += chunk.toString()))
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString()))

    proc.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })

    proc.on("close", (exitCode) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new Error("yt-dlp timed out"))
        return
      }
      if (exitCode !== 0) {
        reject(new Error(stderr || stdout || `${bin} exited with code ${exitCode}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function tarDirectory(sourceDir: string, outPath: string, files: string[]): Promise<void> {
  await tar.create(
    {
      gzip: true,
      file: outPath,
      cwd: sourceDir,
    },
    files,
  )
}

export async function POST(request: NextRequest) {
  let tempDir: string | null = null

  try {
    const { url, format, mode } = await request.json()

    if (typeof url !== "string" || !url.trim()) {
      return NextResponse.json(
        { error: "Please enter a YouTube video URL." },
        { status: 400 },
      )
    }

    if (!isYouTubeUrl(url)) {
      return NextResponse.json(
        { error: "Only YouTube URLs are supported." },
        { status: 400 },
      )
    }

    const selectedFormat = format === "mp3" ? "mp3" : "mp4"
    const playlist = mode === "playlist"

    tempDir = await mkdtemp(join(tmpdir(), "yt-download-"))

    // Use yt-dlp's own numbering + title template so filenames stay unique
    // across an entire playlist.
    const outputTemplate = playlist
      ? join(tempDir, "%(playlist_index)03d - %(title)s.%(ext)s")
      : join(tempDir, "%(title)s.%(ext)s")

    const playlistFlag = playlist ? "--yes-playlist" : "--no-playlist"

    const ytDlpArgs =
      selectedFormat === "mp3"
        ? [
            playlistFlag,
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
            "--format",
            "best[ext=mp4]/bestvideo[height<=?1080]+bestaudio/best",
            "--output",
            outputTemplate,
            url,
          ]

    await runProcess(YTDLP_BIN, ytDlpArgs, PROCESS_TIMEOUT_MS)

    const files = await readdir(tempDir)
    if (files.length === 0) {
      throw new Error("yt-dlp completed but did not produce any files")
    }

    if (playlist) {
      // Tar + gzip everything and return the archive.
      const tarPath = join(tempDir, "..", `playlist-${Date.now()}.tar.gz`)
      await tarDirectory(tempDir, tarPath, files)
      const tarBuffer = await readFile(tarPath)
      await rm(tarPath, { force: true }).catch(() => {})

      return new NextResponse(new Uint8Array(tarBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": `attachment; filename="playlist.tar.gz"`,
          "Cache-Control": "no-store",
        },
      })
    }

    // Single video path
    const outputFile = files.find((file) => file.endsWith(`.${selectedFormat}`))

    if (!outputFile) {
      throw new Error("yt-dlp completed but did not produce a file")
    }

    const fileStat = await stat(join(tempDir, outputFile))
    if (fileStat.size === 0) {
      throw new Error("Downloaded file is empty")
    }

    const fileBuffer = await readFile(join(tempDir, outputFile))
    const safeName = sanitizeTitle(outputFile.replace(/\.[^.]+$/, ""))

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": selectedFormat === "mp3" ? "audio/mpeg" : "video/mp4",
        "Content-Disposition": `attachment; filename="${safeName}.${selectedFormat}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("download failed", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to download this video right now.",
      },
      { status: 500 },
    )
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}