import git, { type FsClient } from 'isomorphic-git'

interface MailmapEntry {
    /** Proper display name (undefined if only email is mapped) */
    properName?: string
    /** Proper email (undefined if only name is mapped) */
    properEmail?: string
    /** Commit email to match against */
    commitEmail: string
    /** Commit name to match against (form 4 only) */
    commitName?: string
}

const emailRe = /<([^>]+)>/g

/** Parse a .mailmap file into structured entries. */
export function parseMailmap(content: string): MailmapEntry[] {
    const entries: MailmapEntry[] = []

    for (const raw of content.split('\n')) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue

        const emails: { email: string; start: number; end: number }[] = []
        emailRe.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = emailRe.exec(line)) !== null) {
            emails.push({ email: m[1], start: m.index, end: emailRe.lastIndex })
        }

        if (emails.length === 0) continue

        if (emails.length === 1) {
            // Form 1: Proper Name <commit@email>
            // Form 2: <proper@email> <commit@email> — impossible with 1 email, so this is form 1
            const nameBefore = line.slice(0, emails[0].start).trim()
            if (nameBefore) {
                entries.push({ properName: nameBefore, commitEmail: emails[0].email })
            }
            // A bare <email> with no name and no second email is not a valid mailmap line
            continue
        }

        // 2+ emails
        const nameBefore1 = line.slice(0, emails[0].start).trim()
        const nameBetween = line.slice(emails[0].end, emails[1].start).trim()

        if (nameBetween) {
            // Form 4: Proper Name <proper@email> Commit Name <commit@email>
            entries.push({
                properName: nameBefore1 || undefined,
                properEmail: emails[0].email,
                commitName: nameBetween,
                commitEmail: emails[1].email,
            })
        } else if (nameBefore1) {
            // Form 3: Proper Name <proper@email> <commit@email>
            entries.push({
                properName: nameBefore1,
                properEmail: emails[0].email,
                commitEmail: emails[1].email,
            })
        } else {
            // Form 2: <proper@email> <commit@email>
            entries.push({
                properEmail: emails[0].email,
                commitEmail: emails[1].email,
            })
        }
    }

    return entries
}

/**
 * Build a lookup function from mailmap entries.
 * Returns normalized "Name <email>" for any given name + email.
 * More-specific forms win: form 4 (name+email match) > form 3/2 (email match) > form 1 (email match, name only).
 */
export function createMailmapLookup(entries: MailmapEntry[]): (name: string, email: string) => string {
    // Index by lowercase commit email for fast lookup
    const byEmail = new Map<string, MailmapEntry[]>()
    for (const entry of entries) {
        const key = entry.commitEmail.toLowerCase()
        const list = byEmail.get(key)
        if (list) list.push(entry)
        else byEmail.set(key, [entry])
    }

    return (name: string, email: string): string => {
        const candidates = byEmail.get(email.toLowerCase())
        if (!candidates) return `${name} <${email}>`

        // Try form 4 first (most specific — matches both name and email)
        for (const e of candidates) {
            if (e.commitName && e.commitName.toLowerCase() === name.toLowerCase()) {
                const resolvedName = e.properName ?? name
                const resolvedEmail = e.properEmail ?? email
                return `${resolvedName} <${resolvedEmail}>`
            }
        }

        // Fall back to forms 1/2/3 (email-only match). Prefer entries with properEmail (forms 2/3) over name-only (form 1).
        let best: MailmapEntry | undefined
        for (const e of candidates) {
            if (e.commitName) continue // form 4, already tried
            if (!best || (e.properEmail && !best.properEmail)) {
                best = e
            }
        }

        if (best) {
            const resolvedName = best.properName ?? name
            const resolvedEmail = best.properEmail ?? email
            return `${resolvedName} <${resolvedEmail}>`
        }

        return `${name} <${email}>`
    }
}

/** Read .mailmap from the repo root tree. Returns [] if not found. */
export async function readMailmapFromRepo(
    fs: FsClient,
    dir: string,
    headRef: string,
    gitCache?: object,
): Promise<MailmapEntry[]> {
    try {
        const { commit } = await git.readCommit({ fs, dir, oid: headRef, cache: gitCache })
        const tree = await git.readTree({ fs, dir, oid: commit.tree, cache: gitCache })

        const mailmapEntry = tree.tree.find((e) => e.path === '.mailmap')
        if (!mailmapEntry) return []

        const { blob } = await git.readBlob({ fs, dir, oid: mailmapEntry.oid, cache: gitCache })
        const content = new TextDecoder().decode(blob)
        return parseMailmap(content)
    } catch {
        return []
    }
}
