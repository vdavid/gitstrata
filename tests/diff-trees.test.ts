import { describe, it, expect, beforeAll } from 'vitest'
import git from 'isomorphic-git'
import * as nodeFs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { diffTreesDetailed, computeCommitContribution } from '$lib/git/count'

/**
 * Helper: creates a temporary directory, initialises a git repo,
 * and returns utilities for committing snapshots of files.
 */
const createTestRepo = () => {
    const dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'diff-tree-test-'))
    const fs = nodeFs

    const initRepo = async () => {
        await git.init({ fs, dir })
    }

    /** Write files and create a commit; returns the commit OID. */
    const commitFiles = async (files: Record<string, string>, message: string): Promise<string> => {
        for (const [filePath, content] of Object.entries(files)) {
            const fullPath = path.join(dir, ...filePath.split('/'))
            nodeFs.mkdirSync(path.dirname(fullPath), { recursive: true })
            nodeFs.writeFileSync(fullPath, content)
            await git.add({ fs, dir, filepath: filePath })
        }
        return git.commit({
            fs,
            dir,
            message,
            author: { name: 'Test', email: 'test@test.com' },
        })
    }

    /** Delete a file from the working tree + index, then commit. */
    const deleteFileAndCommit = async (filePath: string, message: string): Promise<string> => {
        const fullPath = path.join(dir, ...filePath.split('/'))
        nodeFs.unlinkSync(fullPath)
        await git.remove({ fs, dir, filepath: filePath })
        return git.commit({
            fs,
            dir,
            message,
            author: { name: 'Test', email: 'test@test.com' },
        })
    }

    /** Read the root tree OID for a given commit. */
    const getTreeOid = async (commitOid: string): Promise<string> => {
        const commit = await git.readCommit({ fs, dir, oid: commitOid })
        return commit.commit.tree
    }

    const cleanup = () => {
        nodeFs.rmSync(dir, { recursive: true, force: true })
    }

    return { fs, dir, initRepo, commitFiles, deleteFileAndCommit, getTreeOid, cleanup }
}

// ─── diffTreesDetailed ──────────────────────────────────────────────

