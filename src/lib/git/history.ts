import git, { type FsClient, type ReadCommitResult } from 'isomorphic-git'

/** A commit grouped by date, keeping the latest hash and all messages */
export interface DailyCommit {
    date: string // YYYY-MM-DD
    hash: string // OID of the latest commit that day
    messages: string[]
}

// --- Compact OID dedup set ---

/** Hex char code → nibble value lookup table */
const hexCharToNibble = new Uint8Array(128)
for (let i = 0; i < 10; i++) hexCharToNibble[0x30 + i] = i // '0'-'9'
for (let i = 0; i < 6; i++) {
    hexCharToNibble[0x41 + i] = 10 + i // 'A'-'F'
    hexCharToNibble[0x61 + i] = 10 + i // 'a'-'f'
}

const nextPowerOf2 = (n: number): number => {
    if (n <= 1) return 1
    n--
    n |= n >>> 1
    n |= n >>> 2
    n |= n >>> 4
    n |= n >>> 8
    n |= n >>> 16
    return n + 1
}

/**
 * Memory-efficient OID dedup set using binary SHA-1 values in a flat buffer.
 * ~4x smaller than Set<string> for 40-char hex OIDs (~36 MB vs ~144 MB for 1.2M entries).
 * Uses open addressing with linear probing; power-of-2 capacity for bitmask modulo.
 */
export class CompactOidSet {
    private static readonly SLOT_SIZE = 21 // 1 byte occupied flag + 20 bytes OID
    private data: Uint8Array
    private capacity: number
    private count = 0
    /** Reusable buffer for hex→binary conversion (safe: JS is single-threaded) */
    private readonly temp = new Uint8Array(20)

    constructor(initialCapacity = 4096) {
        this.capacity = nextPowerOf2(initialCapacity)
        this.data = new Uint8Array(this.capacity * CompactOidSet.SLOT_SIZE)
    }

    has(oidHex: string): boolean {
        this.hexToTemp(oidHex)
        return this.probe(this.temp, 0) >= 0
    }

    /** Returns true if the OID was newly added, false if already present. */
    add(oidHex: string): boolean {
        if (this.count >= this.capacity * 0.7) this.grow()
        this.hexToTemp(oidHex)
        return this.insert(this.temp, 0)
    }

    get size(): number {
        return this.count
    }

    private hexToTemp(hex: string): void {
        for (let i = 0; i < 20; i++) {
            this.temp[i] = (hexCharToNibble[hex.charCodeAt(i * 2)] << 4) | hexCharToNibble[hex.charCodeAt(i * 2 + 1)]
        }
    }

    /** Hash: first 4 bytes of the OID as uint32 (SHA-1 output is well-distributed) */
    private hash(bytes: Uint8Array, offset: number): number {
        return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
    }

    /** Returns slot index if found, -1 if not */
    private probe(bytes: Uint8Array, offset: number): number {
        const S = CompactOidSet.SLOT_SIZE
        const mask = this.capacity - 1
        let idx = this.hash(bytes, offset) & mask
        while (true) {
            const pos = idx * S
            if (this.data[pos] === 0) return -1
            if (this.match(pos + 1, bytes, offset)) return idx
            idx = (idx + 1) & mask
        }
    }

    private insert(bytes: Uint8Array, offset: number): boolean {
        const S = CompactOidSet.SLOT_SIZE
        const mask = this.capacity - 1
        let idx = this.hash(bytes, offset) & mask
        while (true) {
            const pos = idx * S
            if (this.data[pos] === 0) {
                this.data[pos] = 1
                this.data.set(bytes.subarray(offset, offset + 20), pos + 1)
                this.count++
                return true
            }
            if (this.match(pos + 1, bytes, offset)) return false
            idx = (idx + 1) & mask
        }
    }

    private match(dataOffset: number, bytes: Uint8Array, bytesOffset: number): boolean {
        for (let i = 0; i < 20; i++) {
            if (this.data[dataOffset + i] !== bytes[bytesOffset + i]) return false
        }
        return true
    }

