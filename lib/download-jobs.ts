import { rm } from "fs/promises"

export type DownloadJob = {
  id: string
  status: "starting" | "downloading" | "processing" | "ready" | "error"
  percent: number
  currentItem: number
  totalItems: number
  error?: string
  filePath?: string
  fileName?: string
  contentType?: string
  tempDir?: string
  createdAt: number
  readyAt?: number
}

const jobs = new Map<string, DownloadJob>()

// Jobs that never finish (abandoned mid-download) get swept after this long.
const STALE_JOB_MAX_AGE_MS = 30 * 60 * 1000 // 30 minutes

// Jobs that finished ("ready") but were never fetched by the client get
// swept sooner, since the file is just sitting on disk waiting.
const UNCOLLECTED_READY_JOB_MAX_AGE_MS = 10 * 60 * 1000 // 10 minutes

let sweeperStarted = false

function startSweeperOnce() {
  if (sweeperStarted) return
  sweeperStarted = true

  setInterval(() => {
    sweepStaleJobs().catch((error) => {
      console.error("job sweep failed", error)
    })
  }, 60 * 1000) // check every minute
}

async function sweepStaleJobs() {
  const now = Date.now()

  for (const [id, job] of jobs.entries()) {
    const isReadyAndUncollected =
      job.status === "ready" &&
      job.readyAt !== undefined &&
      now - job.readyAt > UNCOLLECTED_READY_JOB_MAX_AGE_MS

    const isStuck =
      (job.status === "starting" || job.status === "downloading" || job.status === "processing") &&
      now - job.createdAt > STALE_JOB_MAX_AGE_MS

    const isOldError = job.status === "error" && now - job.createdAt > STALE_JOB_MAX_AGE_MS

    if (isReadyAndUncollected || isStuck || isOldError) {
      await cleanupJobFiles(job)
      jobs.delete(id)
    }
  }
}

async function cleanupJobFiles(job: DownloadJob) {
  if (job.tempDir) {
    await rm(job.tempDir, { recursive: true, force: true }).catch(() => {})
  }
  if (job.filePath && job.filePath.endsWith(".zip")) {
    await rm(job.filePath, { force: true }).catch(() => {})
  }
}

export function createJob(id: string, initial: Partial<DownloadJob> = {}) {
  startSweeperOnce()

  const job: DownloadJob = {
    id,
    status: "starting",
    percent: 0,
    currentItem: 0,
    totalItems: 1,
    createdAt: Date.now(),
    ...initial,
  }
  jobs.set(id, job)
  return job
}

export function getJob(id: string) {
  return jobs.get(id)
}

export function updateJob(id: string, patch: Partial<DownloadJob>) {
  const job = jobs.get(id)
  if (!job) return

  Object.assign(job, patch)

  if (patch.status === "ready" && job.readyAt === undefined) {
    job.readyAt = Date.now()
  }
}

export async function deleteJob(id: string) {
  const job = jobs.get(id)
  if (job) {
    await cleanupJobFiles(job)
  }
  jobs.delete(id)
}