describe('diffTreesDetailed', () => {
    const repo = createTestRepo()
    const treeCache = new Map()

    let commitA: string
    let commitB: string
    let commitC: string
    let commitD: string

    beforeAll(async () => {
        await repo.initRepo()

        // Commit A: initial files
        commitA = await repo.commitFiles(
            {
                'hello.ts': 'console.log("hello")\n',
                'src/index.ts': 'export default 1\n',
            },
            'initial commit',
        )

        // Commit B: add a file, modify another
        commitB = await repo.commitFiles(
            {
                'hello.ts': 'console.log("hello world")\n',
                'README.md': '# Readme\n',
            },
            'add readme, modify hello',
        )

        // Commit C: delete hello.ts
        commitC = await repo.deleteFileAndCommit('hello.ts', 'delete hello')

        // Commit D: add vendored directory (node_modules)
        commitD = await repo.commitFiles(
            {
                'node_modules/pkg/index.js': 'module.exports = {}\n',
                'src/util.ts': 'export const add = (a: number, b: number) => a + b\n',
            },
            'add vendored and util',
        )
    })

    it('returns empty array for identical tree OIDs', async () => {
        const treeOid = await repo.getTreeOid(commitA)
        const result = await diffTreesDetailed({
            fs: repo.fs,
            dir: repo.dir,
            prevTreeOid: treeOid,
            currTreeOid: treeOid,
            treeCache,
        })
        expect(result).toEqual([])
    })

    it('detects added files', async () => {
        const prevTree = await repo.getTreeOid(commitA)
        const currTree = await repo.getTreeOid(commitB)
        const result = await diffTreesDetailed({
            fs: repo.fs,
            dir: repo.dir,
            prevTreeOid: prevTree,
            currTreeOid: currTree,
            treeCache,
        })

        const added = result.filter((e) => e.type === 'added')
        expect(added.map((e) => e.path)).toContain('README.md')
        for (const entry of added) {
            expect(entry.newOid).toBeDefined()
        }
    })

    it('detects modified files', async () => {
        const prevTree = await repo.getTreeOid(commitA)
        const currTree = await repo.getTreeOid(commitB)
        const result = await diffTreesDetailed({
            fs: repo.fs,
            dir: repo.dir,
            prevTreeOid: prevTree,
            currTreeOid: currTree,
            treeCache,
        })

        const modified = result.filter((e) => e.type === 'modified')
        expect(modified.map((e) => e.path)).toContain('hello.ts')
        for (const entry of modified) {
            expect(entry.oldOid).toBeDefined()
            expect(entry.newOid).toBeDefined()
            expect(entry.oldOid).not.toBe(entry.newOid)
        }
    })

    it('detects deleted files', async () => {
        const prevTree = await repo.getTreeOid(commitB)
        const currTree = await repo.getTreeOid(commitC)
        const result = await diffTreesDetailed({
            fs: repo.fs,
            dir: repo.dir,
            prevTreeOid: prevTree,
            currTreeOid: currTree,
            treeCache,
        })

        const deleted = result.filter((e) => e.type === 'deleted')
        expect(deleted.map((e) => e.path)).toContain('hello.ts')
        for (const entry of deleted) {
            expect(entry.oldOid).toBeDefined()
        }
    })

    it('detects changes in nested directories with correct full paths', async () => {
        const prevTree = await repo.getTreeOid(commitC)
        const currTree = await repo.getTreeOid(commitD)
        const result = await diffTreesDetailed({
            fs: repo.fs,
            dir: repo.dir,
            prevTreeOid: prevTree,
            currTreeOid: currTree,
            treeCache,
        })

        const addedPaths = result.filter((e) => e.type === 'added').map((e) => e.path)
        expect(addedPaths).toContain('src/util.ts')
    })

    it('skips vendored directories like node_modules', async () => {
        const prevTree = await repo.getTreeOid(commitC)
        const currTree = await repo.getTreeOid(commitD)
        const result = await diffTreesDetailed({
            fs: repo.fs,
            dir: repo.dir,
            prevTreeOid: prevTree,
            currTreeOid: currTree,
            treeCache,
        })

        const allPaths = result.map((e) => e.path)
        const vendored = allPaths.filter((p) => p.startsWith('node_modules'))
        expect(vendored).toHaveLength(0)
    })

    it('treats root commit (prevTreeOid undefined) as all files added', async () => {
        const currTree = await repo.getTreeOid(commitA)
        const result = await diffTreesDetailed({
            fs: repo.fs,
            dir: repo.dir,
            prevTreeOid: undefined,
            currTreeOid: currTree,
            treeCache,
        })

        expect(result.length).toBeGreaterThan(0)
        expect(result.every((e) => e.type === 'added')).toBe(true)
        const paths = result.map((e) => e.path)
        expect(paths).toContain('hello.ts')
        expect(paths).toContain('src/index.ts')
    })

    it('detects deletion of an entire subtree', async () => {
        // Commit B has src/index.ts; create a commit that removes it
        // Make a commit without the src directory by just having root-level files
        const commitNoSrc = await repo.commitFiles({ 'only-root.txt': 'root file\n' }, 'prepare for src removal')
        // Now delete src/index.ts
        const fullPath = path.join(repo.dir, 'src', 'index.ts')
        if (nodeFs.existsSync(fullPath)) {
            nodeFs.unlinkSync(fullPath)
            await git.remove({ fs: repo.fs, dir: repo.dir, filepath: 'src/index.ts' })
        }
        const commitAfterRemove = await git.commit({
            fs: repo.fs,
            dir: repo.dir,
            message: 'remove src',
            author: { name: 'Test', email: 'test@test.com' },
        })

        const prevTree = await repo.getTreeOid(commitNoSrc)
        const currTree = await repo.getTreeOid(commitAfterRemove)
        const result = await diffTreesDetailed({
            fs: repo.fs,
            dir: repo.dir,
            prevTreeOid: prevTree,
            currTreeOid: currTree,
            treeCache,
        })

        const deleted = result.filter((e) => e.type === 'deleted')
        const deletedPaths = deleted.map((e) => e.path)
        expect(deletedPaths).toContain('src/index.ts')
    })
})

