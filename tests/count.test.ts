import { describe, it, expect } from 'vitest'
import { countLines, shouldSkip, shouldSkipDir } from '$lib/git/count'

describe('countLines', () => {
    it('counts lines ending with newline', () => {
        expect(countLines('a\nb\nc\n')).toBe(3)
    })

    it('counts lines not ending with newline', () => {
        expect(countLines('a\nb\nc')).toBe(3)
    })

    it('returns 0 for empty content', () => {
        expect(countLines('')).toBe(0)
    })

    it('counts single line without newline', () => {
        expect(countLines('hello')).toBe(1)
    })

    it('counts single line with newline', () => {
        expect(countLines('hello\n')).toBe(1)
    })

    it('handles multiple blank lines', () => {
        expect(countLines('\n\n\n')).toBe(3)
    })

    it('matches Go reference: count newlines, add 1 if no trailing newline', () => {
        // This matches: strings.Count(content, "\n") + (no trailing \n ? 1 : 0)
        expect(countLines('line1\nline2\n')).toBe(2)
        expect(countLines('line1\nline2')).toBe(2)
    })
})

describe('shouldSkip', () => {
    it('skips original lock files', () => {
        expect(shouldSkip('pnpm-lock.yaml')).toBe(true)
        expect(shouldSkip('package-lock.json')).toBe(true)
        expect(shouldSkip('yarn.lock')).toBe(true)
        expect(shouldSkip('Cargo.lock')).toBe(true)
        expect(shouldSkip('go.sum')).toBe(true)
    })

    it('skips newly added lock files', () => {
        expect(shouldSkip('Gemfile.lock')).toBe(true)
        expect(shouldSkip('Pipfile.lock')).toBe(true)
        expect(shouldSkip('poetry.lock')).toBe(true)
        expect(shouldSkip('uv.lock')).toBe(true)
        expect(shouldSkip('pdm.lock')).toBe(true)
        expect(shouldSkip('composer.lock')).toBe(true)
        expect(shouldSkip('pubspec.lock')).toBe(true)
        expect(shouldSkip('Podfile.lock')).toBe(true)
        expect(shouldSkip('mix.lock')).toBe(true)
        expect(shouldSkip('flake.lock')).toBe(true)
        expect(shouldSkip('packages.lock.json')).toBe(true)
        expect(shouldSkip('paket.lock')).toBe(true)
        expect(shouldSkip('conan.lock')).toBe(true)
        expect(shouldSkip('gradle.lockfile')).toBe(true)
        expect(shouldSkip('npm-shrinkwrap.json')).toBe(true)
        expect(shouldSkip('Package.resolved')).toBe(true)
    })

    it('skips minified files', () => {
        expect(shouldSkip('app.min.js')).toBe(true)
        expect(shouldSkip('styles.min.css')).toBe(true)
        expect(shouldSkip('vendor.min.mjs')).toBe(true)
    })

    it('skips source maps', () => {
        expect(shouldSkip('app.js.map')).toBe(true)
        expect(shouldSkip('styles.css.map')).toBe(true)
        expect(shouldSkip('vendor.mjs.map')).toBe(true)
        expect(shouldSkip('something.map')).toBe(false)
    })

    it('skips protobuf codegen', () => {
        expect(shouldSkip('service.pb.go')).toBe(true)
        expect(shouldSkip('message.pb.cc')).toBe(true)
        expect(shouldSkip('message.pb.h')).toBe(true)
        expect(shouldSkip('message.pb.swift')).toBe(true)
        expect(shouldSkip('service_pb2.py')).toBe(true)
        expect(shouldSkip('service_pb2_grpc.py')).toBe(true)
    })

    it('skips .NET codegen', () => {
        expect(shouldSkip('Form1.Designer.cs')).toBe(true)
        expect(shouldSkip('Resource.g.cs')).toBe(true)
        expect(shouldSkip('App.g.i.cs')).toBe(true)
    })

    it('skips Dart codegen', () => {
        expect(shouldSkip('model.g.dart')).toBe(true)
        expect(shouldSkip('model.freezed.dart')).toBe(true)
    })

    it('skips files nested in directories', () => {
        expect(shouldSkip('src/lib/package-lock.json')).toBe(true)
        expect(shouldSkip('deep/path/app.min.js')).toBe(true)
    })

    it('does not skip regular source files', () => {
        expect(shouldSkip('index.ts')).toBe(false)
        expect(shouldSkip('main.go')).toBe(false)
        expect(shouldSkip('app.css')).toBe(false)
        expect(shouldSkip('README.md')).toBe(false)
    })

    it('does not skip files that partially match patterns', () => {
        expect(shouldSkip('not-a-lock.json')).toBe(false)
        expect(shouldSkip('app.js')).toBe(false) // not .min.js
        expect(shouldSkip('service.go')).toBe(false) // not .pb.go
    })
})

describe('shouldSkipDir', () => {
    it('skips vendored directories', () => {
        expect(shouldSkipDir('vendor')).toBe(true)
        expect(shouldSkipDir('node_modules')).toBe(true)
        expect(shouldSkipDir('Pods')).toBe(true)
        expect(shouldSkipDir('bower_components')).toBe(true)
        expect(shouldSkipDir('__pycache__')).toBe(true)
    })

    it('does not skip regular directories', () => {
        expect(shouldSkipDir('src')).toBe(false)
        expect(shouldSkipDir('lib')).toBe(false)
        expect(shouldSkipDir('tests')).toBe(false)
    })

    it('is case-sensitive', () => {
        expect(shouldSkipDir('Vendor')).toBe(false)
        expect(shouldSkipDir('NODE_MODULES')).toBe(false)
        expect(shouldSkipDir('pods')).toBe(false)
    })
})