    private grow(): void {
        const oldData = this.data
        const oldCapacity = this.capacity
        const S = CompactOidSet.SLOT_SIZE
        this.capacity = oldCapacity * 2
        this.data = new Uint8Array(this.capacity * S)
        this.count = 0
        for (let i = 0; i < oldCapacity; i++) {
            const pos = i * S
            if (oldData[pos] === 1) {
                this.insert(oldData, pos + 1)
            }
        }
    }
}

const commitBatchSize = 5000

/**
 * Get the commit log for a branch and group by date.
 * Returns entries in chronological order (oldest first).
 * Keeps the latest commit hash per day but collects all messages.
 *
 * Fetches commits in batches to bound peak memory on large repos.
 */
export const getCommitsByDate = async (options: {
    fs: FsClient
    dir: string
    ref: string
    gitCache?: object
    signal?: AbortSignal
    onProgress?: (processedCommits: number) => void
}): Promise<DailyCommit[]> => {
    const { fs, dir, ref, gitCache, signal, onProgress } = options

    const byDate = new Map<string, DailyCommit>()
    const seenOids = new CompactOidSet()
    let currentRef: string = ref
    let totalProcessed = 0

    while (true) {
        if (signal?.aborted) throw new Error('Cancelled')

        const batch: ReadCommitResult[] = await git.log({
            fs,
            dir,
            ref: currentRef,
            depth: commitBatchSize,
            cache: gitCache,
        })

        if (batch.length === 0) break

        for (const commit of batch) {
            if (seenOids.has(commit.oid)) continue
            seenOids.add(commit.oid)
            totalProcessed++

            const date = formatDate(commit.commit.author.timestamp)
            const existing = byDate.get(date)
            if (!existing) {
                byDate.set(date, {
                    date,
                    hash: commit.oid,
                    messages: [commit.commit.message.trim()],
                })
            } else {
                existing.messages.push(commit.commit.message.trim())
            }
        }

        onProgress?.(totalProcessed)

        // Stop if this batch was smaller than requested (end of history)
        if (batch.length < commitBatchSize) break

        // Find any unvisited parent to continue from. git.log does a full DAG
        // traversal from the starting ref, so one entry point is enough — it will
        // fan out and discover commits reachable from other frontier parents too.
        let nextRef: string | undefined
        for (const commit of batch) {
            for (const parentOid of commit.commit.parent) {
                if (!seenOids.has(parentOid)) {
                    nextRef = parentOid
                    break
                }
            }
            if (nextRef) break
        }
        if (!nextRef) break
        currentRef = nextRef
    }

    // Sort chronologically (oldest first)
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Format a unix timestamp (seconds) to YYYY-MM-DD */
const formatDate = (timestamp: number): string => {
    const d = new Date(timestamp * 1000)
    const year = d.getUTCFullYear()
    const month = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

/**
 * Generate all consecutive dates between start and end (inclusive).
 * Ported from Go reference implementation.
 */
export const generateConsecutiveDates = (startDate: string, endDate: string): string[] => {
    const start = new Date(startDate + 'T00:00:00Z')
    const end = new Date(endDate + 'T00:00:00Z')
    const dates: string[] = []

    const current = new Date(start)
    while (current <= end) {
        const year = current.getUTCFullYear()
        const month = String(current.getUTCMonth() + 1).padStart(2, '0')
        const day = String(current.getUTCDate()).padStart(2, '0')
        dates.push(`${year}-${month}-${day}`)
        current.setUTCDate(current.getUTCDate() + 1)
    }

    return dates
}

/**
 * Fill date gaps in daily commits.
 * For dates between commits that have no data, returns undefined
 * (the caller carries forward the previous day's stats).
 */
export const fillDateGaps = (dailyCommits: DailyCommit[]): Array<{ date: string; commit: DailyCommit | undefined }> => {
    if (dailyCommits.length === 0) return []

    const firstDate = dailyCommits[0].date
    const lastDate = dailyCommits[dailyCommits.length - 1].date
    const allDates = generateConsecutiveDates(firstDate, lastDate)

    const commitMap = new Map(dailyCommits.map((c) => [c.date, c]))

    return allDates.map((date) => ({
        date,
        commit: commitMap.get(date),
    }))
}