// ─── computeCommitContribution ──────────────────────────────────────

describe('computeCommitContribution', () => {
    const repo = createTestRepo()

    let rootCommitOid: string
    let addCommitOid: string
    let deleteCommitOid: string
    let modifyCommitOid: string

    beforeAll(async () => {
        await repo.initRepo()

        // Root commit: one TypeScript file
        rootCommitOid = await repo.commitFiles({ 'index.ts': 'const a = 1\nconst b = 2\nconst c = 3\n' }, 'root commit')

        // Add a new file
        addCommitOid = await repo.commitFiles(
            { 'util.ts': 'export const sum = (a: number, b: number) => a + b\n' },
            'add util',
        )

        // Delete the original file
        deleteCommitOid = await repo.deleteFileAndCommit('index.ts', 'delete index')

        // Modify the remaining file (grow it)
        modifyCommitOid = await repo.commitFiles(
            {
                'util.ts': [
                    'export const sum = (a: number, b: number) => a + b',
                    'export const sub = (a: number, b: number) => a - b',
                    'export const mul = (a: number, b: number) => a * b',
                    '',
                ].join('\n'),
            },
            'expand util',
        )
    })

    const makeOptions = (commitOid: string, parentOid: string | undefined) => ({
        fs: repo.fs,
        dir: repo.dir,
        commitOid,
        parentOid,
        blobCache: new Map(),
        contentCache: new Map(),
        treeCache: new Map(),
        allExtensions: new Set(['.ts']),
    })

    it('counts all lines as added for root commit (no parent)', async () => {
        const result = await computeCommitContribution(makeOptions(rootCommitOid, undefined))

        expect(result.totalAdded).toBe(3) // 3 lines in index.ts
        expect(result.totalRemoved).toBe(0)
        expect(result.totalDelta).toBe(3)
        expect(result.languageAdded['typescript']).toBe(3)
        expect(Object.keys(result.languageRemoved)).toHaveLength(0)
    })

    it('counts new file lines as added for a normal commit', async () => {
        const result = await computeCommitContribution(makeOptions(addCommitOid, rootCommitOid))

        expect(result.totalAdded).toBe(1) // 1 line in util.ts
        expect(result.totalRemoved).toBe(0)
        expect(result.totalDelta).toBe(1)
        expect(result.languageAdded['typescript']).toBe(1)
    })

    it('counts removed file lines as removed', async () => {
        const result = await computeCommitContribution(makeOptions(deleteCommitOid, addCommitOid))

        expect(result.totalRemoved).toBe(3) // 3 lines in index.ts
        expect(result.totalAdded).toBe(0)
        expect(result.totalDelta).toBe(-3)
        expect(result.languageRemoved['typescript']).toBe(3)
    })

    it('computes correct delta for modified files', async () => {
        const result = await computeCommitContribution(makeOptions(modifyCommitOid, deleteCommitOid))

        // util.ts went from 1 line to 3 lines → +2
        expect(result.totalAdded).toBe(2)
        expect(result.totalRemoved).toBe(0)
        expect(result.totalDelta).toBe(2)
        expect(result.languageAdded['typescript']).toBe(2)
    })

    it('satisfies totalDelta = totalAdded - totalRemoved', async () => {
        // Check across multiple commits
        const commits = [
            { oid: rootCommitOid, parent: undefined },
            { oid: addCommitOid, parent: rootCommitOid },
            { oid: deleteCommitOid, parent: addCommitOid },
            { oid: modifyCommitOid, parent: deleteCommitOid },
        ] as const

        for (const { oid, parent } of commits) {
            const result = await computeCommitContribution(makeOptions(oid, parent))
            expect(result.totalDelta).toBe(result.totalAdded - result.totalRemoved)
        }
    })
})
